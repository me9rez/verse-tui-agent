/**
 * 缩进基准探针：同一条文本，role 分别为 tool / system / assistant，
 * 看库给每种 role 加了多少前导空格（这决定我自己该加多少）。
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { TTranscriptView } from '@simon_he/vue-tui/agent'
import type { TTranscriptDataSource, TTranscriptRow } from '@simon_he/vue-tui/agent'
import { defineComponent, h } from 'vue'

const rows: TTranscriptRow[] = [
  { kind: 'message', key: 'a', role: 'tool', segments: [{ text: 'X0 tool 无缩进' }] },
  { kind: 'message', key: 'b', role: 'system', segments: [{ text: 'X0 system 无缩进' }] },
  { kind: 'message', key: 'c', role: 'assistant', segments: [{ text: 'X0 assistant 无缩进' }] },
  { kind: 'message', key: 'd', role: 'tool', segments: [{ text: '  X2 tool 自己加 2 空格' }] },
]

const source: TTranscriptDataSource = { rowCount: () => rows.length, getRow: (i) => rows[i]! }
const Host = defineComponent({ render: () => h(TTranscriptView, { x: 0, y: 0, w: 60, h: rows.length + 1, source, version: 1 }) })

const app = createTerminalApp({ cols: 60, rows: rows.length + 1, component: Host })
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
await new Promise((r) => setTimeout(r, 60))
for (let y = 0; y < rows.length + 1; y++) {
  const line = app.terminal
    .getRow(y)
    .map((c) => c.ch)
    .join('')
  if (line.trim()) console.log(`y=${y} 前导空格=${line.length - line.trimStart().length}  [${line.trimEnd()}]`)
}
app.dispose()
