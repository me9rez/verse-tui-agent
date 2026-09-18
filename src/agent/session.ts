/**
 * 会话层：AgentSession 是「谁来产生流」的接缝。
 * - mockSession：本地剧本，自带节奏，离线可用（默认）。
 * - liveSession：OpenAI 兼容端点的真实 SSE 流（VT_LIVE=1 时启用）。
 */
/** 真实子进程描述：ToolStep 带了它，输出就是真跑出来的 stdout。 */
export type ToolRun = { file: string; args: string[]; cwd?: string }

export type ToolStep = {
  /** 工具调用 id：一轮里可能有并发调用，界面靠它把输出归到正确的工具行 */
  id?: string
  name: string
  arg: string
  /** 工具原始入参（AI SDK 的 input 对象）：界面用它渲染 params 块 */
  params?: Record<string, unknown>
  command?: string
  /** 剧本里预置的输出行；真实 agent 的工具输出是边跑边通过 toolLine 写进来的 */
  output?: string[]
  status?: 'ok' | 'error'
  run?: ToolRun
}

export type StreamStep =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; tool: ToolStep }
  | { kind: 'answer'; text: string }

export type TurnSink = {
  thinkingDelta(delta: string): void
  thinkingEnd(): void
  toolStart(tool: ToolStep): void
  toolLine(tool: ToolStep, line: string): void
  toolEnd(tool: ToolStep, status: 'ok' | 'error'): void
  answerDelta(delta: string): void
}

export type TurnContext = {
  sink: TurnSink
  /** 用户按 Esc 后为 true：会话应尽快停下并交还控制权。 */
  aborted: () => boolean
  /** 每块之间的等待毫秒数；0 = 尽快跑完（smoke 用）。 */
  chunkDelayMs: number
  turn: number
  sleep: (ms: number) => Promise<void>
}

import type { SessionKind } from '../core/session/model.ts'

export type AgentSession = {
  readonly id: string
  readonly label: string
  /** 这条会话属于哪一路：决定落盘文件里的 kind，也决定 /new 切回哪一路 */
  readonly kind: SessionKind
  /** 跑完一轮：把增量推给 sink。 */
  respond(prompt: string, ctx: TurnContext): Promise<void>
  /** 把「与服务端上下文有关的状态」导出成可 JSON 化的值（没有就返回 undefined） */
  snapshot?(): unknown
  /** 从 snapshot() 的产物恢复；坏的输入要静默忽略（旧文件可能来自更早的版本） */
  restore?(state: unknown): void
}
