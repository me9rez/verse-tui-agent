/**
 * 一轮对话的事件映射：把会话层吐出的增量（思考/工具/正文）落到转写分组里。
 *
 * 从 App.ts 抽出来是因为这块状态最多（当前思考流、当前正文流、并发工具的组表），
 * 而且它只依赖 store 与「设置阶段」这个回调，跟渲染无关。
 */
import type { AgentSession, ToolStep, TurnSink } from '../agent/session.ts'
import type { Group, LineStream, ToolEntry, TranscriptStore } from '../core/transcript/index.ts'

export type Phase = 'idle' | 'thinking' | 'tool' | 'answering'

export type TurnSinkHandle = Readonly<{
  sink: TurnSink
  /** 一轮收尾：结束还在流的行、把没结的工具标 ok、被中断则写一行提示。 */
  finish(aborted: boolean): void
}>

export function createTurnSink(store: TranscriptStore, setPhase: (phase: Phase) => void): TurnSinkHandle {
  // 放在容器里：这几个值只在回调里被赋值，局部 let 会被 TS 收窄成 null。
  const live: { thinking: LineStream | null; answer: LineStream | null } = { thinking: null, answer: null }
  // 工具分组按 toolCallId 建键：一个 step 里并发多个工具调用也不会串行错位
  type ToolLive = { group: Group; head: ToolEntry; outStarted: boolean }
  const toolGroups = new Map<string, ToolLive>()
  const keyOf = (tool: ToolStep): string => tool.id ?? `${tool.name}::${tool.arg}`
  const thinkingGroup: { id: string | null } = { id: null }

  /** 思考说完就自动收起（参考答案的默认行为）；点标题可再展开 */
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
        setPhase('thinking')
      }
      live.thinking.push(delta)
    },
    thinkingEnd() {
      live.thinking?.end()
      live.thinking = null
      collapseThinking()
    },
    toolStart(tool: ToolStep) {
      live.thinking?.end()
      live.thinking = null
      collapseThinking()
      live.answer = null
      ensureTool(tool)
      setPhase('tool')
    },
    toolLine(tool: ToolStep, line: string) {
      const t = ensureTool(tool)
      if (!t.outStarted) {
        store.groupSection(t.group.id, 'out')
        t.outStarted = true
      }
      store.groupBody(t.group.id, line)
    },
    toolEnd(tool: ToolStep, status) {
      store.setToolStatus(ensureTool(tool).head, status)
      toolGroups.delete(keyOf(tool))
      setPhase('thinking')
    },
    answerDelta(delta) {
      if (!live.answer) {
        live.thinking?.end()
        live.thinking = null
        collapseThinking()
        store.blank()
        live.answer = store.stream('assistant')
        setPhase('answering')
      }
      live.answer.push(delta)
    },
  }

  const finish = (aborted: boolean): void => {
    live.thinking?.end()
    live.answer?.end()
    for (const t of toolGroups.values()) store.setToolStatus(t.head, 'ok')
    toolGroups.clear()
    if (aborted) store.addNote('⎿ 已中断 · 本轮输出到此为止')
  }

  return { sink, finish }
}
