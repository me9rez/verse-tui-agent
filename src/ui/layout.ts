/**
 * 版面计算：所有区域坐标都在这里定，渲染函数只负责摆。
 * 全部是绝对单元格坐标（vue-tui 没有 flex，位置自己算）。
 */
export function layoutOf(rows: number) {
  const hintY = Math.max(8, rows - 1)
  const inputY = hintY - 3
  const statusY = inputY - 1
  const transcriptY = 1
  return {
    headerY: 0,
    transcriptY,
    transcriptH: Math.max(3, statusY - transcriptY),
    statusY,
    inputY,
    hintY,
  }
}

export type Layout = Readonly<{
  headerY: number
  transcriptY: number
  transcriptH: number
  statusY: number
  inputY: number
  hintY: number
}>
