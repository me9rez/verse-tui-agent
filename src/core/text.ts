/** 单元格宽度与文本工具：终端里 CJK 占两列，凡是要对齐/截断的地方都必须按 cell 宽度算。 */

/** East Asian Wide / Fullwidth 的粗略覆盖（emoji 与常见 CJK 区段）。 */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

/** 组合字符（变音、ZWJ、变体选择符）不占宽度。 */
function isZeroWidth(cp: number): boolean {
  return (cp >= 0x0300 && cp <= 0x036f) || cp === 0x200b || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)
}

export function cellWidth(text: string): number {
  let w = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isZeroWidth(cp)) continue
    w += isWide(cp) ? 2 : 1
  }
  return w
}

/** 按 cell 宽度截断，超出部分丢弃（不切断宽字符）。 */
export function sliceByCells(text: string, max: number): string {
  let w = 0
  let out = ''
  for (const ch of text) {
    const cw = cellWidth(ch)
    if (w + cw > max) break
    out += ch
    w += cw
  }
  return out
}

/** 右补齐到指定 cell 宽度（用于状态栏两端对齐）。 */
export function padTo(text: string, width: number): string {
  const w = cellWidth(text)
  return w >= width ? sliceByCells(text, width) : text + ' '.repeat(width - w)
}

/** 左补齐。 */
export function padStartTo(text: string, width: number): string {
  const w = cellWidth(text)
  return w >= width ? sliceByCells(text, width) : ' '.repeat(width - w) + text
}

/**
 * 把一段文本切成流式小块：逐字符推进，但按 chunkSize 聚合减少重绘次数。
 * 换行不切碎，保证渲染出的中间态始终是「完整的行前缀」。
 */
export function chunkText(text: string, chunkSize = 3): string[] {
  const chunks: string[] = []
  let buf = ''
  for (const ch of text) {
    buf += ch
    if (ch === '\n' || cellWidth(buf) >= chunkSize) {
      chunks.push(buf)
      buf = ''
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

/** 粗略 token 估算（演示用：中文按 1 字 ≈ 1 token，英文按 4 字符 ≈ 1 token）。 */
export function estimateTokens(text: string): number {
  let wide = 0
  let narrow = 0
  for (const ch of text) (cellWidth(ch) === 2 ? wide++ : narrow++)
  return Math.round(wide + narrow / 4)
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** ISO 时间 → 本地 `MM-DD HH:MM`（会话列表用；toISOString 存的是 UTC，直接切字符串会显示成 UTC 时间） */
export function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
