/**
 * 排版探针：把转写行按 JSON 打出来（含前导空格数），用来看块间空行与缩进是否到位。
 *   node src/probes/layout.ts
 */
import { loadDotEnv } from '../core/env.ts'
loadDotEnv()

import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'

const COLS = 110
const ROWS = 60
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    speed: 0.02,
    onReady(next: AppApi) {
      holder.api = next
    },
  },
  defaultStyle: styles.text,
})
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

await sleep(60)
if (!holder.api) process.exit(1)
const api: AppApi = holder.api
api.submit(process.env.VT_PROBE_PROMPT ?? '这个 demo 的流式输出是怎么实现的？')
const deadline = Date.now() + 30_000
while (!api.state().streaming && Date.now() < deadline) await sleep(5)
while (api.state().streaming && Date.now() < deadline) await sleep(10)
await api.whenIdle()
await sleep(50)

const rows = api.store.visibleEntries()
let prevBlank = false
rows.forEach((e, i) => {
  const text = e.kind === 'line' ? e.text : (e as { title: string }).title
  const indent = text.length - text.trimStart().length
  const blank = text.trim() === ''
  const tag = blank ? 'BLANK' : `indent=${indent}`
  console.log(`${String(i).padStart(3)} | ${tag.padEnd(9)} | ${JSON.stringify(text.slice(0, 70))}`)
  prevBlank = blank
})
const textOf = (e: (typeof rows)[number]): string => (e.kind === 'line' ? e.text : (e as { title: string }).title)
const doubles = rows.filter(
  (e, i) => i > 0 && textOf(e).trim() === '' && textOf(rows[i - 1]!).trim() === '',
).length
console.log(`\n总行 ${rows.length}；连续空行=${doubles}`)

// 顺带把「真正画到屏幕上的前导空格」量一遍——排版问题最终看这个
console.log('\n=== 缓冲区的缩进（前导空格）===')
for (let y = 0; y < ROWS; y++) {
  const line = api.rowText(y)
  if (!line.trim()) continue
  console.log(`${String(y).padStart(3)} | leading=${String(line.length - line.trimStart().length).padStart(2)} | ${line.slice(0, 60)}`)
}
out.dispose()
app.dispose()
