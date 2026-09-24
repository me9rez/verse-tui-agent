/**
 * 后端当前 model id 的客户端视图（框架无关：不引 vue，纯订阅回调）。
 *
 * 权威来源是后端握手 `initialize.result.model`（rpc.ts 连上就问一次），
 * `/model <id>` 切换成功后 rpc.ts 也会回填。App 订阅后显示在欢迎块
 * model 行与状态栏——不再拿 VT_RPC_MODEL 环境变量当真相（那只是兜底）。
 * mock 剧本不用它（显示走 kind 分支）。
 */
let current = ''
const listeners = new Set<(model: string) => void>()

/** 后端回填/切换后调用：记录当前值并通知所有订阅者。 */
export function setBackendModel(model: string): void {
  if (!model || model === current) return
  current = model
  for (const cb of listeners) cb(model)
}

/** 当前已知的后端 model（没握手过就是空串）。 */
export function getBackendModel(): string {
  return current
}

/** 订阅 model 变化（已知值会立刻回调一次）；返回取消函数。 */
export function onBackendModel(cb: (model: string) => void): () => void {
  listeners.add(cb)
  if (current) cb(current)
  return () => {
    listeners.delete(cb)
  }
}
