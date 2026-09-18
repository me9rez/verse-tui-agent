/**
 * Verse 的界面装配：终端流式 agent 的 TUI（vue-tui 渲染）。
 *
 * 版面（全屏 + alternate screen，坐标都是绝对单元格坐标）：
 *   y=0            顶栏（品牌 + 会话/模型）
 *   y=1..statusY-1 转写正文（transcript plane：流式增量只重绘这里）
 *   y=statusY      状态栏（chrome plane）
 *   y=inputY..+2   输入框（default plane，3 行含边框）
 *   y=hintY        快捷键提示
 *
 * 流式输出的落点全在 TranscriptStore：每次增量只改一行 + 自增 version，
 * <TTranscriptView> 比对每行 getRowVersion 后只重绘脏行。
 */
import { appendFileSync } from 'node:fs'
import { computed, defineComponent, h, onBeforeUnmount, reactive, ref, type PropType } from 'vue'
import { TText, TView } from '@simon_he/vue-tui'
import { TTranscriptView, TRenderPlane } from '@simon_he/vue-tui/agent'
import { TInputBox, useTerminal } from '@simon_he/vue-tui/vue'
import type { TerminalKeyboardEvent } from '@simon_he/vue-tui/runtime'
import { layoutOf } from './layout.ts'
import { HELP, HINT, NL, fitLine, stripControlChars } from './texts.ts'
import { createTurnSink, type Phase } from './turn-sink.ts'
import { createTranscriptStore, type TranscriptStore } from '../core/transcript/index.ts'
import { createMockSession } from '../agent/mockSession.ts'
import { createLiveSession } from '../agent/liveSession.ts'
import { createAiSdkSession } from '../agent/aiSdkSession.ts'
import type { AgentSession } from '../agent/session.ts'
import { describeProvider, dotEnvResult } from '../core/env.ts'
import { styles } from '../core/theme.ts'
import { APP_NAME, HEADER_LABEL } from '../core/brand.ts'
import { formatDuration, formatStamp } from '../core/text.ts'
import {
  deleteSession,
  latestSession,
  listSessions,
  loadSession,
  newSessionId,
  replaySession,
  saveSession,
  titleFromPrompt,
  type SessionKind,
  type StoredSession,
} from '../core/session/index.ts'

export type { Phase } from './turn-sink.ts'

export type AppApi = {
  submit(text: string): void
  interrupt(): void
  whenIdle(): Promise<void>
  store: TranscriptStore
  /** 全部折叠/展开，返回切换后的状态（true = 现已全部折叠） */
  toggleAll(): boolean
  /** 折叠/展开最近一个分组，返回组 id */
  toggleLast(): string | null
  /** 分组摘要（不含内容），供无头断言 */
  groups(): Array<{ id: string; kind: string; collapsed: boolean; lines: number }>
  /** 直接读终端 buffer 的行文本——smoke 用它断言「内容真的画到屏幕上了」。 */
  rowText(y: number): string
  screenText(): string[]
  state(): { phase: Phase; streaming: boolean; tokens: number; turns: number; tools: number; session: string }
  /** 当前会话能否导出上下文（透传 AgentSession.snapshot，ai 路返回消息数组） */
  sessionSnapshot(): unknown
  /** 当前会话 id（未落盘时为 null） */
  currentSessionId(): string | null
}

export const App = defineComponent({
  name: 'VerseApp',
  props: {
    sessionKind: { type: String as PropType<'mock' | 'live'>, default: 'mock' },
    /** 流式节奏倍数：1 = 演示速度，0 = 尽快跑完（smoke 用）。 */
    speed: { type: Number, default: 1 },
    autoPrompt: { type: String, default: '' },
    /** 启动时恢复哪个会话：具体 id，或 'last'（最近更新过的那个）；空 = 开新会话 */
    sessionId: { type: String, default: '' },
    onReady: { type: Function as PropType<(api: AppApi) => void>, default: undefined },
    onExit: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    const { terminal, scheduler } = useTerminal()
    const size = ref(terminal.size())
    const offResize = terminal.on('resize', () => {
      size.value = terminal.size()
      scheduler.invalidate()
    })
    onBeforeUnmount(offResize)

    const store = createTranscriptStore()
    const input = ref('')
    /** 每次提交后自增，用来换掉输入框实例（清空它的内部文本）。 */
    const composerKey = ref(0)
    const transcriptRef = ref<{ scrollToBottom?: () => void } | null>(null)
    const ui = reactive({ phase: 'idle' as Phase, streaming: false, aborted: false, startedAt: 0, elapsedMs: 0 })
    const turn = ref(0)
    const waiters: Array<() => void> = []

    const liveEnv = {
      baseUrl: process.env.VT_BASE_URL ?? '',
      model: process.env.VT_MODEL ?? '',
      apiKey: process.env.VT_API_KEY,
    }
    const canGoLive = Boolean(liveEnv.baseUrl && liveEnv.model)
    /** 三种会话：mock 剧本 / 裸 SSE / AI SDK 工具 agent（形状参照 pi） */
    const makeSession = (kind: string): AgentSession => {
      if (!canGoLive) return createMockSession()
      if (kind === 'ai') {
        return createAiSdkSession({ ...liveEnv, root: process.env.VT_AGENT_ROOT ?? process.cwd() })
      }
      if (kind === 'live') return createLiveSession(liveEnv)
      return createMockSession()
    }
    const sessionRef = ref<AgentSession>(makeSession(props.sessionKind))

    // ── 持久会话 ──────────────────────────────────────────────────────────
    /** VT_NO_PERSIST=1 时完全不动磁盘（逃生门） */
    const persist = process.env.VT_NO_PERSIST !== '1'
    /** 当前会话的磁盘状态；用容器而不是 ref：它不是渲染数据，别引多余的响应式触发 */
    const current: { session: StoredSession | null } = { session: null }

    const providerInfo = (): { host?: string; model?: string } => ({
      host: liveEnv.baseUrl ? new URL(liveEnv.baseUrl).host : undefined,
      model: liveEnv.model || undefined,
    })

    function startSession(kind: SessionKind, title = '新会话'): StoredSession {
      const now = new Date().toISOString()
      current.session = {
        v: 1,
        id: newSessionId(),
        title,
        kind,
        provider: providerInfo(),
        createdAt: now,
        updatedAt: now,
        turns: [],
      }
      return current.session
    }

    /** 切到某个会话：换会话实现 + 数据层重放 + 恢复模型上下文（agentState） */
    function openSession(target: StoredSession): void {
      current.session = target
      sessionRef.value = makeSession(target.kind)
      replaySession(target, store)
      sessionRef.value.restore?.(target.turns.at(-1)?.agentState)
      turn.value = target.turns.length
      scheduler.invalidate()
    }

    if (persist) {
      const boot =
        props.sessionId === 'last'
          ? latestSession()
          : props.sessionId
            ? loadSession(props.sessionId)
            : null
      if (boot) {
        openSession(boot)
        store.addNote(`已恢复会话 ${boot.id} · ${boot.title}（${boot.turns.length} 轮）`)
      } else {
        startSession(props.sessionKind)
      }
    }

    let timer: ReturnType<typeof setInterval> | null = null
    const startTicker = () => {
      if (timer) return
      timer = setInterval(() => {
        if (ui.streaming) ui.elapsedMs = Date.now() - ui.startedAt
      }, 200)
    }
    const stopTicker = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    onBeforeUnmount(stopTicker)

    const sleep = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)))

    /** 一轮对话：会话产出增量 → 写进 store → 视图按 version 增量重绘。 */
    async function runTurn(prompt: string): Promise<void> {
      if (ui.streaming) return
      store.addUser(prompt)
      turn.value += 1
      ui.streaming = true
      ui.aborted = false
      ui.phase = 'thinking'
      ui.startedAt = Date.now()
      ui.elapsedMs = 0
      startTicker()

      const { sink, finish, beginTurn } = createTurnSink(
        store,
        (phase) => {
          ui.phase = phase
        },
        {
          onTurnEnd(turnRec) {
            if (!persist) return
            const session = current.session ?? startSession(sessionRef.value.kind)
            session.turns.push(turnRec)
            session.updatedAt = new Date().toISOString()
            if (session.title === '新会话' && turnRec.user) session.title = titleFromPrompt(turnRec.user)
            try {
              saveSession(session)
            } catch (err) {
              store.addNote(`⚠ 会话落盘失败：${(err as Error).message}`)
            }
          },
        },
      )
      beginTurn(prompt)

      const chunkDelayMs = props.speed <= 0 ? 0 : Math.max(1, Math.round(12 * props.speed))
      try {
        await sessionRef.value.respond(prompt, {
          sink,
          aborted: () => ui.aborted,
          chunkDelayMs,
          turn: turn.value,
          sleep,
        })
      } finally {
        finish(ui.aborted, sessionRef.value.snapshot?.())
        ui.streaming = false
        ui.phase = 'idle'
        stopTicker()
        scheduler.invalidate()
        const pending = waiters.splice(0)
        for (const resolve of pending) resolve()
      }
    }

    async function handleSubmit(raw: string): Promise<void> {
      // 去掉控制字符（终端注入的键序列可能带 bracketed-paste / 残余 CR 标记）
      const cleaned = stripControlChars(raw)
      if (process.env.VT_DEBUG_INPUT === '1') {
        // 排查输入层问题时用：把原始文本按 JSON 记下来（含不可见字符）
        try {
          appendFileSync('.artifacts/input-debug.log', JSON.stringify({ raw, cleaned }) + NL, 'utf8')
        } catch {
          /* 调试用，失败无所谓 */
        }
      }
      const text = cleaned.trim()
      if (!text) return
      if (text.startsWith('/')) {
        const cmd = text.split(/\s+/)[0]
        if (cmd === '/sessions') {
          const all = listSessions()
          if (!all.length) {
            store.addNote(persist ? '还没有落盘的会话。' : '落盘已关闭（VT_NO_PERSIST=1）。')
          } else {
            const cur = current.session?.id
            const lines = all.map((one, i) => {
              const mark = one.id === cur ? '▶' : ' '
              const when = formatStamp(one.updatedAt)
              return `${mark} ${String(i + 1).padStart(2)}. ${when}  ${one.kind.padEnd(4)}  ${one.turns.length} 轮  ${one.title}`
            })
            store.addNote(['会话列表（▶ = 当前）：', ...lines, '用 /open <序号|id> 切换，/delete <序号|id> 删除'].join('\n'))
          }
        } else if (cmd === '/open' || cmd.startsWith('/open ')) {
          if (ui.streaming) {
            store.addNote('⚠ 正在跑一轮，先 Esc 中断再切换会话。')
          } else if (!persist) {
            store.addNote('落盘已关闭（VT_NO_PERSIST=1）：没有可切换的会话。')
          } else {
            const arg = raw.trim().slice(5).trim()
            const all = listSessions()
            const target = /^\d+$/.test(arg) ? all[Number(arg) - 1] : (all.find((one) => one.id === arg) ?? loadSession(arg))
            if (!target) {
              store.addNote(`没找到会话「${arg}」。用 /sessions 看列表。`)
            } else {
              openSession(target)
              store.addNote(`已切到 ${target.id} · ${target.title}（${target.turns.length} 轮）`)
            }
          }
        } else if (cmd === '/rename' || cmd.startsWith('/rename ')) {
          const wanted = raw.trim().slice(7).trim()
          if (!current.session) store.addNote('落盘已关闭（VT_NO_PERSIST=1），无处可改。')
          else if (!wanted) store.addNote(`当前会话标题：${current.session.title}。用法 /rename <新标题>`)
          else {
            current.session.title = titleFromPrompt(wanted)
            current.session.updatedAt = new Date().toISOString()
            saveSession(current.session)
            store.addNote(`标题已改为：${current.session.title}`)
          }
        } else if (cmd === '/delete' || cmd.startsWith('/delete ')) {
          const arg = raw.trim().slice(7).trim()
          const all = listSessions()
          const target = /^\d+$/.test(arg) ? all[Number(arg) - 1] : loadSession(arg)
          if (!target) store.addNote(`没找到会话「${arg}」。用 /sessions 看列表。`)
          else if (target.id === current.session?.id) store.addNote('⚠ 不能删当前会话：先 /new 或 /open 切到别的会话。')
          else {
            deleteSession(target.id)
            store.addNote(`已删除 ${target.id} · ${target.title}`)
          }
        } else if (cmd === '/new' || cmd.startsWith('/new ')) {
          const wanted = raw.trim().slice(4).trim()
          if (!persist) {
            store.addNote('落盘已关闭（VT_NO_PERSIST=1）：/new 只清空转写。')
            store.clear()
          } else {
            startSession(sessionRef.value.kind, wanted || '新会话')
            sessionRef.value = makeSession(sessionRef.value.kind)
            store.clear()
            turn.value = 0
            store.addNote(`已新建会话 ${current.session?.id ?? ''}${wanted ? ` · ${wanted}` : ''}`)
          }
        } else if (cmd === '/help') store.addNote(HELP)
        else if (cmd === '/clear') {
          store.clear()
          store.addNote('转写已清空。')
        } else if (cmd === '/exit') props.onExit?.()
        else if (cmd === '/mock') {
          sessionRef.value = createMockSession()
          store.addNote('已切回本地剧本。')
        } else if (cmd === '/live') {
          if (!canGoLive) {
            store.addNote('未配置真实端点。用 VT_BASE_URL=<.../v1> VT_MODEL=<model> 重启，或按 /help 看用法。')
          } else {
            sessionRef.value = createLiveSession(liveEnv)
            store.addNote(`已切到真实模型流：${liveEnv.model}`)
          }
        } else if (cmd === '/ai') {
          if (!canGoLive) store.addNote('未配置端点。用 VT_BASE_URL=<.../v1> VT_MODEL=<model> 重启。')
          else {
            sessionRef.value = makeSession('ai')
            store.addNote(`已切到 AI SDK 工具 agent：${liveEnv.model}（工具循环上限 8 步）`)
          }
        } else if (cmd === '/fold') {
          const collapsed = store.toggleAllGroups()
          store.addNote(collapsed ? '已折叠全部分组（Ctrl+O 展开）' : '已展开全部分组（Ctrl+O 折叠）')
        } else if (cmd === '/env') {
          const p = describeProvider()
          const dot = dotEnvResult()
          for (const line of [
            `provider  ${p.baseUrl} · model ${p.model} · key ${p.hasKey ? '已设置(不回显)' : '未设置'}`,
            `agent 工作区  ${p.agentRoot}`,
            `.env  ${dot.files.length ? `${dot.files.join(' + ')}（带入 ${dot.keys.length} 个键：${dot.keys.join(', ')}）` : '未发现（可复制 .env.example）'}`,
          ]) store.addNote(line)
        } else if (cmd === '/long') {
          void runTurn('/long')
          return
        } else {
          store.addNote(`未知命令：${cmd}（试试 /help）`)
        }
        scheduler.invalidate()
        return
      }
      void runTurn(text)
    }

    /** 点击/回车落在某一行：是分组头部就折叠切换 */
    function toggleRowAt(rowIndex: number | undefined): boolean {
      if (rowIndex === undefined || rowIndex < 0) return false
      const entry = store.entryAt(rowIndex)
      if (!entry?.group) return false
      store.toggleGroup(entry.group)
      scheduler.invalidate()
      return true
    }

    function onKey(event: TerminalKeyboardEvent): void {
      if (event.key === 'Escape' && ui.streaming) {
        event.preventDefault()
        ui.aborted = true
        return
      }
      if (event.key === 'End' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        transcriptRef.value?.scrollToBottom?.()
        return
      }
      if (event.ctrlKey && !event.shiftKey && (event.key === 'o' || event.key === 'O')) {
        event.preventDefault()
        store.toggleAllGroups()
        scheduler.invalidate()
        return
      }
      if (event.ctrlKey && !event.shiftKey && (event.key === 't' || event.key === 'T')) {
        event.preventDefault()
        store.toggleLastGroup()
        scheduler.invalidate()
        return
      }
      if (event.ctrlKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault()
        props.onExit?.()
      }
    }

    const phaseText = computed(() => {
      if (ui.phase === 'thinking') return '✻ Thinking…'
      if (ui.phase === 'tool') return '● Running tool…'
      if (ui.phase === 'answering') return '✻ Streaming…'
      return '✻ ready'
    })

    const statusLine = computed(() => {
      const cols = size.value.cols
      const stats = { ...store.stats.value, tokens: store.estimateTokens() }
      const right = [
        sessionRef.value.label,
        `${stats.tokens} tok`,
        `${stats.tools} tools`,
        ui.streaming ? formatDuration(ui.elapsedMs) : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const left = `${phaseText.value}${ui.streaming ? '  (Esc 中断)' : ''}`
      return fitLine(cols, left, right)
    })

    const api: AppApi = {
      submit: (text: string) => void handleSubmit(text),
      interrupt: () => {
        if (ui.streaming) ui.aborted = true
      },
      whenIdle: () => (ui.streaming ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve()),
      store,
      toggleAll: () => {
        const next = store.toggleAllGroups()
        scheduler.invalidate()
        return next
      },
      toggleLast: () => {
        const id = store.toggleLastGroup()
        scheduler.invalidate()
        return id
      },
      groups: () =>
        store.groupSummary().map((g) => ({ id: g.id, kind: g.kind, collapsed: g.collapsed, lines: g.lines })),
      rowText: (y: number) =>
        terminal
          .getRow(y)
          .map((cell) => cell.ch)
          .join('')
          .trimEnd(),
      screenText: () => Array.from({ length: size.value.rows }, (_, y) => api.rowText(y)),
      state: () => ({
        phase: ui.phase,
        streaming: ui.streaming,
        tokens: store.estimateTokens(),
        turns: store.stats.value.turns,
        tools: store.stats.value.tools,
        session: sessionRef.value.id,
      }),
      sessionSnapshot: () => sessionRef.value.snapshot?.(),
      currentSessionId: () => current.session?.id ?? null,
    }

    if (props.autoPrompt) setTimeout(() => api.submit(props.autoPrompt), 30)
    setTimeout(() => props.onReady?.(api), 0)

    return () => {
      const cols = size.value.cols
      const l = layoutOf(size.value.rows)
      // 关键：在分支之前先读一次 version，让整个渲染函数成为它的依赖。
      // 否则「空态」那一支不读任何响应式值，视图永远不会被唤醒去渲染正文。
      const version = store.version.value
      const header = fitLine(cols, HEADER_LABEL, sessionRef.value.label)
      const empty = store.rowCount() === 0

      return h(TView, { x: 0, y: 0, w: cols, h: size.value.rows, onKeydownCapture: onKey }, () => [
        h(TRenderPlane, { plane: 'chrome', key: 'header' }, () => [
          h(TText, { x: 1, y: l.headerY, w: cols - 2, h: 1, value: header, style: styles.header }),
        ]),
        h(TRenderPlane, { plane: 'transcript', key: 'body' }, () =>
          empty
            ? [
                h(TText, {
                  x: 2,
                  y: l.transcriptY + 1,
                  w: Math.max(10, cols - 4),
                  h: l.transcriptH - 2,
                  wrap: true,
                  style: styles.toolSummary,
                  value: [
                    `${APP_NAME} · 用 vue-tui 搭的终端流式 agent demo。`,
                    '',
                    '输入一句话回车，就能看到完整链路：思考流 → 真实执行的工具调用 → 增量 markdown 正文。',
                    '',
                    '试试 /long 看长文本滚动，Esc 中断一轮，Ctrl+C 退出。',
                  ].join('\n'),
                }),
              ]
            : [
                h(TTranscriptView, {
                  ref: transcriptRef,
                  x: 0,
                  y: l.transcriptY,
                  w: cols,
                  h: l.transcriptH,
                  source: store,
                  version,
                  autoStickToBottom: true,
                  wheelScroll: true,
                  selectable: true,
                  wrap: true,
                  keyboardRegions: true,
                  // 注意：rowIndex 是**可见行**索引，必须走 entryAt()（折叠后 entries[] 与可见行不再一一对应）
                  onFoldToggle: (payload: { rowIndex?: number }) => toggleRowAt(payload?.rowIndex),
                  onToolClick: (payload: { rowIndex?: number }) => toggleRowAt(payload?.rowIndex),
                  onRowClick: (payload: { rowIndex?: number }) => toggleRowAt(payload?.rowIndex),
                }),
              ],
        ),
        h(TRenderPlane, { plane: 'chrome', key: 'status' }, () => [
          h(TText, { x: 1, y: l.statusY, w: cols - 2, h: 1, value: statusLine.value, style: styles.status }),
        ]),
        h(TRenderPlane, { plane: 'default', key: 'input' }, () => [
          h(TInputBox, {
            // TInputBox 不暴露 clear()/focus()，内部文本是它自己持有的；
            // 提交后用 key 换一个新实例才是真正的"清空输入框"（否则下次输入会拼在旧文本后面）。
            key: composerKey.value,
            x: 0,
            y: l.inputY,
            w: cols,
            h: 3,
            title: ' 输入消息 · Enter 发送 ',
            modelValue: input.value,
            'onUpdate:modelValue': (v: string) => {
              input.value = v
            },
            onChange: (v: string) => {
              input.value = ''
              composerKey.value += 1
              void handleSubmit(String(v ?? ''))
            },
            autoFocus: true,
          }),
        ]),
        h(TRenderPlane, { plane: 'chrome', key: 'hint' }, () => [
          h(TText, { x: 1, y: l.hintY, w: cols - 2, h: 1, value: HINT, style: styles.hint }),
        ]),
      ])
    }
  },
})
