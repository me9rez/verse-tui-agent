/**
 * 后端 harness 模式（plan/execute）的客户端视图（框架无关：纯订阅回调）。
 *
 * 权威来源是后端 `mode/get`（按 session 隔离，默认 plan）：rpc 连接后问一次，
 * Shift+Tab 切换（`mode/set`）成功后回填。App 订阅后显示在状态栏模式段，
 * 并作为下一次切换的目标判断（execute → plan，否则 → execute）。
 */

let current = ''
const listeners = new Set<(mode: string) => void>()

/** 后端回填/切换后调用；通知所有订阅者。 */
export function setBackendMode(mode: string): void {
  if (!mode || mode === current) return
  current = mode
  for (const cb of listeners) cb(mode)
}

/** 当前已知的模式（未握手过为空串，调用方自行兜底 'plan'）。 */
export function getBackendMode(): string {
  return current
}

/** 订阅模式变化；立即回放已知值，返回取消函数。 */
export function onBackendMode(cb: (mode: string) => void): () => void {
  listeners.add(cb)
  if (current) cb(current)
  return () => {
    listeners.delete(cb)
  }
}
