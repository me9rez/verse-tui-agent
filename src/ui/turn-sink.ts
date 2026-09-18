/**
 * 一轮对话的事件映射：把会话层吐出的增量（思考/工具/正文）落到转写分组里，
 * 同时交给记录器攒成「按行」的结构（供持久化，见 core/session/recorder.ts）。
 *
 * 从 App.ts 抽出来是因为这块状态最多（当前思考流、当前正文流、并发工具的组表），
 * 而且它只依赖 store 与「设置阶段」这个回调，跟渲染无关。
 */
import type { AgentSession, ToolStep, TurnSink } from '../agent/session.ts'
import type { Group, LineStream, ToolEntry, TranscriptStore } from '../core/transcript/index.ts'
import { createTurnRecorder, type StoredTurn } from '../core/session/index.ts'

export type Phase = 'idle' | 'thinking' | 'tool' | 'answering'

export type TurnSinkHandle = Readonly<{
  sink: TurnSink
  /** 一轮开始时调用：让记录器知道这一轮的用户输入是什么 */
  beginTurn(prompt: string): void
  /**
   * 一轮收尾：结束还在流的行、把没结的工具标 ok、被中断则写一行提示，
   * 最后把这一轮交给 onTurnEnd（落盘挂在那里）。
   */
  finish(aborted: boolean, agentState?: unknown): void
}>

export function createTurnSink(
  store: TranscriptStore,
  setPhase: (phase: Phase) => void,
  hooks: { onTurnEnd?: (turn: StoredTurn) => void } = {},
): TurnSinkHandle {
  const recorder = createTurnRecorder()
  // 放在容器里：这几个值只在回调里被赋值，局部 let 会被 TS 收窄成 null。
  const live: { thinking: LineStream | null; answer: LineStream | null } = { thinking: null, answer: null }
  // 工具分组按 toolCallId 建键：一个 step 里并发多个工具调用也不会串行错位
  type ToolLive = { group: Group; head: ToolEntry; outStarted: boolean }
  const toolGroups = new Map<string, ToolLive>()
  const keyOf = (tool: ToolStep): string => tool.id ?? `${tool.name}::${tool.arg}`
  const thinkingGroup: { id: string | null } = { id: null }

  /**
   * 一轮进行中的折叠规则（手风琴）：只有**正在写的那块**展开，前面的全部收起。
   *   - 新的思考组出现 → 收起之前的
   *   - 新的工具组出现 → 收起之前的（思考组也随之收起）
   *   - 正文开始流式输出 → 此时没有「当前组」，于是全部收起
   * 一轮结束时由 finish() 再全部收起一次（用户手点展开的也不例外，规则就是这么定的）。
   */
  const collapseThinking = (): void => {
    if (thinkingGroup.id) store.setGroupCollapsed(thinkingGroup.id, true)
    thinkingGroup.id = null
  }
  const ensureTool = (tool: ToolStep): ToolLive => {
    const key = keyOf(tool)
    let entry = toolGroups.get(key)
    if (!entry) {
      // 参数在开组时就作为组内前几行进表，展开即可见
      const { group, head } = store.startToolGroup({ name: tool.name, arg: tool.arg, params: tool.params })
      entry = { group, head, outStarted: false }
      toolGroups.set(key, entry)
      store.soloExpand(group.id) // 新组独占展开，前面的收起
    }
    return entry
  }

  const sink: TurnSink = {
    thinkingDelta(delta) {
      if (!live.thinking) {
        const g = store.startThinkingGroup()
        thinkingGroup.id = g.id
        live.thinking = store.stream('system', { group: g.id })
        live.answer = null
        store.soloExpand(g.id) // 手风琴：新思考组独占展开
        setPhase('thinking')
      }
      recorder.thinkingDelta(delta)
      live.thinking.push(delta)
    },
    thinkingEnd() {
      recorder.thinkingEnd()
      live.thinking?.end()
      live.thinking = null
      collapseThinking()
    },
    toolStart(tool: ToolStep) {
      recorder.toolStart(tool)
      live.thinking?.end()
      live.thinking = null
      collapseThinking()
      live.answer = null
      ensureTool(tool)
      setPhase('tool')
    },
    toolLine(tool: ToolStep, line: string) {
      recorder.toolLine(tool, line)
      const t = ensureTool(tool)
      if (!t.outStarted) {
        store.groupSection(t.group.id, 'out')
        t.outStarted = true
      }
      store.groupBody(t.group.id, line)
    },
    toolEnd(tool: ToolStep, status) {
      recorder.toolEnd(tool, status)
      store.setToolStatus(ensureTool(tool).head, status)
      toolGroups.delete(keyOf(tool))
      setPhase('thinking')
    },
    answerDelta(delta) {
      if (!live.answer) {
        live.thinking?.end()
        live.thinking = null
        collapseThinking()
        store.soloExpand() // 正文流式输出时没有「当前组」，全部收起
        store.blank()
        live.answer = store.stream('assistant')
        setPhase('answering')
      }
      recorder.answerDelta(delta)
      live.answer.push(delta)
    },
  }

  const finish = (aborted: boolean, agentState?: unknown): void => {
    live.thinking?.end()
    live.answer?.end()
    for (const t of toolGroups.values()) store.setToolStatus(t.head, 'ok')
    toolGroups.clear()
    store.soloExpand() // 回合结束：think / tool 全部收起
    if (aborted) store.addNote('⎿ 已中断 · 本轮输出到此为止')
    hooks.onTurnEnd?.(recorder.finish(aborted, agentState))
  }

  return { sink, beginTurn: (prompt: string) => recorder.begin(prompt), finish }
}
