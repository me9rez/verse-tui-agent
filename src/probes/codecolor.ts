/**
 * 临时探针：跑一轮 mock，把「整行都是 codeBg」的 row 打出来看颜色。
 * 用来定位 smoke 的「代码块按语言上色」断言选中了哪一行。
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { loadDotEnv } from '../core/env.ts'

loadDotEnv()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: 100,
  rows: 40,
  component: App,
  props: {
    sessionKind: 'mock',
    speed: 0.05,
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
  hideCursor: true,
  altScreen: false,
  trackResize: false,
  defaultBg: null,
})
void out
await sleep(60)
if (!holder.api) process.exit(1)
holder.api.submit('这个 demo 的流式输出是怎么实现的？')
await sleep(2500)

// 先看 entry 层：哪些行被判成 code，带没带语言
const codeEntries = holder.api.store.entries.filter((e) => e.kind === 'line' && (e as { preset?: string }).preset === 'code')
const allLines = holder.api.store.entries.filter((e) => e.kind === 'line')
console.log(`总共 ${allLines.length} 行 entry，preset 分布：`)
const dist = new Map<string, number>()
for (const e of allLines) dist.set(String((e as { preset?: string }).preset), (dist.get(String((e as { preset?: string }).preset)) ?? 0) + 1)
console.log('  ' + [...dist].map(([k, v]) => `${k}=${v}`).join('  '))
console.log('含反引号的行：')
for (const e of allLines) {
  const t = String((e as { text?: string }).text ?? '')
  if (t.includes('`')) console.log(`  preset=${(e as { preset?: string }).preset} lang=${(e as { lang?: string }).lang} ${JSON.stringify(t.slice(0, 70))}`)
}
console.log(`code 行 ${codeEntries.length} 条：`)
for (const e of codeEntries.slice(0, 6)) {
  const en = e as { text?: string; lang?: string }
  console.log(`  lang=${String(en.lang)}  ${JSON.stringify((en.text ?? '').slice(0, 60))}`)
}

const rows: Array<Record<string, unknown>> = []
for (let i = 0; i < holder.api.store.rowCount(); i++) rows.push(holder.api.store.getRow(i) as Record<string, unknown>)
type Seg = { text?: string; style?: { fg?: string; bg?: string } }
const segsOf = (r: Record<string, unknown>): Seg[] => (Array.isArray(r.segments) ? (r.segments as Seg[]) : [])
let found = 0
for (const [i, r] of rows.entries()) {
  const segs = segsOf(r)
  const allCode = segs.length > 0 && segs.every((s) => s.style?.bg === '#23252e')
  if (!allCode) continue
  found++
  if (found <= 3) {
    console.log(`row ${i} kind=${String(r.kind)} segs=${segs.length}`)
    console.log('  ' + JSON.stringify(segs).slice(0, 400))
  }
}
console.log(`整行 codeBg 的 row 共 ${found} 个`)
// 顺便统计所有 row 里出现过的 bg / fg
const bgs = new Set<string>()
const fgs = new Set<string>()
for (const r of rows) for (const s of segsOf(r)) {
  if (s.style?.bg) bgs.add(s.style.bg)
  if (s.style?.fg) fgs.add(s.style.fg)
}
console.log('所有 bg:', [...bgs].join(' '))
console.log('所有 fg:', [...fgs].join(' '))
out.dispose()
process.exit(0)
