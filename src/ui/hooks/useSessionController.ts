/**
 * 会话域：会话实现（mock 剧本 / rpc 后端）的持有与切换、落盘会话的恢复/重放/切换、
 * 轮序（当前会话第几轮）、以及 /open 选择器的三元组。
 *
 * 与「运行时 AgentSession」和「落盘 StoredSession」都打交道，所以这里的每个出口都尽量
 * 保持 App 原有的命名与语义（App 只解构，不改调用点）：
 *   sessionRef / turnIndex / current / startSession / openSession / switchToSession / persistTurn
 *
 * 纯搬迁自原 App.ts 的「持久会话」段：语义、文案、落盘时机都不动。
 */
import { ref, type Ref } from 'vue'
import type { TCommandPaletteItem } from '@simon_he/vue-tui'
import { createMockSession } from '../../session/mock.ts'
import { createRpcSession } from '../../session/rpc.ts'
import { getBackendModel } from '../../session/model.ts'
import { getBackendUsage, setBackendUsage } from '../../session/usage.ts'
import {
  latestSession,
  loadSession,
  newSessionId,
  replaySession,
  saveSession,
  titleFromPrompt,
  type SessionKind,
  type StoredSession,
  type StoredTurn,
} from '../../session/persist/index.ts'
import type { AgentSession } from '../../session/seam.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import { effectiveConfig } from '../../core/config.ts'
import { formatStamp } from '../../core/text.ts'

export type SessionController = Readonly<{
  sessionRef: Ref<AgentSession>
  /** 当前会话第几轮（openSession 取磁盘轮数、runTurn 自增、/new 清零） */
  turnIndex: Ref<number>
  /** 当前会话的磁盘状态；用容器而不是 ref：它不是渲染数据，别引多余的响应式触发 */
  current: { session: StoredSession | null }
  /** false 时完全不动磁盘（tui.toml persist=false / 测试注入） */
  persist: boolean
  /** /open 选择器：开关 + 受控高亮 + 条目 */
  pickerOpen: Ref<boolean>
  pickerSelIdx: Ref<number>
  pickerItems: Ref<TCommandPaletteItem[]>

  /** 建一条新的落盘记录（不换会话实现、不清转写） */
  startSession(kind: SessionKind, title?: string): StoredSession
  /** 切到某个会话：换实现 + 重放 + 恢复模型上下文（agentState）+ 回填最近一轮 usage */
  openSession(target: StoredSession): void
  /** 切换 + 统一文案：选择器 Enter 与 /open <序号|id> 文本路径共用 */
  switchToSession(target: StoredSession): void
  /** /open 选择器条目：label=标题，detail=「▶(当前) kind · 轮数 · 时间」 */
  buildSessionItems(all: StoredSession[]): TCommandPaletteItem[]
  /** /new：换实现 + 清转写 + 轮序清零（落盘关闭时只清转写，由命令层决定） */
  resetSession(kind: SessionKind, title?: string): void
  /** /mock · /rpc：换会话实现 + 清空 usage（不动转写与轮序） */
  switchKind(kind: SessionKind): void
  /** 一轮结束的落盘钩子（真实 usage 随轮落盘；取消轮不挂 usage） */
  persistTurn(rec: StoredTurn): void
}>

export function useSessionController(deps: {
  store: TranscriptStore
  persist: boolean
  /** props.sessionId：'' | 'last' | 具体 id */
  bootId: string
  bootKind: SessionKind
  invalidate(): void
}): SessionController {
  const { store, persist, bootId, bootKind, invalidate } = deps

  /** 两种会话：rpc（唯一 agent 后端，py/Agent Framework）/ mock（离线剧本夹具） */
  const makeSession = (kind: string): AgentSession =>
    kind === 'rpc' ? createRpcSession() : createMockSession()
  const sessionRef = ref<AgentSession>(makeSession(bootKind))
  const turnIndex = ref(0)

  const current: { session: StoredSession | null } = { session: null }

  const pickerOpen = ref(false)
  const pickerSelIdx = ref(0)
  const pickerItems = ref<TCommandPaletteItem[]>([])

  const providerInfo = (kind: SessionKind): { host?: string; model?: string } => {
    if (kind !== 'rpc') return {} // mock 是离线剧本，没有 provider
    // host/model 都来自 gateway 的 config/get（provider 名字级信息，不存密钥）；
    // 用 getBackendModel()（模块级权威值）而不是模型域的 ref，免得会话域反向依赖模型域。
    const g = effectiveConfig().gateway
    return { host: `${g.host}:${g.port}`, model: getBackendModel() || effectiveConfig().default_model }
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

  function openSession(target: StoredSession): void {
    current.session = target
    sessionRef.value = makeSession(target.kind)
    replaySession(target, store)
    sessionRef.value.restore?.(target.turns.at(-1)?.agentState)
    turnIndex.value = target.turns.length
    // 回填最近一轮的真实 usage（会话文件持久化）；没有就清空，状态栏退回本地估算
    let usage: Record<string, number> | null = null
    for (let i = target.turns.length - 1; i >= 0; i--) {
      if (target.turns[i].usage) {
        usage = target.turns[i].usage ?? null
        break
      }
    }
    setBackendUsage(usage)
    invalidate()
  }

  function buildSessionItems(all: StoredSession[]): TCommandPaletteItem[] {
    const cur = current.session?.id
    return all.map((s) => ({
      label: s.title || s.id,
      detail: `${s.id === cur ? '▶ ' : ''}${s.kind} · ${s.turns.length} 轮 · ${formatStamp(s.updatedAt)}`,
      value: s.id,
      keywords: [s.id, s.kind],
    }))
  }

  function switchToSession(target: StoredSession): void {
    openSession(target)
    store.addNote(`已切到 ${target.id} · ${target.title}（${target.turns.length} 轮）`)
  }

  function resetSession(kind: SessionKind, title = '新会话'): void {
    startSession(kind, title)
    sessionRef.value = makeSession(kind)
    setBackendUsage(null) // 新会话还没有轮次
    store.clear()
    turnIndex.value = 0
  }

  function switchKind(kind: SessionKind): void {
    sessionRef.value = makeSession(kind)
    setBackendUsage(null) // 新会话还没有轮次（/mock 没有真实 usage，别显示上一个的）
  }

  function persistTurn(rec: StoredTurn): void {
    if (!persist) return
    // 真实 usage 随轮落盘（取消轮没有新 usage，不挂），恢复会话时状态栏才有数据
    const usage = getBackendUsage()
    if (usage && !rec.aborted) rec.usage = usage
    const session = current.session ?? startSession(sessionRef.value.kind)
    session.turns.push(rec)
    session.updatedAt = new Date().toISOString()
    if (session.title === '新会话' && rec.user) session.title = titleFromPrompt(rec.user)
    try {
      saveSession(session)
    } catch (err) {
      store.addNote(`⚠ 会话落盘失败：${(err as Error).message}`)
    }
  }

  // 启动时恢复会话：--session <id|last> 有值就恢复，否则新建一条空记录（persist=false 完全不动磁盘）
  if (persist) {
    const boot = bootId === 'last' ? latestSession() : bootId ? loadSession(bootId) : null
    if (boot) {
      openSession(boot)
      store.addNote(`已恢复会话 ${boot.id} · ${boot.title}（${boot.turns.length} 轮）`)
    } else {
      startSession(bootKind)
    }
  }

  // listSessions 归命令层直接调用，这里不再需要
  return {
    sessionRef,
    turnIndex,
    current,
    persist,
    pickerOpen,
    pickerSelIdx,
    pickerItems,
    startSession,
    openSession,
    switchToSession,
    buildSessionItems,
    resetSession,
    switchKind,
    persistTurn,
  }
}
