/**
 * Verse 的界面装配：终端流式 agent 的 TUI（vue-tui 渲染）。
 *
 * 版面（全屏 + alternate screen，坐标都是绝对单元格坐标）：
 *   y=0..divider-1  空态：欢迎块（版本边框 + 像素 logo + model/cwd + Tips）+ 空态提示；
 *                   有内容：转写正文（transcript plane：流式增量只重绘这里）
 *   y=dividerY      分割线
 *   y=inputY        输入行（> 前缀 + 无边框 TInput + 占位符，overlay plane——补全弹窗同平面）
 *   y=statusY       状态栏（phase · 模式 · 模型 · cwd / 会话 · tok · tools）
 *
 * 流式输出的落点全在 TranscriptStore：每次增量只改一行 + 自增 version，
 * <TTranscriptView> 比对每行 getRowVersion 后只重绘脏行。
 */
import { appendFileSync } from 'node:fs'
import { computed, defineComponent, h, onBeforeUnmount, reactive, ref, type PropType } from 'vue'
import { TCommandPalette, TText, TView, type TCommandPaletteItem } from '@simon_he/vue-tui'
import { TTranscriptView, TRenderPlane } from '@simon_he/vue-tui/agent'
import { TBox, TInput, createPromptMentionPlugin, useTerminal } from '@simon_he/vue-tui/vue'
import type { TerminalKeyboardEvent } from '@simon_he/vue-tui/runtime'
import { layoutOf } from './layout.ts'
import { COMMANDS, EMPTY_NOTE, HELP, NL, PLACEHOLDER, stripControlChars } from './texts.ts'
import { createTurnSink, type Phase } from '../session/sink.ts'
import { createTranscriptStore, type TranscriptStore } from '../transcript/index.ts'
import { createMockSession } from '../session/mock.ts'
import { createRpcSession } from '../session/rpc.ts'
import { getBackendModel, onBackendModel } from '../session/model.ts'
import { onBackendMode } from '../session/mode.ts'
import type { AgentSession } from '../session/seam.ts'
import { DEFAULT_RPC_URL, effectiveConfig, getBoot } from '../core/config.ts'
import { styles } from '../core/theme.ts'
import { APP_ART, APP_VERSION } from '../core/brand.ts'
import { cellWidth, formatDuration, formatStamp } from '../core/text.ts'
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
} from '../session/persist/index.ts'

export type { Phase } from '../session/sink.ts'

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
    sessionKind: { type: String as PropType<'mock' | 'rpc'>, default: 'mock' },
    /** 流式节奏倍数：1 = 演示速度，0 = 尽快跑完（smoke 用）。 */
    speed: { type: Number, default: 1 },
    autoPrompt: { type: String, default: '' },
    /** 启动时恢复哪个会话：具体 id，或 'last'（最近更新过的那个）；空 = 开新会话 */
    sessionId: { type: String, default: '' },
    /** false 时完全不动磁盘（测试与 tui.toml persist=false 走这里） */
    persist: { type: Boolean, default: true },
    /** 原始提交文本按 JSON 记入 .artifacts/input-debug.log（tui.toml debug_input / --debug-input） */
    debugInput: { type: Boolean, default: false },
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

    // ── slash 命令补全 ──────────────────────────────────────────────
    // 建议与 /help 同源（texts.COMMANDS）；触发字符 '/'，模糊匹配 cmd。
    // plugins 数组必须是稳定引用：TInput 的 plugins 是 init-only，
    // 每帧传新数组字面量会触发 "plugins is init-only" 警告，警告会打进真实终端。
    const promptPlugins = [createPromptMentionPlugin()] as const
    const promptSuggestions = COMMANDS.map((c) => ({
      value: c.cmd,
      detail: c.usage ? `${c.usage} ${c.desc}` : c.desc,
      keywords: [c.cmd.slice(1)],
    }))
    const transcriptRef = ref<{ scrollToBottom?: () => void } | null>(null)
    const ui = reactive({ phase: 'idle' as Phase, streaming: false, aborted: false, startedAt: 0, elapsedMs: 0 })
    const turn = ref(0)
    const waiters: Array<() => void> = []

    /** 两种会话：rpc（唯一 agent 后端，py/Agent Framework）/ mock（离线剧本夹具） */
    const makeSession = (kind: string): AgentSession =>
      kind === 'rpc' ? createRpcSession() : createMockSession()
    const sessionRef = ref<AgentSession>(makeSession(props.sessionKind))

    /** 后端 model id：握手 initialize 回填 + /model 切换后更新（权威来源是后端，不是环境变量） */
    const backendModel = ref('')
    onBackendModel((m) => {
      backendModel.value = m
    })
    /** 欢迎块/状态栏显示的 model：rpc = 后端确认的 id（没连上显示「连接后端中…」）；mock = 离线剧本 */
    const displayModel = computed(() =>
      sessionRef.value.kind === 'rpc'
        ? backendModel.value || '连接后端中…'
        : '离线剧本',
    )

    /** harness 模式（plan/execute）：mode/get 回填 + Shift+Tab 切换后更新 */
    const harnessMode = ref('')
    onBackendMode((m) => {
      harnessMode.value = m
    })

    /** Shift+Tab：plan ↔ execute。切换目标取自后端回填的当前值（没握手过按默认 plan）。 */
    async function toggleHarnessMode(): Promise<void> {
      if (sessionRef.value.kind !== 'rpc') {
        store.addNote('mock 是离线剧本，没有 harness 模式；/rpc 切到后端后用 Shift+Tab 切换 plan/execute。')
        return
      }
      if (ui.streaming) {
        store.addNote('⚠ 本轮还在跑，结束再切模式。')
        return
      }
      const target = harnessMode.value === 'execute' ? 'plan' : 'execute'
      try {
        const next = await sessionRef.value.setMode?.(target)
        if (!next) {
          store.addNote('后端不支持 mode/set（需要更新 rpc_server.py）。')
          return
        }
        store.addNote(
          next === 'plan'
            ? '已切换到 plan 模式：只做规划/澄清、请求批准后再执行（状态栏可见，下一轮生效）。'
            : '已切换到 execute 模式：harness 自主执行（下一轮生效，[Mode changed] 通知会注入该轮）。',
        )
      } catch (err) {
        store.addNote(`切换模式失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── /model 模型选择器 ────────────────────────────────────────────────
    /** 选择器开关 + 受控高亮索引：TCommandPalette 的 selectedIndex 是受控 prop
     *  （源码读 props.selectedIndex ?? inner，只传静态值会冻结 ↑↓），必须双向绑。 */
    const modelPickerOpen = ref(false)
    const modelSelIdx = ref(0)
    /** 条目 = gateway config/get 下发的 [models] 别名（与文本路径 model/set 同一语义）。 */
    const modelItems = computed<TCommandPaletteItem[]>(() => {
      const cur = backendModel.value || effectiveConfig().default_model
      return effectiveConfig().models.map((m) => ({
        label: m.alias,
        // detail 只留 display_name（+当前标记）：provider 已在别名里，原始 id /env 可查——
        // 曾拼 ' · provider/model' 整条原始 id，行太长右列被截断（2026-09-24 截图反馈）
        detail: `${m.display_name || m.model}${m.alias === cur ? '（当前）' : ''}`,
        value: m.alias,
        keywords: [m.model, m.provider],
      }))
    })
    /** 选择器宽度自适应：最长一行（label + 2 格间隙 + detail）+ 6 格内边距，防右列截断。 */
    function modelRowWidth(): number {
      const list = modelItems.value
      if (!list.length) return 30
      const widest = Math.max(
        ...list.map((it) => cellWidth(String(it.label)) + 2 + cellWidth(String(it.detail ?? ''))),
      )
      return widest + 6
    }
    /** 打开选择器前把高亮预置到当前模型。 */
    function currentModelIndex(): number {
      const cur = backendModel.value || effectiveConfig().default_model
      const i = modelItems.value.findIndex((m) => m.value === cur)
      return i >= 0 ? i : 0
    }
    /** /model 切换的共用实现：选择器 Enter 与 /model <id> 文本路径走同一套守卫、调用与文案。 */
    async function applyModelSwitch(id: string): Promise<void> {
      if (sessionRef.value.kind !== 'rpc') {
        store.addNote('当前是 mock 剧本，没有模型可切；/rpc 切到后端后再用 /model <id>。')
        return
      }
      if (ui.streaming) {
        store.addNote('⚠ 本轮还在跑，等结束再切换模型。')
        return
      }
      try {
        const next = await sessionRef.value.setModel?.(id)
        if (!next) store.addNote('后端不支持 model/set（需要更新 rpc_server.py）。')
        else
          store.addNote(
            `模型已切换为 ${next}：服务端后续轮次生效；plan/todos 随 harness 重建重置，对话历史仍在磁盘。`,
          )
      } catch (err) {
        store.addNote(`切换失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── 持久会话 ──────────────────────────────────────────────────────────
    /** props.persist=false 时完全不动磁盘（tui.toml persist=false / 测试注入） */
    const persist = props.persist
    /** 当前会话的磁盘状态；用容器而不是 ref：它不是渲染数据，别引多余的响应式触发 */
    const current: { session: StoredSession | null } = { session: null }

    const providerInfo = (kind: SessionKind): { host?: string; model?: string } => {
      if (kind !== 'rpc') return {} // mock 是离线剧本，没有 provider
      // host/model 都来自 gateway 的 config/get（provider 名字级信息，不存密钥）
      const g = effectiveConfig().gateway
      return { host: `${g.host}:${g.port}`, model: backendModel.value || effectiveConfig().default_model }
    }

    function startSession(kind: SessionKind, title = '新会话'): StoredSession {
      const now = new Date().toISOString()
      current.session = {
        v: 1,
        id: newSessionId(),
        title,
        kind,
        provider: providerInfo(kind),
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
      if (props.debugInput) {
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
            store.addNote(persist ? '还没有落盘的会话。' : '落盘已关闭（tui.toml persist=false）。')
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
            store.addNote('落盘已关闭（tui.toml persist=false）：没有可切换的会话。')
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
          if (!current.session) store.addNote('落盘已关闭（tui.toml persist=false），无处可改。')
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
            store.addNote('落盘已关闭（tui.toml persist=false）：/new 只清空转写。')
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
        } else if (cmd === '/rpc') {
          sessionRef.value = makeSession('rpc')
          const g = effectiveConfig().gateway
          store.addNote(
            `已切到远端 harness 后端：ws://${g.host}:${g.port}（历史在服务端落盘）`,
          )
        } else if (cmd === '/fold') {
          const collapsed = store.toggleAllGroups()
          store.addNote(collapsed ? '已折叠全部分组（Ctrl+O 展开）' : '已展开全部分组（Ctrl+O 折叠）')
        } else if (cmd === '/model' || cmd.startsWith('/model ')) {
          const arg = raw.trim().slice(6).trim()
          if (!arg) {
            // 无参 = 弹模型选择器（rpc 且 [models] 非空才弹；否则回退提示）
            if (sessionRef.value.kind !== 'rpc') {
              store.addNote(`当前模型：${displayModel.value}（mock 剧本无模型）`)
            } else if (ui.streaming) {
              store.addNote('⚠ 本轮还在跑，等结束再切换模型。')
            } else if (!modelItems.value.length) {
              store.addNote(`当前模型：${displayModel.value}（config.toml [models] 为空，可用 /model <id> 直切）`)
            } else {
              modelSelIdx.value = currentModelIndex()
              modelPickerOpen.value = true
            }
          } else {
            await applyModelSwitch(arg)
          }
        } else if (cmd === '/env') {
          // 配置展示的唯一来源：gateway 的 config/get（脱敏视图 + 实际读到的 toml）
          const b = getBoot()
          const c = effectiveConfig()
          if (!b) store.addNote(`gateway 未连接（${DEFAULT_RPC_URL}）：以下为内置默认；--url 可改地址。`)
          for (const line of [
            `gateway  ${c.gateway.host}:${c.gateway.port} · model ${getBackendModel() || c.default_model} · key 由后端持有（前端不接触）`,
            `providers  ${c.providers.map((p) => `${p.name}(${p.type}) key ${p.api_key || '未设'}`).join(' · ') || '（无）'}`,
            `agent 工作区  ${c.gateway.workspace || '(后端默认 <repo>/.agent-sandbox)'}`,
            `tui  agent=${c.tui.agent} speed=${c.tui.speed} persist=${c.tui.persist}${c.tui.session_dir ? ` · session_dir=${c.tui.session_dir}` : ''}`,
            `配置文件  ${b ? (b.sources.length ? b.sources.join(' + ') : '无（全部默认值）') : '(未取到)'}`,
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
      // Shift+Tab：切 harness 的 plan/execute 模式（终端把 \x1b[Z 报成 BackTab；
      // 合成事件可能给 Tab+shiftKey，两种都接）。放在输入框 Tab(采用补全)之前没冲突：
      // 补全弹窗打开时 Tab 带 shift 同样视为切模式。
      if (
        event.key === 'BackTab' ||
        event.key === 'ISO_Left_Tab' ||
        ((event.key === 'Tab' || event.key === '\t') && event.shiftKey)
      ) {
        event.preventDefault()
        void toggleHarnessMode()
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

    const statusSegs = computed(() => {
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
      const mode = sessionRef.value.kind === 'rpc' ? 'rpc' : 'mock'
      const model = displayModel.value
      const parts = [
        { text: `${phaseText.value}${ui.streaming ? '  (Esc 中断)' : ''}`, style: ui.streaming ? styles.statusActive : styles.statusOk },
        { text: ' · ', style: styles.faint },
        { text: mode, style: styles.tipCmd },
        // harness 模式段（仅 rpc）：plan 高亮提醒「只规划不动手」，execute 用普通蓝
        ...(mode === 'rpc' && harnessMode.value
          ? [
              { text: ' · ', style: styles.faint },
              {
                text: harnessMode.value,
                style: harnessMode.value === 'plan' ? styles.statusActive : styles.tipCmd,
              },
            ]
          : []),
        { text: ' · ', style: styles.faint },
        { text: model, style: styles.infoValue },
        { text: ' · ', style: styles.faint },
        { text: process.cwd(), style: styles.faint },
      ]
      // 窄终端从右往左丢段（先丢 cwd，再丢模型），保证状态栏不换行不溢出
      const rightW = cellWidth(right)
      const widthOf = (list: typeof parts): number => list.reduce((n, p) => n + cellWidth(p.text), 0)
      while (parts.length > 1 && widthOf(parts) + rightW + 3 > cols - 2) {
        parts.pop() // cwd/model 段
        if (parts.at(-1)?.text === ' · ') parts.pop()
      }
      return { parts, right }
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
      const empty = store.rowCount() === 0

      // 欢迎块几何：边框2 + logo 区 + 空行 + Tips 标签与3条（child y0..11 → 内框12行）
      const boxH = 14
      const showWelcome = empty && l.transcriptH >= boxH + 1
      const tipCmds = ['/rpc', '/sessions', '/help']

      return h(TView, { x: 0, y: 0, w: cols, h: size.value.rows, onKeydownCapture: onKey }, () => [
        h(TRenderPlane, { plane: 'transcript', key: 'body' }, () =>
          empty
            ? [
                // ── 欢迎块（step 风格）：版本边框 + 像素 logo + model/cwd + Tips ──
                // 内容必须是 TBox 的 children（兄弟节点会被盒体自身的填充覆盖）；child 坐标相对内框。
                ...(showWelcome
                  ? [
                      h(
                        TBox,
                        {
                          x: 0,
                          y: 0,
                          w: cols,
                          h: boxH,
                          border: true,
                          title: ` ${APP_VERSION} `,
                          padding: 0,
                          style: styles.divider,
                        },
                        () => [
                          // 像素 logo（紫色）
                          ...APP_ART.map((line, i) =>
                            h(TText, { x: 1, y: i, w: 12, h: 1, value: line, style: styles.logo }),
                          ),
                          // 右侧信息：label 灰、value 蓝（值列对齐）
                          h(TText, { x: 15, y: 1, w: 6, h: 1, value: 'model', style: styles.infoLabel }),
                          h(TText, {
                            x: 22,
                            y: 1,
                            w: Math.max(8, cols - 25),
                            h: 1,
                            value: displayModel.value,
                            style: styles.infoValue,
                          }),
                          h(TText, { x: 15, y: 2, w: 4, h: 1, value: 'cwd', style: styles.infoLabel }),
                          h(TText, { x: 22, y: 2, w: Math.max(8, cols - 25), h: 1, value: process.cwd(), style: styles.infoValue }),
                          // Tips：命令蓝、说明灰（desc 与 /help 同源 COMMANDS）
                          h(TText, { x: 1, y: 8, w: 8, h: 1, value: 'Tips', style: styles.infoLabel }),
                          ...tipCmds.flatMap((cmd, i) => {
                            const item = COMMANDS.find((c) => c.cmd === cmd)
                            if (!item) return []
                            return [
                              h(TText, { x: 1, y: 9 + i, w: 12, h: 1, value: cmd, style: styles.tipCmd }),
                              h(TText, { x: 13, y: 9 + i, w: Math.max(8, cols - 16), h: 1, value: item.desc, style: styles.tipDesc }),
                            ]
                          }),
                        ],
                      ),
                    ]
                  : []),
                h(TText, {
                  x: 2,
                  y: boxH + 1,
                  w: Math.max(10, cols - 4),
                  h: 1,
                  style: styles.faint,
                  value: EMPTY_NOTE,
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
        h(TRenderPlane, { plane: 'chrome', key: 'status' }, () => {
          const { parts, right } = statusSegs.value
          const rightW = cellWidth(right)
          let x = 1
          const nodes = parts.map((p) => {
            const w = cellWidth(p.text)
            const node = h(TText, { x, y: l.statusY, w, h: 1, value: p.text, style: p.style })
            x += w
            return node
          })
          nodes.push(
            h(TText, {
              x: Math.max(x + 1, cols - 1 - rightW),
              y: l.statusY,
              w: rightW + 1,
              h: 1,
              value: right,
              style: styles.status,
            }),
          )
          return nodes
        }),
        h(TRenderPlane, { plane: 'chrome', key: 'divider' }, () => [
          h(TText, { x: 0, y: l.dividerY, w: cols, h: 1, value: '─'.repeat(cols), style: styles.divider }),
        ]),
        // 输入行 = '>' 前缀 + 无边框 TInput + 占位符（step 风格）。
        // 必须在 'overlay' plane：补全弹窗画在 zIndex 1e4 的 overlay 栈，
        // 挂普通 plane/root 会被逐帧合并吃掉（实测 7 槽只剩 1 行）。
        h(TRenderPlane, { plane: 'overlay', key: 'input' }, () => [
          h(TText, { x: 1, y: l.inputY, w: 2, h: 1, value: '>', style: styles.prefix }),
          h(TInput, {
            // 提交后用 key 换一个新实例才是真正的"清空输入框"（否则下次输入会拼在旧文本后面）。
            key: composerKey.value,
            x: 3,
            y: l.inputY,
            w: Math.max(4, cols - 4),
            h: 1,
            modelValue: input.value,
            'onUpdate:modelValue': (v: string) => {
              input.value = v
            },
            onChange: (v: string) => {
              input.value = ''
              composerKey.value += 1
              void handleSubmit(String(v ?? ''))
            },
            placeholder: PLACEHOLDER,
            placeholderWhenFocused: true,
            style: styles.text,
            autoFocus: true,
            plugins: promptPlugins,
            promptSuggestions,
            promptTrigger: '/',
            promptMaxItems: 8,
            promptAlign: 'input',
          }),
          // /model 选择器：与输入行同挂 overlay plane（挂普通 plane 会被逐帧合并吃掉）。
          // 内部是 TDialog placement:center，居中弹窗；内部输入自带 autoFocus 抢焦点。
          h(TCommandPalette, {
            modelValue: modelPickerOpen.value,
            'onUpdate:modelValue': (v: boolean) => {
              modelPickerOpen.value = v
            },
            title: '选择模型',
            placeholder: '输入过滤…',
            hint: '↑↓ 选择 · Enter 切换 · Esc 取消',
            items: modelItems.value,
            showRowDetails: true,
            closeOnSelect: true,
            resetQueryOnClose: true,
            maxVisibleItems: 8,
            w: Math.max(30, Math.min(cols - 4, modelRowWidth())),
            h: Math.max(8, 7 + Math.min(modelItems.value.length, 8)),
            selectedIndex: modelSelIdx.value,
            'onUpdate:selectedIndex': (i: number) => {
              modelSelIdx.value = i
            },
            onSelect: (p: { item: TCommandPaletteItem }) => {
              void applyModelSwitch(String(p.item.value))
            },
          }),
        ]),
      ])
    }
  },
})
