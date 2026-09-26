/**
 * 后端上一轮 LLM usage 的客户端视图（框架无关：纯订阅回调，同 model.ts/mode.ts 模式）。
 *
 * 来源是 agent/chat 终态 result.usage（rpc_server._stream_turn 透传的框架 UsageDetails）：
 *   input_token_count / output_token_count / total_token_count /
 *   cache_read_input_token_count（端点缓存命中）/ cache_creation_input_token_count（写入缓存）
 * App 订阅后在状态栏显示真实 token 用量，并用 input 相对当前模型 max_context_size
 * 算上下文占用百分比。取消轮（-32001）不回填，保留上一轮值。
 */

export type BackendUsage = Record<string, number>

let current: BackendUsage | null = null
const listeners = new Set<(usage: BackendUsage | null) => void>()

/** 一轮结束（终态 result.usage）后调用；null 清空。 */
export function setBackendUsage(usage: BackendUsage | null): void {
  current = usage
  for (const cb of listeners) cb(usage)
}

export function getBackendUsage(): BackendUsage | null {
  return current
}

/** 订阅 usage 变化（立刻回调一次当前值，可为 null）。返回取消函数。 */
export function onBackendUsage(cb: (usage: BackendUsage | null) => void): () => void {
  listeners.add(cb)
  cb(current)
  return () => {
    listeners.delete(cb)
  }
}
