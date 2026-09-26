/**
 * 命令面板薄包装：/model、/open、/effort 三个选择器共用同一套 TCommandPalette 配置。
 *
 * 三个调用点此前的参数逐字重复（只差 title / 条目 / 上限），这里收成一处；
 * 行为差异全部通过 props 表达（条目上限、onSelect 语义由调用方决定）。
 *
 * 必须挂 overlay plane（与输入行同平面）：挂普通 plane 会被逐帧合并吃掉（实测：7 槽只剩 1 行）。
 * selectedIndex 是受控 prop（库只认 props.selectedIndex ?? inner，只传静态值会冻结 ↑↓），必须双向绑。
 */
import { defineComponent, h, type PropType } from 'vue'
import type { TCommandPaletteItem } from '@simon_he/vue-tui'
import { TCommandPalette } from '@simon_he/vue-tui'
import { cellWidth } from '../../core/text.ts'

/** 选择器宽度自适应：最长一行（label + 2 格间隙 + detail）+ 6 格内边距，防右列截断。 */
export function pickerRowWidth(list: readonly TCommandPaletteItem[]): number {
  if (!list.length) return 30
  const widest = Math.max(
    ...list.map((it) => cellWidth(String(it.label)) + 2 + cellWidth(String(it.detail ?? ''))),
  )
  return widest + 6
}

export const CommandPicker = defineComponent({
  name: 'CommandPicker',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, required: true },
    items: { type: Array as PropType<TCommandPaletteItem[]>, required: true },
    selectedIndex: { type: Number, default: 0 },
    maxVisibleItems: { type: Number, default: 8 },
    cols: { type: Number, required: true },
    /** 面板自己关掉（Esc / 选中）时回调：调用方把 open 置回 false */
    onClose: { type: Function as PropType<() => void>, required: true },
    onIndexChange: { type: Function as PropType<(i: number) => void>, required: true },
    onSelect: { type: Function as PropType<(item: TCommandPaletteItem) => void>, required: true },
  },
  setup(props) {
    return () =>
      h(TCommandPalette, {
        modelValue: props.open,
        'onUpdate:modelValue': (v: boolean) => {
          if (!v) props.onClose()
        },
        title: props.title,
        placeholder: '输入过滤…',
        hint: '↑↓ 选择 · Enter 切换 · Esc 取消',
        items: props.items,
        showRowDetails: true,
        closeOnSelect: true,
        resetQueryOnClose: true,
        maxVisibleItems: props.maxVisibleItems,
        w: Math.max(30, Math.min(props.cols - 4, pickerRowWidth(props.items))),
        h: Math.max(8, 7 + Math.min(props.items.length, props.maxVisibleItems)),
        selectedIndex: props.selectedIndex,
        'onUpdate:selectedIndex': (i: number) => props.onIndexChange(i),
        onSelect: (p: { item: TCommandPaletteItem }) => props.onSelect(p.item),
      })
  },
})
