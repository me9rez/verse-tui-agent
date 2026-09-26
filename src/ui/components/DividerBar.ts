/** 分割线：整行 '─'（输入区上沿与下沿各一条；每帧只有一行文本，交给 chrome plane 低频重绘）。 */
import { defineComponent, h } from 'vue'
import { TText } from '@simon_he/vue-tui'
import { styles } from '../../core/theme.ts'

export const DividerBar = defineComponent({
  name: 'DividerBar',
  props: {
    cols: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  setup(props) {
    return () =>
      h(TText, { x: 0, y: props.y, w: props.cols, h: 1, value: '─'.repeat(props.cols), style: styles.divider })
  },
})
