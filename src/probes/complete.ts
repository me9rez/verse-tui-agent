/**
 * 探针 v2：库自带补全（promptSuggestions）到底怎么接线才生效。
 *
 * 结论依据：TInputBox 只声明自己的 props 且不透传 → prompt* 必须给 TInput。
 * 这里照 TInputBox 的做法自己拼 TBox + TInput，看弹窗是否出现。
 *
 *   node src/probes/complete.ts
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { TBox, TInput, createPromptMentionPlugin, useTerminal } from '@simon_he/vue-tui/vue'
import { defineComponent, h } from 'vue'
import { styles } from '../core/theme.ts'

const COLS = 76
const ROWS = 16
const SUGGESTIONS = [
  { value: '/help', detail: '显示说明' },
  { value: '/sessions', detail: '列出会话' },
  { value: '/open', detail: '切换会话' },
  { value: '/new', detail: '新建会话' },
]

const Demo = defineComponent({
  setup() {
    useTerminal()
    return () => {
      const w = COLS - 4
      return h(
        TBox,
        { x: 2, y: 12, w, h: 3, border: true, title: ' 输入消息 · 打 / 看补全 ', padding: 0, style: styles.text } as never,
        () =>
          h(TInput as never, {
            x: 0,
            y: 0,
            w: Math.max(0, w - 2),
            h: 1,
            modelValue: '/',
            autoFocus: true,
            style: styles.text,
            plugins: [createPromptMentionPlugin()],
            promptSuggestions: SUGGESTIONS,
            promptTrigger: '/',
            promptMaxItems: 6,
            promptAlign: 'input',
          } as never),
      )
    }
  },
})

const app = createTerminalApp({ cols: COLS, rows: ROWS, component: Demo, defaultStyle: styles.text })
app.mount()
const out = createStdoutRenderer(app.terminal, {
  output: { write: () => {}, isTTY: false },
  clear: false,
  hideCursor: false,
  altScreen: false,
  trackResize: false,
  defaultBg: null,
})
void out

await new Promise<void>((r) => setTimeout(r, 150))

// 聚焦内部输入框：库的输入需要 focus 才会算 promptContext（promptContext 在 !focused 时返回 null）。
// 注意：terminal 没有 emit 方法（1.1.11 实测 typeof terminal.emit === 'undefined'，
// 旧写法 emit?.('focus') 是空操作）——正确入口是 events.focus(<可聚焦节点 id>)。
const inputNode = app.events.debugNodes().find((n) => n.focusable && n.visible)
if (inputNode) app.events.focus(inputNode.id)
console.log('focused node =', app.events.getFocused())

console.log('=== buffer 逐行（建议弹窗应在输入框上方）===')
for (let y = 0; y < ROWS; y++) {
  const row = app.terminal.getRow(y) // readonly Cell[]，Cell.ch 必填，无需强转
  const text = row.map((c) => c.ch ?? ' ').join('').replace(/\s+$/, '')
  console.log(String(y).padStart(2, '|'), JSON.stringify(text))
}

out.dispose()
process.exit(0)
