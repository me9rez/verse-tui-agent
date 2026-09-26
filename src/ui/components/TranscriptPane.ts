/**
 * 转写区：空态画欢迎块，有内容画 TTranscriptView（流式增量只重绘脏行）。
 *
 * 注意 rowIndex 是**可见行**索引，必须走 store.entryAt()（折叠后 entries[] 与可见行不再一一对应），
 * 折叠/点击的判定留在 App 的 onToggleRow 里，这里只转发 rowIndex。
 *
 * 分支前先读一次 rowCount()（它经 visibleEntries 读 version），让本组件成为 version 的依赖 ——
 * 否则空态 ↔ 有内容的切换不会唤醒渲染。
 */
import { defineComponent, h, type PropType, type Ref } from 'vue'
import { TTranscriptView } from '@simon_he/vue-tui/agent'
import { WelcomeBlock } from './WelcomeBlock.ts'
import type { TranscriptStore } from '../../transcript/index.ts'

export const TranscriptPane = defineComponent({
  name: 'TranscriptPane',
  props: {
    store: { type: Object as PropType<TranscriptStore>, required: true },
    cols: { type: Number, required: true },
    /** 转写区起点与高度（layout.ts 的 transcriptY / transcriptH） */
    y: { type: Number, required: true },
    /** 转写区高度（layout.ts 的 transcriptH） */
    height: { type: Number, required: true },
    model: { type: String, default: '' },
    /** TTranscriptView 实例（Ctrl+End 贴底用它），由 App 持有 */
    viewRef: { type: Object as PropType<Ref<{ scrollToBottom?: () => void } | null>>, default: undefined },
    onToggleRow: { type: Function as PropType<(rowIndex: number | undefined) => boolean>, required: true },
  },
  setup(props) {
    return () => {
      if (props.store.rowCount() === 0) {
        return h(WelcomeBlock, { cols: props.cols, transcriptH: props.height, model: props.model })
      }
      return h(TTranscriptView, {
        ref: props.viewRef,
        x: 0,
        y: props.y,
        w: props.cols,
        h: props.height,
        source: props.store,
        version: props.store.version.value,
        autoStickToBottom: true,
        wheelScroll: true,
        selectable: true,
        wrap: true,
        keyboardRegions: true,
        onFoldToggle: (payload: { rowIndex?: number }) => props.onToggleRow(payload?.rowIndex),
        onToolClick: (payload: { rowIndex?: number }) => props.onToggleRow(payload?.rowIndex),
        onRowClick: (payload: { rowIndex?: number }) => props.onToggleRow(payload?.rowIndex),
      })
    }
  },
})
