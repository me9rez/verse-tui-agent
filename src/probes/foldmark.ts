/**
 * 探针 2：tool-call row 的折叠标记在「有/无 body」×「折叠/展开」下的实际渲染。
 * 结论直接影响 toToolRow 要不要自己加 ▸/▾。
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { TTranscriptView } from '@simon_he/vue-tui/agent'
import type { TTranscriptDataSource, TTranscriptRow } from '@simon_he/vue-tui/agent'
import { defineComponent, h } from 'vue'

const rows: TTranscriptRow[] = [
  { kind: 'tool-call', key: 'a', title: '● 有body/折叠', collapsed: true, summary: [], body: [{ text: 'out  a.txt' }] },
  { kind: 'tool-call', key: 'b', title: '● 有body/展开', collapsed: false, summary: [], body: [{ text: 'out  a.txt' }] },
  { kind: 'tool-call', key: 'c', title: '● 无body/折叠', collapsed: true, summary: [], body: [] },
  { kind: 'tool-call', key: 'd', title: '● 无body/展开', collapsed: false, summary: [], body: [] },
  { kind: 'tool-call', key: 'e', title: '● 无body/无summary', collapsed: true },
]

const source: TTranscriptDataSource = {
  rowCount: () => rows.length,
  getRow: (i) => rows[i]!,
}

const Host = defineComponent({
  render: () => h(TTranscriptView, { x: 0, y: 0, w: 60, h: rows.length + 2, source, version: 1, wrap: true }),
})

const app = createTerminalApp({ cols: 60, rows: rows.length + 2, component: Host })
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
for (let y = 0; y < rows.length + 2; y++) {
  const line = app.terminal
    .getRow(y)
    .map((c) => c.ch)
    .join('')
    .trimEnd()
  if (line) console.log(`y=${y}  [${line}]`)
}
app.dispose()
