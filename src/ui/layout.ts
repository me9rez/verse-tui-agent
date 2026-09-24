/** 版面计算：所有区域坐标都在这里定，渲染函数只负责摆。
 *  全部是绝对单元格坐标（vue-tui 没有 flex，位置自己算）。
 *
 *  step 风格布局（自下而上）：
 *    rows-1        状态栏（模式 · 模型 · cwd / tok · tools）
 *    rows-2        输入行（> 前缀 + 无边框 TInput + 占位符）
 *    rows-3        分割线
 *    0..divider-1  区域：空态画欢迎块 + 空态提示；有内容画转写
 */
export function layoutOf(rows: number) {
  const statusY = Math.max(4, rows - 1)
  const inputY = statusY - 1
  const dividerY = inputY - 1
  const transcriptY = 0
  return {
    transcriptY,
    transcriptH: Math.max(2, dividerY - transcriptY),
    dividerY,
    inputY,
    statusY,
  }
}

export type Layout = Readonly<{
  transcriptY: number
  transcriptH: number
  dividerY: number
  inputY: number
  statusY: number
}>
