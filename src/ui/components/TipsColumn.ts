/**
 * 右列：竖线 │ + Tips（三条命令）+ 快捷键提示。
 *
 * 挂 chrome plane：内容全是静态文案，不必跟着 transcript plane 的流式高频重绘走
 *（竖线也是这一列的一部分，同样低频）。
 * 宽度与坐标全部来自 layout.ts（TIPS_COLS / TWO_COL_MIN 决定这一列有没有），
 * 文案来自 texts.ts（命令 desc 与 /help 同源，不另抄一份）。
 * 转写区很矮时按 height 截断，绝不画到输入行上去。
 */
import { defineComponent, h, type VNode } from 'vue'
import { TText } from '@simon_he/vue-tui'
import { COMMANDS, KEY_HINTS, MODE_HINT, NL as NEWLINE } from '../texts.ts'
import { styles } from '../../core/theme.ts'

/** 右列展示的三条入口命令（与欢迎块同一批） */
const TIP_CMDS = ['/rpc', '/sessions', '/help'] as const
/** 行首关键字（命令/组合键）占的宽度：'/sessions' 9 列 + 2 列间距 */
const KEY_W = 11
/** 「模式」值占的宽度（'execute' 7 列 + 1 列间距） */
const MODE_W = 8
/** 排版行号：模式区（标题 + 值）、空行、Tips（标题 + 三条）、空行、快捷键（标题 + 四条） */
const Y_MODE = 0
const Y_MODE_VAL = 1
const Y_TIPS = 3
const Y_CMD = 4
const Y_KEYS = 8

export const TipsColumn = defineComponent({
  name: 'TipsColumn',
  props: {
    /** 竖线所在列（layout.ts 的 gutterX） */
    x: { type: Number, required: true },
    /** 整列高度（layout.ts 的 gutterH = 转写区高度） */
    height: { type: Number, required: true },
    /** 右列内容起点与宽度（tipsX / tipsW） */
    tipsX: { type: Number, required: true },
    tipsW: { type: Number, required: true },
    /** 当前 harness 模式（'plan' / 'execute'；'' = 没握手，mock 会话恒为空） */
    mode: { type: String, default: '' },
  },
  setup(props) {
    return () => {
      const nodes: VNode[] = []
      const w = Math.max(4, props.tipsW)

      // 竖线：整列高度，1 格宽（faint）。它是左列的右边界。
      // 库没有竖向 divider（TDivider 只画横线，TBox 的 border 不能只留一边），
      // 所以整列用「一个含换行的多行节点」画（TText 支持 h + 换行）：比逐行 28 个
      // 单格节点省一帧 27 个 vnode，也避开同型节点的依赖跟踪（见 TText 的 depsKey 注释）。
      const bar = new Array(props.height).fill('│').join(NEWLINE)
      nodes.push(
        h(TText, { x: props.x, y: 0, w: 1, h: props.height, value: bar, style: styles.faint }),
      )

      const label = (y: number, text: string): void => {
        if (y >= props.height) return
        nodes.push(h(TText, { x: props.tipsX, y, w, h: 1, value: text, style: styles.infoLabel }))
      }
      /** 一行「关键字 + 说明」：关键字固定宽，说明吃掉剩下的列 */
      const row = (y: number, key: string, what: string): void => {
        if (y >= props.height) return
        nodes.push(h(TText, { x: props.tipsX, y, w: KEY_W, h: 1, value: key, style: styles.tipCmd }))
        nodes.push(
          h(TText, {
            x: props.tipsX + KEY_W,
            y,
            w: Math.max(2, w - KEY_W),
            h: 1,
            value: what,
            style: styles.tipDesc,
          }),
        )
      }

      // ── 模式区（顶部）：当前档 + 一行说明。配色与状态栏 harness 段同源
      //（plan 橙=只规划要提醒，execute 蓝）；空值说明为什么空，不留一行让人猜。
      label(Y_MODE, '模式')
      if (props.mode) {
        nodes.push(
          h(TText, {
            x: props.tipsX,
            y: Y_MODE_VAL,
            w: MODE_W,
            h: 1,
            value: props.mode,
            style: props.mode === 'plan' ? styles.statusActive : styles.tipCmd,
          }),
        )
        nodes.push(
          h(TText, {
            x: props.tipsX + MODE_W,
            y: Y_MODE_VAL,
            w: Math.max(2, w - MODE_W),
            h: 1,
            value: MODE_HINT[props.mode] ?? '',
            style: styles.tipDesc,
          }),
        )
      } else if (Y_MODE_VAL < props.height) {
        nodes.push(
          h(TText, { x: props.tipsX, y: Y_MODE_VAL, w, h: 1, value: '— mock 无 harness 模式', style: styles.faint }),
        )
      }
      label(Y_TIPS, 'Tips')
      TIP_CMDS.forEach((cmd, i) => {
        const item = COMMANDS.find((c) => c.cmd === cmd)
        // 右列窄：优先用短描述（texts.ts 的 short），没写就回落完整 desc
        if (item) row(Y_CMD + i, cmd, item.short ?? item.desc)
      })
      label(Y_KEYS, '快捷键')
      KEY_HINTS.forEach((hint, i) => row(Y_KEYS + 1 + i, hint.keys, hint.what))
      return nodes
    }
  },
})
