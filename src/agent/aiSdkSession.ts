/**
 * 用 Vercel AI SDK 写的极简编码 agent（形状参照 pi：read / write / edit / bash）。
 *
 * 这是 AgentSession 接缝的第三个实现：
 *   mockSession   —— 本地剧本（离线）
 *   liveSession   —— 裸 SSE 纯文本流
 *   aiSdkSession  —— 真·工具循环（本文件），模型自己决定读哪个文件、跑什么命令
 *
 * 关键设计：
 * 1) 工具在 respond() 内部按轮创建，闭包直接拿到 sink —— 所以 bash 的 stdout
 *    是**边跑边写进转写**的，不是等工具返回才一次性显示。
 * 2) 工具行按 toolCallId 做键，一个 step 里并发多个工具调用也不会串行错位。
 * 3) 工作区根目录由 VT_AGENT_ROOT 决定，所有文件工具用相对路径解析并拒绝越界。
 * 4) 多轮对话历史用 result.responseMessages 累积（含 tool 消息），下一轮可以接着聊。
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import type { ModelMessage } from 'ai'
import type { AgentSession, ToolStep, TurnContext } from './session.ts'

export type AiSdkOptions = {
  baseUrl: string
  model: string
  apiKey?: string
  /** 工具能碰的根目录；默认进程 cwd */
  root?: string
  /** 工具循环上限（step 数） */
  maxSteps?: number
}

const MAX_OUTPUT_LINES = 300
/** 工具输出的硬上限：超过就停止显示并终止命令。
 *  教训：`dir /b *.txt | find /c /v ""` 在 git-bash 的 PATH 下会把 MSYS 的 find.exe
 *  当成 Linux find 用，变成全盘遍历——几万行输出按行写进响应式 store 会把事件循环堵死。 */
const MAX_STREAM_LINES = 200
const MAX_STREAM_BYTES = 64 * 1024
const BASH_TIMEOUT_MS = 20_000

/** 单行摘要：给工具行标题用，跟 pi 一样只显示「工具名(关键参数)」。 */
function summarize(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => String(v ?? '')
  const rel = (v: unknown) => path.basename(s(v)) === s(v) ? s(v) : s(v)
  if (name === 'bash') return s(input.command)
  if (name === 'read_file') return `${rel(input.path)}${input.offset ? ` @${input.offset}` : ''}`
  if (name === 'write_file') return `${rel(input.path)} (${s(input.content).length} 字符)`
  if (name === 'edit_file') return `${rel(input.path)}`
  if (name === 'ls') return rel(input.path ?? '.')
  return rel(input.path ?? '')
}

/** 带行号的读取结果 —— 跟 pi 一样，让模型能引用具体行。 */
function numbered(text: string, offset: number): string {
  return text
    .split('\n')
    .map((line, i) => `${String(offset + i).padStart(5)}| ${line}`)
    .join('\n')
}

export function createAiSdkSession(opts: AiSdkOptions): AgentSession {
  const root = path.resolve(opts.root ?? process.cwd())
  /** Windows：把 System32 提到 PATH 最前面，否则 `find`/`sort`/`more` 会命中 git-bash 的 MSYS 版本。 */
  const shellEnv = (() => {
    if (process.platform !== 'win32') return process.env
    const win = process.env.SystemRoot ?? 'C:' + path.sep + 'Windows'
    const first = [path.join(win, 'System32'), win, path.join(win, 'System32', 'WindowsPowerShell', 'v1.0')]
    const rest = (process.env.PATH ?? '').split(path.delimiter).filter((p) => p && !first.includes(p))
    return { ...process.env, PATH: [...first, ...rest].join(path.delimiter) }
  })()
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: opts.baseUrl.replace(/\/+$/, ''),
    apiKey: opts.apiKey,
    includeUsage: true,
  })
  const model = provider(opts.model)
  const history: ModelMessage[] = []

  const system = [
    '你是终端里的极简编码 agent（形状参照 pi），靠工具干活，不靠记忆猜。',
    `工作目录：${root}。所有文件路径按相对这个目录解析，越界路径会被拒绝。`,
    '工具：read_file / write_file / edit_file / bash / ls。',
    '规则：',
    '- 需要事实（文件里到底写了什么、命令输出是什么）就用工具拿，不要凭空编。',
    '- edit_file 需要精确匹配原文；匹配 0 处或（未指定 replace_all 时）多于一处的会失败。',
    '- 回答用中文，简洁。不要复述工具已经打印过的内容，只给结论和关键点。',
    '- 做完一件事用一两句话总结改了什么、结论是什么。',
    process.platform === 'win32'
      ? '- 平台是 Windows，shell 是 cmd.exe：用 dir 而不是 find/grep 系列（Git Bash 的 find.exe 会抢在系统同名程序前面，行为完全不同）；要计数用 `dir /b | find /c /v ""` 且优先写全路径 %SystemRoot%\System32\find.exe。'
      : '- 平台是 POSIX，shell 是 sh。',
    '- 工具输出有行数上限（200 行），超了会被终止：尽量用 head / tail / 精确过滤把输出压小。',
  ].join('\n')

  /** 把一段工具输出按行写进转写（顺便截断，避免一次灌几百行）。 */
  const emitLines = (ctx: TurnContext, step: ToolStep, text: string): string[] => {
    const lines = text.replace(/\r/g, '').split('\n')
    const shown = lines.slice(0, MAX_OUTPUT_LINES)
    for (const line of shown) ctx.sink.toolLine(step, line)
    if (lines.length > MAX_OUTPUT_LINES) {
      ctx.sink.toolLine(step, `…（还有 ${lines.length - MAX_OUTPUT_LINES} 行未显示）`)
    }
    return lines
  }

  const resolveInRoot = (p: string): string => {
    const abs = path.resolve(root, p)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`路径越界: ${p} 不在工作区 ${root} 内`)
    }
    return abs
  }

  return {
    id: 'ai',
    label: `ai-sdk · ${opts.model}`,

    async respond(prompt: string, ctx: TurnContext): Promise<void> {
      // 每一轮的工具集都闭包住 sink 和本轮的行键
      const rows = new Map<string, ToolStep>()
      const rowFor = (id: string, name: string, input: Record<string, unknown>): ToolStep => {
        let row = rows.get(id)
        if (!row) {
          row = { id, name, arg: summarize(name, input), params: input }
          rows.set(id, row)
          ctx.sink.toolStart(row)
        }
        return row
      }

      const runBash = (command: string, signal?: AbortSignal, id = 'bash') =>
        new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
          const row = rowFor(id, 'bash', { command })
          const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh'
          const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command]
          const child = spawn(shell, args, { cwd: root, env: shellEnv, windowsHide: true })
          // 立刻关掉子进程 stdin：像 `find /c /v ""` 这种会读 stdin 的命令，
          // 不关就会一直等 EOF，把工具调用挂死（实测踩到过）。
          child.stdin?.end()
          let out = ''
          let settled = false
          let timedOut = false
          const push = (chunk: Buffer) => {
            const text = chunk.toString('utf8')
            out += text
            for (const line of text.replace(/\r/g, '').split('\n')) {
              if (line.length) ctx.sink.toolLine(row, line)
            }
          }
          child.stdout.on('data', push)
          child.stderr.on('data', push)

          const killTree = () => {
            if (child.pid === undefined) return
            // 子进程可能又拉起了孙子进程（dir | find），只 kill 直接子进程会把管道留在半空
            if (process.platform === 'win32') {
              spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
            } else {
              child.kill('SIGKILL')
            }
          }
          const finish = (code: number | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            resolve({ code, out, timedOut })
          }
          const timer = setTimeout(() => {
            timedOut = true
            ctx.sink.toolLine(row, '[超时 ' + BASH_TIMEOUT_MS + 'ms，已终止进程树]')
            killTree()
            setTimeout(() => finish(null), 500)
          }, BASH_TIMEOUT_MS)
          const onAbort = () => {
            killTree()
            setTimeout(() => finish(null), 300)
          }
          signal?.addEventListener('abort', onAbort, { once: true })
          child.on('close', (code) => finish(code))
          child.on('exit', (code) => setTimeout(() => finish(code), 200))
          child.on('error', (err) => {
            ctx.sink.toolLine(row, 'spawn 失败: ' + err.message)
            out += ' | spawn 失败: ' + err.message
            finish(-1)
          })
        })

      const tools = {
        read_file: tool({
          description: '读取工作区里某个文本文件，返回带行号的内容。大文件用 offset/limit 分段读。',
          inputSchema: z.object({
            path: z.string().describe('相对工作目录的路径'),
            offset: z.number().int().positive().optional().describe('起始行号（1 起）'),
            limit: z.number().int().positive().max(500).optional().describe('最多读多少行'),
          }),
          execute: async ({ path: p, offset = 1, limit = 200 }, o) => {
            const row = rowFor(o.toolCallId, 'read_file', { path: p, offset })
            const abs = resolveInRoot(p)
            const info = await stat(abs)
            if (info.isDirectory()) throw new Error(`${p} 是目录，用 ls 看目录内容`)
            const raw = await readFile(abs, 'utf8')
            const slice = raw.split('\n').slice(offset - 1, offset - 1 + limit)
            const text = numbered(slice.join('\n'), offset)
            const lines = emitLines(ctx, row, text)
            return `读到 ${lines.length} 行（文件共 ${raw.split('\n').length} 行）:\n${text}`
          },
        }),

        write_file: tool({
          description: '把内容写入文件（覆盖），父目录不存在会自动创建。',
          inputSchema: z.object({
            path: z.string().describe('相对工作目录的路径'),
            content: z.string().describe('完整文件内容'),
          }),
          execute: async ({ path: p, content }, o) => {
            const row = rowFor(o.toolCallId, 'write_file', { path: p, content })
            const abs = resolveInRoot(p)
            await mkdir(path.dirname(abs), { recursive: true })
            await writeFile(abs, content, 'utf8')
            const msg = `已写入 ${Buffer.byteLength(content, 'utf8')} 字节 → ${p}`
            ctx.sink.toolLine(row, msg)
            return msg
          },
        }),

        edit_file: tool({
          description:
            '对文件做精确字符串替换。默认要求 old_string 在文件中唯一出现；replace_all 为 true 时替换全部。匹配不到会报错。',
          inputSchema: z.object({
            path: z.string(),
            old_string: z.string().describe('要被替换的原文（包含缩进）'),
            new_string: z.string().describe('替换成的新内容'),
            replace_all: z.boolean().optional(),
          }),
          execute: async ({ path: p, old_string, new_string, replace_all }, o) => {
            const row = rowFor(o.toolCallId, 'edit_file', { path: p })
            const abs = resolveInRoot(p)
            const before = await readFile(abs, 'utf8')
            const count = before.split(old_string).length - 1
            if (count === 0) throw new Error(`old_string 在 ${p} 里找不到（要一字不差，含缩进）`)
            if (count > 1 && !replace_all) {
              throw new Error(`old_string 在 ${p} 里出现 ${count} 次，不唯一；补上下文或传 replace_all: true`)
            }
            const after = replace_all ? before.split(old_string).join(new_string) : before.replace(old_string, new_string)
            await writeFile(abs, after, 'utf8')
            const msg = `已替换 ${replace_all ? count : 1} 处 → ${p}`
            ctx.sink.toolLine(row, msg)
            return msg
          },
        }),

        bash: tool({
          description:
            '在工作目录里执行 shell 命令（Windows 走 cmd.exe，其它平台走 sh）。stdout/stderr 会被实时显示。默认 20 秒超时。',
          inputSchema: z.object({ command: z.string().describe('要执行的命令') }),
          execute: async ({ command }, o) => {
            const { code, out } = await runBash(command, o.abortSignal, o.toolCallId)
            const tail = out.trim().split('\n').slice(-40).join('\n')
            return `exit=${code}\n${tail || '(无输出)'}`
          },
        }),

        ls: tool({
          description: '列出目录内容（名称、类型、大小）。',
          inputSchema: z.object({ path: z.string().optional().describe('默认当前工作目录') }),
          execute: async ({ path: p = '.' }, o) => {
            const row = rowFor(o.toolCallId, 'ls', { path: p })
            const abs = resolveInRoot(p)
            const entries = await readdir(abs, { withFileTypes: true })
            const listed: string[] = []
            for (const e of entries.slice(0, 120)) {
              const size = e.isDirectory() ? '' : ` ${(await stat(path.join(abs, e.name))).size}B`
              listed.push(`${e.isDirectory() ? 'd' : '-'} ${e.name}${size}`)
            }
            const text = listed.join('\n') || '(空目录)'
            emitLines(ctx, row, text)
            return `${p} 下 ${entries.length} 项:\n${text}`
          },
        }),
      }

      history.push({ role: 'user', content: prompt })

      // 中止标志 → AbortController：Esc 能掐断正在跑的 HTTP 流和子进程
      const controller = new AbortController()
      const watchdog = setInterval(() => {
        if (ctx.aborted()) controller.abort()
      }, 50)

      const result = streamText({
        model,
        system,
        messages: history,
        tools,
        stopWhen: stepCountIs(opts.maxSteps ?? 8),
        abortSignal: controller.signal,
      })

      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'reasoning-delta':
              ctx.sink.thinkingDelta(part.text)
              break
            case 'reasoning-end':
              ctx.sink.thinkingEnd()
              break
            case 'text-delta':
              ctx.sink.answerDelta(part.text)
              break
            case 'tool-call': {
              const input = (part.input ?? {}) as Record<string, unknown>
              rowFor(part.toolCallId, part.toolName, input)
              break
            }
            case 'tool-result':
              ctx.sink.toolEnd(rows.get(part.toolCallId) ?? { id: part.toolCallId, name: part.toolName, arg: '' }, 'ok')
              break
            case 'tool-error':
              ctx.sink.toolEnd(rows.get(part.toolCallId) ?? { id: part.toolCallId, name: part.toolName, arg: '' }, 'error')
              break
            case 'error': {
              const err = part.error
              ctx.sink.answerDelta(`\n[SDK 错误] ${err instanceof Error ? err.message : JSON.stringify(err)}\n`)
              break
            }
            case 'abort':
              break
            default:
              break
          }
          if (ctx.aborted()) break
        }
        ctx.sink.thinkingEnd()

        // 把这一轮的全部消息（含 tool 结果）并入历史，下一轮可续聊
        try {
          const messages = await result.responseMessages
          history.push(...messages)
        } catch {
          /* 中止时可能拿不到完整消息，忽略即可 */
        }
      } catch (err) {
        if (!ctx.aborted()) {
          ctx.sink.answerDelta(`\n[流中断] ${err instanceof Error ? err.message : String(err)}\n`)
        }
      } finally {
        clearInterval(watchdog)
      }
    },
  }
}
