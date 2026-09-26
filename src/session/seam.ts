/**
 * 会话域接缝：AgentSession 是「谁来产生流」的契约（本目录对外的类型出口）。
 * - mock.ts：本地剧本，自带节奏，离线可用（测试夹具）。
 * - rpc.ts：唯一 agent 后端——py/Agent Framework 的 JSON-RPC over WebSocket（`pnpm dev -- --rpc` 或 /rpc）。
 * - sink.ts：TurnSink 实现（一轮对话的事件 → 转写分组），与接缝同域。
 * - persist/：落盘会话（StoredSession 的存储/记录/重放，与运行时 AgentSession 是两回事）。
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

/** thinking/get 的应答：与 rpc_server.py 的 thinking/get result 同形。 */
export type ThinkingInfo = {
  effort: string
  model: string
  support_efforts: string[]
  default_effort: string
  off_effort: string
  capabilities: string[]
}

import type { SessionKind } from './persist/model.ts'

/** 待发送的图片附件（Alt+V 剪贴板贴图）：data 是 base64（不含 data: 前缀）。 */
export type RawImage = { media_type: string; data: string }

export type AgentSession = {
  readonly id: string
  readonly label: string
  /** 这条会话属于哪一路：决定落盘文件里的 kind，也决定 /new 切回哪一路 */
  readonly kind: SessionKind
  /** 跑完一轮：把增量推给 sink。images 非空 = 多模态输入（mock 忽略，rpc 走 agent/chat params.images）。 */
  respond(prompt: string, ctx: TurnContext, images?: RawImage[]): Promise<void>
  /** 切换后端模型（/model <id>）：返回后端确认的 model id；不支持的后端（mock）不实现 */
  setModel?(id: string): Promise<string>
  /** 读思考档位与当前模型的支持表（/effort 选择器数据源）；不支持的后端（mock）不实现 */
  getThinking?(): Promise<ThinkingInfo>
  /** 切思考档位（/effort <档位>）：返回后端确认的档位；不支持的后端（mock）不实现 */
  setThinking?(effort: string): Promise<string>
  /** 切 harness 模式（Shift+Tab）：返回切换后的模式；同值切换不重复通知 */
  setMode?(mode: string): Promise<string>
  /** 把「与服务端上下文有关的状态」导出成可 JSON 化的值（没有就返回 undefined） */
  snapshot?(): unknown
  /** 从 snapshot() 的产物恢复；坏的输入要静默忽略（旧文件可能来自更早的版本） */
  restore?(state: unknown): void
}
