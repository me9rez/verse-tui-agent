/** 版面计算：所有区域坐标都在这里定，渲染函数只负责摆。
 *  全部是绝对单元格坐标（vue-tui 没有 flex，位置自己算）。
 *
 *  step 风格布局（自下而上）：
 *    rows-1        状态栏（模型 · harness 模式 · 思考强度 / 会话 · 用量）
 *    rows-2        状态栏上分割线（把输入区与状态栏分开）
 *    rows-3        输入行（> 前缀 + 无边框 TInput + 占位符）
 *    rows-4        分割线（输入区上沿）
 *    0..divider-1  区域：左列 = 转写（空态画欢迎块 + 空态提示，有内容画正文）；
 *                  右列 = Tips/快捷键（终端够宽才有，竖线 │ 是它的左边界）
 *
 *  两列是「够宽才开」：cols < TWO_COL_MIN 时右列整块不渲染，转写独享整宽。
 */
export function layoutOf(rows: number, cols: number) {
  const statusY = Math.max(5, rows - 1)
  const statusDividerY = statusY - 1
  const inputY = statusDividerY - 1
  const dividerY = inputY - 1
  const transcriptY = 0
  const transcriptH = Math.max(2, dividerY - transcriptY)
  // 右列贴右边，竖线是它的左边界；左列到竖线前一列为止（留 1 列呼吸位，正文不贴线）
  const twoCol = cols >= TWO_COL_MIN
  const gutterX = twoCol ? cols - TIPS_COLS : -1
  const tipsX = twoCol ? gutterX + 2 : -1
  const tipsW = twoCol ? Math.max(8, cols - tipsX - 1) : 0
  const transcriptW = twoCol ? Math.max(20, gutterX - 1) : cols
  return {
    transcriptY,
    transcriptH,
    dividerY,
    inputY,
    statusDividerY,
    statusY,
    twoCol,
    gutterX,
    gutterH: transcriptH,
    tipsX,
    tipsW,
    transcriptW,
  }
}

/** 右列整块占用的列数（含竖线 1 列 + 左右留白） */
export const TIPS_COLS = 34
/** 开两列的最小终端宽度：再窄就退回单列（左列独享整宽） */
export const TWO_COL_MIN = 90

export type Layout = Readonly<{
  transcriptY: number
  transcriptH: number
  dividerY: number
  inputY: number
  statusDividerY: number
  statusY: number
  /** 是否开了右列（cols >= TWO_COL_MIN） */
  twoCol: boolean
  /** 竖线所在列（twoCol 为假时是 -1，调用方别读） */
  gutterX: number
  /** 竖线高度（= 转写区高度） */
  gutterH: number
  /** 右列内容起点（twoCol 为假时是 -1） */
  tipsX: number
  /** 右列内容可用宽度 */
  tipsW: number
  /** 左列（转写区）可用宽度：两列时是竖线左边的宽度，单列时等于终端宽 */
  transcriptW: number
}>
