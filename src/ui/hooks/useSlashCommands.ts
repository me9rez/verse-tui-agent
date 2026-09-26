/**
 * 命令域：slash 命令的分发与实现（texts.COMMANDS 是命令表的唯一数据源，这里只实现行为）。
 *
 * 逐条照抄原 App.ts 的 if-else 链：判定（=== / startsWith）、参数取值表达式
 * （raw vs raw.trim()、slice(n) 的 n）、每个分支的文案都不动 —— 分区只把分支体抽成有名函数。
 */
import { DEFAULT_RPC_URL, effectiveConfig, getBoot } from '../../core/config.ts'
import { formatStamp } from '../../core/text.ts'
import { getBackendModel } from '../../session/model.ts'
import {
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
  titleFromPrompt,
} from '../../session/persist/index.ts'
import { HELP } from '../texts.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { EffortControl } from './useEffortControl.ts'
import type { ModelControl } from './useModelControl.ts'
import type { SessionController } from './useSessionController.ts'
import type { TurnRuntime, TurnUi } from './useTurnRuntime.ts'

export type SlashRouter = Readonly<{
  /** 处理 '/' 开头的提交；内部会在收尾时重绘（/long 例外，它起一轮由轮次域重绘） */
  tryHandle(raw: string, cleaned: string): void
}>

export type SlashDeps = Readonly<{
  store: TranscriptStore
  session: SessionController
  ui: TurnUi
  turn: TurnRuntime
  model: ModelControl
  effort: EffortControl
  invalidate(): void
  onExit?(): void
  /** 三个选择器互斥：打开一个时关掉另外两个 */
  closeOtherPickers(keep: 'model' | 'effort' | 'session'): void
}>

export function useSlashCommands(deps: SlashDeps): SlashRouter {
  const { store, session, ui, turn, model, effort, invalidate, closeOtherPickers } = deps

  /** /sessions：列出落盘会话（▶ = 当前）；没有就按落盘开关给不同提示 */
  function cmdSessions(): void {
    const all = listSessions()
    if (!all.length) {
      store.addNote(session.persist ? '还没有落盘的会话。' : '落盘已关闭（tui.toml persist=false）。')
      return
    }
    const cur = session.current.session?.id
    const lines = all.map((one, i) => {
      const mark = one.id === cur ? '▶' : ' '
      const when = formatStamp(one.updatedAt)
      return `${mark} ${String(i + 1).padStart(2)}. ${when}  ${one.kind.padEnd(4)}  ${one.turns.length} 轮  ${one.title}`
    })
    store.addNote(['会话列表（▶ = 当前）：', ...lines, '用 /open <序号|id> 切换，/delete <序号|id> 删除'].join('\n'))
  }

  /** /open：无参弹选择器（空列表回退提示），带序号/id 直接切 */
  function cmdOpen(raw: string): void {
    if (ui.streaming) {
      store.addNote('⚠ 正在跑一轮，先 Esc 中断再切换会话。')
    } else if (!session.persist) {
      store.addNote('落盘已关闭（tui.toml persist=false）：没有可切换的会话。')
    } else {
      const arg = raw.trim().slice(5).trim()
      if (!arg) {
        const all = listSessions()
        if (!all.length) {
          store.addNote('还没有落盘的会话：/new 新建一个，落盘后即可用选择器切换。')
        } else {
          session.pickerItems.value = session.buildSessionItems(all)
          const ci = all.findIndex((s) => s.id === session.current.session?.id)
          session.pickerSelIdx.value = ci >= 0 ? ci : 0
          model.pickerOpen.value = false // 与拆分前一致：/open 只关模型选择器
          session.pickerOpen.value = true
        }
      } else {
        const all = listSessions()
        const target = /^\d+$/.test(arg) ? all[Number(arg) - 1] : (all.find((one) => one.id === arg) ?? loadSession(arg))
        if (!target) {
          store.addNote(`没找到会话「${arg}」。用 /sessions 看列表。`)
        } else {
          session.switchToSession(target)
        }
      }
    }
  }

  /** /rename <标题>：改标题并落盘（无参回显当前标题） */
  function cmdRename(raw: string): void {
    const wanted = raw.trim().slice(7).trim()
    if (!session.current.session) store.addNote('落盘已关闭（tui.toml persist=false），无处可改。')
    else if (!wanted) store.addNote(`当前会话标题：${session.current.session.title}。用法 /rename <新标题>`)
    else {
      session.current.session.title = titleFromPrompt(wanted)
      session.current.session.updatedAt = new Date().toISOString()
      saveSession(session.current.session)
      store.addNote(`标题已改为：${session.current.session.title}`)
    }
  }

  /** /delete <序号|id>：删掉别的会话（不能删当前） */
  function cmdDelete(raw: string): void {
    const arg = raw.trim().slice(7).trim()
    const all = listSessions()
    const target = /^\d+$/.test(arg) ? all[Number(arg) - 1] : loadSession(arg)
    if (!target) store.addNote(`没找到会话「${arg}」。用 /sessions 看列表。`)
    else if (target.id === session.current.session?.id) store.addNote('⚠ 不能删当前会话：先 /new 或 /open 切到别的会话。')
    else {
      deleteSession(target.id)
      store.addNote(`已删除 ${target.id} · ${target.title}`)
    }
  }

  /** /new [标题]：新建空会话（落盘关闭时只清空转写） */
  function cmdNew(raw: string): void {
    const wanted = raw.trim().slice(4).trim()
    if (!session.persist) {
      store.addNote('落盘已关闭（tui.toml persist=false）：/new 只清空转写。')
      store.clear()
    } else {
      session.resetSession(session.sessionRef.value.kind, wanted || '新会话')
      store.addNote(`已新建会话 ${session.current.session?.id ?? ''}${wanted ? ` · ${wanted}` : ''}`)
    }
  }

  /** /model [id]：无参弹选择器（守卫在模型域），带 id 直切 */
  async function cmdModel(raw: string): Promise<void> {
    const arg = raw.trim().slice(6).trim()
    if (!arg) {
      await model.openPicker(() => closeOtherPickers('model'))
    } else {
      await model.applySwitch(arg)
    }
  }

  /** /effort [档位]：无参弹选择器，带档位直切 */
  async function cmdEffort(raw: string): Promise<void> {
    const arg = raw.trim().slice(7).trim()
    if (!arg) {
      await effort.openPicker(() => closeOtherPickers('effort'))
    } else {
      await effort.applySwitch(arg)
    }
  }

  /** /env：配置展示的唯一来源（gateway 的 config/get 脱敏视图 + 实际读到的 toml） */
  function cmdEnv(): void {
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
  }

  /** 分发：判定与顺序照抄原实现；末尾统一重绘（/long 提前 return，由轮次域重绘） */
  function tryHandle(raw: string, cleaned: string): void {
    const cmd = cleaned.split(/\s+/)[0]
    if (cmd === '/sessions') cmdSessions()
    else if (cmd === '/open' || cmd.startsWith('/open ')) cmdOpen(raw)
    else if (cmd === '/rename' || cmd.startsWith('/rename ')) cmdRename(raw)
    else if (cmd === '/delete' || cmd.startsWith('/delete ')) cmdDelete(raw)
    else if (cmd === '/new' || cmd.startsWith('/new ')) cmdNew(raw)
    else if (cmd === '/help') store.addNote(HELP)
    else if (cmd === '/clear') {
      store.clear()
      store.addNote('转写已清空。')
    } else if (cmd === '/exit') deps.onExit?.()
    else if (cmd === '/mock') {
      session.switchKind('mock')
      store.addNote('已切回本地剧本。')
    } else if (cmd === '/rpc') {
      session.switchKind('rpc')
      const g = effectiveConfig().gateway
      store.addNote(
        `已切到远端 harness 后端：ws://${g.host}:${g.port}（历史在服务端落盘）`,
      )
    } else if (cmd === '/fold') {
      const collapsed = store.toggleAllGroups()
      store.addNote(collapsed ? '已折叠全部分组（Ctrl+O 展开）' : '已展开全部分组（Ctrl+O 折叠）')
    } else if (cmd === '/model' || cmd.startsWith('/model ')) {
      void cmdModel(raw)
    } else if (cmd === '/effort' || cmd.startsWith('/effort ')) {
      void cmdEffort(raw)
    } else if (cmd === '/env') {
      cmdEnv()
    } else if (cmd === '/long') {
      void turn.runTurn('/long')
      return
    } else {
      store.addNote(`未知命令：${cmd}（试试 /help）`)
    }
    invalidate()
  }

  return { tryHandle }
}
