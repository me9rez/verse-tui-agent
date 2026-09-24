/* 空态 dump：不提交任何消息，把 step 风格欢迎块/分割线/输入行/状态栏整屏打出来。 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { rowsToHtml } from '../core/html.ts'
import { mkdirSync, writeFileSync } from 'node:fs'

// 视口可用 argv 覆盖：node src/probes/welcomedump.ts [rows] [cols]
const ROWS = Number(process.argv[2] ?? 30)
const COLS = Number(process.argv[3] ?? 100)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: { sessionKind: 'mock', speed: 0, persist: false, onReady: (n: AppApi) => { holder.api = n } },
  defaultStyle: styles.text,
})
app.mount()
const out = createStdoutRenderer(app.terminal, {
  output: { write: () => {}, isTTY: false },
  clear: false, hideCursor: false, altScreen: false, trackResize: false, defaultBg: null,
})
void out
await sleep(200)

console.log('=== 空态整屏 ===')
for (let y = 0; y < ROWS; y++) {
  console.log(String(y).padStart(2, '|'), JSON.stringify(app.terminal.getRow(y).map((c) => c.ch ?? ' ').join('')))
}
mkdirSync('.artifacts', { recursive: true })
writeFileSync(
  '.artifacts/welcome.html',
  rowsToHtml(
    Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
    { cols: COLS, caption: 'step 风格空态' },
  ),
  'utf8',
)
console.log('已写出 .artifacts/welcome.html')
process.exit(0)
