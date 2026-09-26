/**
 * 弹窗域：把三个选择器（/model、/open、/effort）的装配收在一处。
 *
 * 三者只有「条目来源、标题、条目上限、选中语义」不同，开关与受控高亮的样板逐字相同
 *（受控高亮必须双向绑：TCommandPalette 源码读 props.selectedIndex ?? inner，只传静态值会冻结 ↑↓）。
 * 挂载位置由 App 决定（必须和输入行同在 overlay plane，普通 plane 会被逐帧合并吃掉）。
 */
import { defineComponent, h, type PropType } from 'vue'
import type { TCommandPaletteItem } from '@simon_he/vue-tui'
import { CommandPicker } from './CommandPicker.ts'
import { listSessions, loadSession } from '../../session/persist/index.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { EffortControl } from '../hooks/useEffortControl.ts'
import type { ModelControl } from '../hooks/useModelControl.ts'
import type { SessionController } from '../hooks/useSessionController.ts'

export const PickerStack = defineComponent({
  name: 'PickerStack',
  props: {
    cols: { type: Number, required: true },
    model: { type: Object as PropType<ModelControl>, required: true },
    session: { type: Object as PropType<SessionController>, required: true },
    effort: { type: Object as PropType<EffortControl>, required: true },
    store: { type: Object as PropType<TranscriptStore>, required: true },
  },
  setup(props) {
    /** /open 选中：打开与选择之间会话可能被删，所以重读盘兜底 */
    function pickSession(item: TCommandPaletteItem): void {
      const id = String(item.value)
      const target = listSessions().find((s) => s.id === id) ?? loadSession(id)
      if (target) props.session.switchToSession(target)
      else props.store.addNote(`会话「${id}」已不存在（可能被删了）。`)
    }

    return () => [
      // /model：内部是 TDialog placement:center，居中弹窗；条目来自 config/get 的 [models]
      h(CommandPicker, {
        open: props.model.pickerOpen.value,
        title: '选择模型',
        items: props.model.items.value,
        selectedIndex: props.model.selIdx.value,
        maxVisibleItems: 8,
        cols: props.cols,
        onClose: () => {
          props.model.pickerOpen.value = false
        },
        onIndexChange: (i: number) => {
          props.model.selIdx.value = i
        },
        onSelect: (item: TCommandPaletteItem) => {
          void props.model.applySwitch(String(item.value))
        },
      }),
      // /open：条目在打开瞬间从盘上构建（fs 无响应式依赖，见 useSessionController）
      h(CommandPicker, {
        open: props.session.pickerOpen.value,
        title: '切换会话',
        items: props.session.pickerItems.value,
        selectedIndex: props.session.pickerSelIdx.value,
        maxVisibleItems: 10,
        cols: props.cols,
        onClose: () => {
          props.session.pickerOpen.value = false
        },
        onIndexChange: (i: number) => {
          props.session.pickerSelIdx.value = i
        },
        onSelect: pickSession,
      }),
      // /effort：条目在打开瞬间从 thinking/get 构建（同上）
      h(CommandPicker, {
        open: props.effort.pickerOpen.value,
        title: '思考强度',
        items: props.effort.items.value,
        selectedIndex: props.effort.selIdx.value,
        maxVisibleItems: 8,
        cols: props.cols,
        onClose: () => {
          props.effort.pickerOpen.value = false
        },
        onIndexChange: (i: number) => {
          props.effort.selIdx.value = i
        },
        onSelect: (item: TCommandPaletteItem) => {
          void props.effort.applySwitch(String(item.value))
        },
      }),
    ]
  },
})
