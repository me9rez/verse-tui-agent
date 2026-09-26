/**
 * 状态栏一行：左边是分段（phase · 模式 · harness 模式 · 模型 · cwd），右边是一整段（会话 · usage · tools · 耗时）。
 *
 * 段落切分与窄终端丢段的逻辑在 ui/hooks/useStatusBar.ts（纯计算），这里只负责摆坐标：
 * 左段按列宽顺序拼、右段贴右边（Math.max 防左段顶到右段）。
 */
import { defineComponent, h, type PropType } from 'vue'
import type { Style } from '@simon_he/vue-tui/core'
import { TText } from '@simon_he/vue-tui'
import { cellWidth } from '../../core/text.ts'
import { styles } from '../../core/theme.ts'

export type StatusSegment = { text: string; style: Style }

export const StatusStrip = defineComponent({
  name: 'StatusStrip',
  props: {
    parts: { type: Array as PropType<StatusSegment[]>, required: true },
    right: { type: String, default: '' },
    cols: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  setup(props) {
    return () => {
      const cols = props.cols
      const rightW = cellWidth(props.right)
      let x = 1
      const nodes = props.parts.map((p) => {
        const w = cellWidth(p.text)
        const node = h(TText, { x, y: props.y, w, h: 1, value: p.text, style: p.style })
        x += w
        return node
      })
      nodes.push(
        h(TText, {
          x: Math.max(x + 1, cols - 1 - rightW),
          y: props.y,
          w: rightW + 1,
          h: 1,
          value: props.right,
          style: styles.status,
        }),
      )
      return nodes
    }
  },
})
