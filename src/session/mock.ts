/**
 * 本地剧本会话：离线可用，自带节奏，用于演示流式渲染链路。
 *
 * 两个刻意的设计：
 * 1) 节奏由 ctx.chunkDelayMs 控制，smoke 传 0 就变成「尽快跑完」，同一套代码既演示又测试。
 * 2) 工具步骤里的 run 会真的起一个子进程并流式读取它的 stdout——
 *    终端里看到的 out: 是真实输出，不是写死的假数据。
 */
import { spawn } from 'node:child_process'
import { chunkText } from '../core/text.ts'
import type { AgentSession, StreamStep, TurnContext } from './seam.ts'

type RealCommand = { file: string; args: string[]; cwd?: string }

/** 用 node 自己跑一段读文件的脚本，跨平台且不需要 shell 引号。 */
function readFileLines(path: string, from: number, count: number): RealCommand {
  const script = [
    `const fs=require('fs')`,
    `const lines=fs.readFileSync(${JSON.stringify(path)},'utf8').split(/\\r?\\n/)`,
    `const out=lines.slice(${from - 1},${from - 1 + count}).map((l,i)=>String(${from}+i).padStart(4,' ')+'│ '+l)`,
    `console.log(out.join('\\n'))`,
  ].join(';')
  return { file: process.execPath, args: ['-e', script] }
}

function countProjectLines(): RealCommand {
  const script = [
    `const fs=require('fs'),p=require('path')`,
    `const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)])`,
    `const files=walk('src').filter(f=>/\\.ts$/.test(f))`,
    `let total=0`,
    `for(const f of files){const n=fs.readFileSync(f,'utf8').split(/\\r?\\n/).length;total+=n;console.log(String(n)+'  '+f.replace(/\\\\/g,'/'))}`,
    `console.log(String(total)+'  合计 '+files.length+' 个文件')`,
  ].join(';')
  return { file: process.execPath, args: ['-e', script] }
}

const SCENARIO_STREAM: StreamStep[] = [
  {
    kind: 'thinking',
    text: '先把这条链路捋清楚：流式增量要落在「数据源」这一层，而不是让组件自己持有 buffer。\n只要每次增量后把行的 version 加一、整体 version 加一，视图就会只重绘变化的那几行。',
  },
  {
    kind: 'tool',
    tool: {
      name: 'Read',
      arg: 'src/transcript/store.ts',
      params: { path: 'src/transcript/store.ts', offset: 96, limit: 14 },
      output: [],
      status: 'ok',
      run: readFileLines('src/transcript/store.ts', 96, 14),
    },
  },
  {
    kind: 'tool',
    tool: {
      name: 'Bash',
      arg: 'node -e "统计 src 下各文件行数"',
      params: { command: 'node -e "<walk src/*.ts and count lines>"', timeout_ms: 20000 },
      command: 'node -e "<walk src/*.ts and count lines>"',
      output: [],
      status: 'ok',
      run: countProjectLines(),
    },
  },
  {
    kind: 'answer',
    text: `流式输出的关键就三步，都在 \`src/transcript/store.ts\` 里：

1. **会话层产出增量** —— mock 剧本按 2~3 个字符一块吐，\`chunkText()\` 保证不把换行切碎。
2. **数据源按行累积** —— \`LineStream.push(delta)\` 每遇到一个换行符就「封行 + 开新行」，只改当前行的 \`text\` 并把这一行的 \`rev++\`。
3. **视图只重绘脏行** —— \`<TTranscriptView :source="store" :version="version">\` 拿到新版本号后比对每行的 \`getRowVersion\`，只把变化的那一行写进终端 buffer。

有个实测出来的坑：vue-tui 的 transcript 行是**段落式**排版，同一行里 segments 之间写换行符不会断行，所以这里按物理行拆 row，而不是「一条消息一个 row」。

核心就这几行：

\`\`\`ts
push(delta: string) {
  this.pending += delta
  while (this.pending.includes(NEWLINE)) {
    this.commit(takeLine(this.pending))          // 封行：这一行已完整
  }
  if (this.pending) this.apply(this.pending)     // 当前行就地更新
}
\`\`\`

配合 \`autoStickToBottom\`，只要用户没往上滚，新内容就会顶在底部；一旦用户滚上去，视图就不再抢滚动位置——「看历史时输出不会把你拽下来」是终端 agent 的通行做法。

> 提示：本段文本来自本地剧本，不是真实模型输出；\`VT_AGENT=rpc pnpm dev\` 可接唯一 agent 后端（需先 pnpm backend）。`,
  },
]

const SCENARIO_LAYOUT: StreamStep[] = [
  {
    kind: 'thinking',
    text: '解释渲染分层：transcript / chrome / input 走不同 plane，高频正文更新不该带着输入框一起重绘。',
  },
  {
    kind: 'answer',
    text: `这套 demo 的分层是这样切的（\`src/ui/layout.ts\` 的 \`layoutOf()\`）：

| 区域 | plane | 更新频率 |
| --- | --- | --- |
| 转写正文 | transcript | 每 10~20ms 一次 |
| 状态栏 | chrome | 每 100ms 一次 |
| 输入框 | default | 只在按键时 |

同一帧里这三块各自独立重绘：正文把 30 行刷一遍，也不会让输入框的光标闪一下。

\`\`\`ts
h(TView, { x: 0, y: 0, w, h, onKeydownCapture: onKey }, () => [
  h(TRenderPlane, { plane: 'transcript' }, () => transcriptRow(w)),
  h(TRenderPlane, { plane: 'chrome' }, () => statusRow(w)),
  h(TRenderPlane, { plane: 'default' }, () => composerRow(w)),
  h(TRenderPlane, { plane: 'overlay' }, () => []),
])
\`\`\`

现在试着往上滚一下鼠标：正文会停在你滚到的位置，新来的增量只在底部累积，不会把视口拽回去。按 \`Ctrl+End\` 可以跳回底部。`,
  },
]

const SCENARIO_ERROR: StreamStep[] = [
  {
    kind: 'thinking',
    text: '这次让工具失败一次，顺便看看失败态在转写里怎么呈现。',
  },
  {
    kind: 'tool',
    tool: {
      name: 'Bash',
      arg: 'node -e "process.exit(1)"',
      command: 'node -e "throw new Error(\'demo 失败态\')"',
      output: ['Error: demo 失败态', '    at [eval]:1:7', '    at runScriptInThisContext (node:internal/process/execution:217:5)'],
      status: 'error',
    },
  },
  {
    kind: 'answer',
    text: `工具失败时那行会变成 \`✗\`，摘要写「失败（退出码 1）」。状态只存在数据源里（\`entry.status\`），视图不需要知道工具是怎么跑的——换成真实 MCP 工具时这层不用改。

**快捷键**
- \`Enter\` 发送，\`Esc\` 中断正在跑的这一轮
- \`Ctrl+End\` 跳到底部，鼠标滚轮 / \`PgUp\` 翻历史
- \`/clear\` 清空转写，\`/help\` 看命令，\`Ctrl+C\` 退出`,
  },
]

const LONG_ANSWER = (() => {
  const parts: string[] = ['下面是 `\\/long` 生成的长回答，用来观察长内容下的增量重绘与滚动行为。\n\n']
  for (let i = 1; i <= 24; i++) {
    parts.push(
      `### 第 ${i} 段 · 脏行与重绘\n` +
        `终端渲染的成本集中在「写下去多少格」。一帧只应处理变化过的行：视图拿新的 version 后，逐行比对 getRowVersion，把不变的行整段跳过。这一段占位文本持续增长，方便你看状态栏的 token 与耗时。\n\n`,
    )
    if (i % 6 === 0) {
      parts.push('```ts\nconst dirty = rows.filter((r) => r.rev !== lastRev.get(r.key))\nflush(dirty) // 只写变了的那几行\n```\n\n')
    }
  }
  parts.push('滚轮往上翻历史时新内容不会把视口拽回底部——这是 `autoStickToBottom` 的行为；`Ctrl+End` 可以手动跳回底部。\n')
  return parts.join('')
})()

const SCENARIO_LONG: StreamStep[] = [
  { kind: 'thinking', text: '先生成一份长文本，验证长内容下的增量重绘与滚动位置保持。' },
  { kind: 'answer', text: LONG_ANSWER },
]

const SCENARIOS = [SCENARIO_STREAM, SCENARIO_LAYOUT, SCENARIO_ERROR]

/** 真实子进程，逐行流式读取 stdout（这就是 demo 里 out: 的来源）。 */
function runCommand(cmd: RealCommand, onLine: (line: string) => void, shouldStop: () => boolean): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd.file, cmd.args, { cwd: cmd.cwd ?? process.cwd(), windowsHide: true })
    let rest = ''
    const onData = (buf: Buffer) => {
      rest += buf.toString('utf8')
      const lines = rest.split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        if (shouldStop()) return
        onLine(line)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      onLine(`spawn 失败：${err.message}`)
      resolve(1)
    })
    child.on('close', (code) => {
      if (rest && !shouldStop()) onLine(rest)
      resolve(code ?? 0)
    })
  })
}

export function createMockSession(): AgentSession {
  return {
    id: 'mock',
    kind: 'mock',
    label: 'mock 剧本',
    // 本地剧本没有服务端上下文，恢复时只还原转写（见 README 的已知边界）
    snapshot(): undefined {
      return undefined
    },
    async respond(prompt: string, ctx: TurnContext): Promise<void> {
      const steps = prompt.startsWith('/long') ? SCENARIO_LONG : SCENARIOS[(ctx.turn - 1) % SCENARIOS.length]!
      for (const step of steps) {
        if (ctx.aborted()) return
        if (step.kind === 'thinking') {
          for (const chunk of chunkText(step.text, 2)) {
            if (ctx.aborted()) return
            ctx.sink.thinkingDelta(chunk)
            await ctx.sleep(ctx.chunkDelayMs)
          }
          ctx.sink.thinkingEnd()
        } else if (step.kind === 'tool') {
          const tool = step.tool
          ctx.sink.toolStart(tool)
          if (tool.run) {
            await ctx.sleep(ctx.chunkDelayMs * 4)
            const code = await runCommand(tool.run, (line) => ctx.sink.toolLine(tool, line), ctx.aborted)
            if (ctx.aborted()) return
            ctx.sink.toolEnd(tool, code === 0 ? (tool.status ?? 'ok') : 'error')
          } else {
            for (const line of tool.output ?? []) {
              if (ctx.aborted()) return
              ctx.sink.toolLine(tool, line)
              await ctx.sleep(ctx.chunkDelayMs * 3)
            }
            ctx.sink.toolEnd(tool, tool.status ?? 'ok')
          }
        } else {
          for (const chunk of chunkText(step.text, 3)) {
            if (ctx.aborted()) return
            ctx.sink.answerDelta(chunk)
            await ctx.sleep(ctx.chunkDelayMs)
          }
        }
      }
    },
  }
}
