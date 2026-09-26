/**
 * 输入行：'>' 前缀 + 无边框 TInput + 占位符 + 右端图片指示条。
 *
 * 两个实测约束：
 *  1. plugins 是 init-only —— 每帧传新数组会触发 "plugins is init-only" 警告（警告会打进真实终端），
 *     所以 plugins / promptSuggestions 在 setup 里建一次（实例级稳定引用），绝不能放进渲染函数。
 *  2. 提交后用 key 换一个新实例才是真正的"清空输入框"（否则下次输入会拼在旧文本后面），key 随 composerKey 变化。
 *
 * 坐标与宽度都是绝对单元格：有待发图片时输入框收窄，右端让位给指示条
 * （divider 紧贴输入行上方，没有第二行可用）。
 */
import { defineComponent, h, type PropType } from 'vue'
import { TText } from '@simon_he/vue-tui'
import { TInput, createPromptMentionPlugin } from '@simon_he/vue-tui/vue'
import { COMMANDS } from '../texts.ts'
import { cellWidth } from '../../core/text.ts'
import { styles } from '../../core/theme.ts'

export const ComposerRow = defineComponent({
  name: 'ComposerRow',
  props: {
    cols: { type: Number, required: true },
    y: { type: Number, required: true },
    input: { type: String, default: '' },
    /** 每次提交后自增：换掉 TInput 实例（清空它的内部文本） */
    composerKey: { type: Number, default: 0 },
    placeholder: { type: String, default: '' },
    /** 待发图片指示条文本（空串 = 不显示） */
    imageChip: { type: String, default: '' },
    onInput: { type: Function as PropType<(v: string) => void>, required: true },
    onSubmit: { type: Function as PropType<(v: string) => void>, required: true },
  },
  setup(props) {
    // 建议与 /help 同源（texts.COMMANDS）；触发字符 '/'，模糊匹配 cmd。
    const plugins = [createPromptMentionPlugin()] as const
    const suggestions = COMMANDS.map((c) => ({
      value: c.cmd,
      detail: c.usage ? `${c.usage} ${c.desc}` : c.desc,
      keywords: [c.cmd.slice(1)],
    }))
    return () => {
      const cols = props.cols
      const chip = props.imageChip
      return [
        h(TText, { x: 1, y: props.y, w: 2, h: 1, value: '>', style: styles.prefix }),
        h(TInput, {
          key: props.composerKey,
          x: 3,
          y: props.y,
          w: Math.max(4, cols - 4 - (chip ? cellWidth(chip) + 2 : 0)),
          h: 1,
          modelValue: props.input,
          'onUpdate:modelValue': (v: string) => props.onInput(v),
          onChange: (v: string) => props.onSubmit(String(v ?? '')),
          placeholder: props.placeholder,
          placeholderWhenFocused: true,
          style: styles.text,
          autoFocus: true,
          plugins,
          promptSuggestions: suggestions,
          promptTrigger: '/',
          promptMaxItems: 8,
          promptAlign: 'input',
        }),
        // 待发图片指示条：与输入行同行右端（Alt+V 置入，发送后消失）
        ...(chip
          ? [
              h(TText, {
                x: Math.max(6, cols - 2 - cellWidth(chip)),
                y: props.y,
                w: cols,
                h: 1,
                value: chip,
                style: styles.tipCmd,
              }),
            ]
          : []),
      ]
    }
  },
})
