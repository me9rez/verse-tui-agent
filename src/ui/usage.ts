/**
 * 状态栏 usage 段的纯格式化逻辑（无副作用，test/hotkeys.test.ts 直测）。
 *
 * 数据来源是 LLM 终态 result.usage（框架 UsageDetails 的 JSON 视图）：
 *   input_token_count            —— 本轮输入 token（OpenAI 语义里含缓存命中的部分）
 *   output_token_count           —— 本轮输出
 *   cache_read_input_token_count —— 从端点缓存命中的输入 token
 * 上下文占用 = input / 当前模型 max_context_size（config/get 下发；没配就只显示绝对值）。
 */

export type UsageView = {
  input: number
  output: number
  total: number
  /** 端点缓存命中的输入 token；usage 里没回就是 undefined（不显示缓存段）。 */
  cached?: number
}

/** 从后端 usage 原始字典提取视图；空 / 全零 → null（状态栏退回本地估算）。 */
export function readUsage(u: Record<string, number> | null | undefined): UsageView | null {
  if (!u || typeof u !== 'object') return null
  const input = Number(u.input_token_count ?? 0) || 0
  const output = Number(u.output_token_count ?? 0) || 0
  if (!input && !output) return null
  const cachedRaw = Number(u.cache_read_input_token_count ?? 0)
  return {
    input,
    output,
    total: Number(u.total_token_count ?? input + output) || input + output,
    ...(cachedRaw > 0 ? { cached: cachedRaw } : {}),
  }
}

/** 1234 → '1.2k'，12345 → '12.3k'，99_999 → '100k'（k 以下原样）。 */
export function fmtK(n: number): string {
  if (n >= 1000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, '')
    return `${k}k`
  }
  return String(n)
}

/** 'ctx 12.3k/200k 6%'：上下文占用（input / max_context_size）；没配窗口只显示绝对值。 */
export function ctxText(view: UsageView, maxContext: number): string {
  const base = `ctx ${fmtK(view.input)}${maxContext > 0 ? `/${fmtK(maxContext)}` : ''}`
  return maxContext > 0 ? `${base} ${Math.round((view.input / maxContext) * 100)}%` : base
}

/** 'cache 8.1k 67%'：缓存命中 token 与命中率（cached / input）；usage 没回缓存信息 → null。 */
export function cacheText(view: UsageView): string | null {
  if (!view.cached) return null
  const pct = view.input > 0 ? ` ${Math.round((view.cached / view.input) * 100)}%` : ''
  return `cache ${fmtK(view.cached)}${pct}`
}
