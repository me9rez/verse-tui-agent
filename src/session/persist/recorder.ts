/**
 * 一轮的事件记录器：把流式增量累积成「按行」的结构，供落盘。
 *
 * 与 sink 吃同一份回调数据（不从转写里反解析——反解析会跟排版实现耦合，
 * 哪天排版改了记录就静默走样）。
 */
import { type StoredTool, type StoredTurn } from './model.ts'

type ToolRef = { name: string; arg: string; id?: string; params?: Record<string, unknown> }
type ToolStatus = 'running' | 'ok' | 'error'

export type TurnRecorder = {
  begin(prompt: string): void
  thinkingDelta(delta: string): void
  thinkingEnd(): void
  toolStart(tool: ToolRef): void
  toolLine(tool: ToolRef, line: string): void
  toolEnd(tool: ToolRef, status: ToolStatus): void
  answerDelta(delta: string): void
  /** 收口：把未收尾的半行补进去，返回这一轮的结构 */
  finish(aborted: boolean, agentState?: unknown): StoredTurn
}

export function createTurnRecorder(): TurnRecorder {
  let user = ''
  let thinking: string[] = []
  let answer: string[] = []
  let tools: StoredTool[] = []
  const byKey = new Map<string, StoredTool>()
  /** 未收尾的半行：流式是按 delta 来的，行号要自己数 */
  let pending = ''

  const keyOf = (tool: ToolRef): string => tool.id ?? `${tool.name}::${tool.arg}`

  /** 把缓冲里的完整行推进目标数组；剩下的半行留在 pending 里等下一个 delta */
  const drain = (into: string[]): void => {
    let idx: number
    while ((idx = pending.indexOf('\n')) >= 0) {
      into.push(pending.slice(0, idx))
      pending = pending.slice(idx + 1)
    }
  }

  const reset = (): void => {
    user = ''
    thinking = []
    answer = []
    tools = []
    byKey.clear()
    pending = ''
  }

  return {
    begin(prompt: string): void {
      reset()
      // 会话内这一轮要留原文（40 字截断是「会话标题」的规则，不是这里）
      user = prompt.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    },
    thinkingDelta(delta: string): void {
      pending += delta
      drain(thinking)
    },
    thinkingEnd(): void {
      if (pending) {
        thinking.push(pending)
        pending = ''
      }
    },
    toolStart(tool: ToolRef): void {
      const key = keyOf(tool)
      if (byKey.has(key)) return
      const one: StoredTool = { name: tool.name, arg: tool.arg, params: tool.params, status: 'running', out: [] }
      byKey.set(key, one)
      tools.push(one)
    },
    toolLine(tool: ToolRef, line: string): void {
      this.toolStart(tool)
      byKey.get(keyOf(tool))?.out.push(line)
    },
    toolEnd(tool: ToolRef, status: ToolStatus): void {
      const one = byKey.get(keyOf(tool))
      if (one) one.status = status
      else tools.push({ name: tool.name, arg: tool.arg, params: tool.params, status, out: [] })
    },
    answerDelta(delta: string): void {
      pending += delta
      drain(answer)
    },
    finish(aborted: boolean, agentState?: unknown): StoredTurn {
      // 半行也算内容：被 Esc 掐在中间时，用户看到的就是这些
      if (pending) {
        answer.push(pending)
        pending = ''
      }
      const turn: StoredTurn = { user, thinking, tools, answer, aborted, agentState }
      reset() // 复位，避免下一次 finish 返回上一轮的内容
      return turn
    },
  }
}
