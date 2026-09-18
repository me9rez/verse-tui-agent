/**
 * 真实 API 的端到端检查：走 SSE，把断言建立在实际收到的字节上。
 *
 *   VT_BASE_URL=https://.../v1 VT_MODEL=<model> VT_API_KEY=... node src/checks/live-check.ts
 *   （也可用 VT_PROMPT 换提问）
 *
 * 断言：
 *   1. 端点确实流式返回（version 在过程中持续增长，不是一次性给完）
 *   2. 模型文本落到了终端 buffer 上（拿正文首行去屏幕里找）
 *   3. 没有 [请求失败]/[流中断] 字样（HTTP 或网络错误会写进转写）
 *   4. markdown 结构被解析（存在 code/heading 等非 plain 行）
 *
 * 只打印端点主机名与模型名，绝不打印 key。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { rowsToHtml } from '../core/html.ts'
import { loadDotEnv } from '../core/env.ts'

// .env / .env.local 先于业务逻辑加载（真实环境变量优先，文件不覆盖已存在的键）
loadDotEnv()


const COLS = 100
const ROWS = 44
const PROMPT = process.env.VT_PROMPT ?? '用一个 ts 代码块加三条要点，讲清 Vue 3 自定义渲染器如何把组件画到终端里，控制在 15 行以内。'

const baseUrl = process.env.VT_BASE_URL ?? ''
const model = process.env.VT_MODEL ?? ''
if (!baseUrl || !model) {
  console.error('需要 VT_BASE_URL 与 VT_MODEL（VT_API_KEY 视端点而定）')
  process.exit(2)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }

const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'live',
    speed: 1,
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

await sleep(80)
if (!holder.api) {
  console.error('App 未就绪')
  process.exit(1)
}
const api: AppApi = holder.api

console.log(`端点 ${new URL(baseUrl).host}  ·  模型 ${model}`)
console.log(`提问 ${PROMPT.slice(0, 40)}…`)

const samples: number[] = []
api.submit(PROMPT)

const deadline = Date.now() + 120_000
while (!api.state().streaming && Date.now() < deadline) await sleep(5)
const started = Date.now()
while (api.state().streaming && Date.now() < deadline) {
  samples.push(api.store.version.value)
  await sleep(25)
}
await api.whenIdle()
await sleep(60)

const elapsedMs = Date.now() - started
const screen = api.screenText()
const screenAll = screen.join('\n')
const storeText = api.store.entries.map((e) => (e.kind === 'line' ? e.text : e.title)).join('\n')
const lineEntries = api.store.entries.filter((e) => e.kind === 'line')
const answerLines = lineEntries.filter((e) => e.role === 'assistant' && e.text.trim())
const answerFirst = answerLines[0]?.text.trim() ?? ''
const presets = new Set(lineEntries.filter((e) => e.role === 'assistant').map((e) => e.preset))
const stats = api.state()
const span = samples.length ? Math.max(...samples) - Math.min(...samples) : 0

const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

check('端点真的在流式返回', span >= 20 && samples.length >= 10, `采样 ${samples.length} 次，version 跨度 ${span}`)
check(
  '没有 HTTP/网络错误',
  !/\[请求失败\]|\[流中断\]/.test(storeText) && !/\[请求失败\]|\[流中断\]/.test(screenAll),
  '转写里没有 [请求失败]/[流中断]',
)
check('模型文本进入了转写', answerLines.length >= 3 && stats.tokens > 0, `${answerLines.length} 行正文，约 ${stats.tokens} tok`)
check(
  '正文画到了屏幕上',
  answerFirst.length > 0 && screenAll.includes(answerFirst.slice(0, Math.min(12, answerFirst.length))),
  answerFirst ? `屏幕上找到正文首行片段：${answerFirst.slice(0, 24)}` : '没有正文行',
)
check(
  'markdown 被解析成结构化行',
  [...presets].some((p) => p !== 'plain'),
  `行样式集合：${[...presets].join('/') || '(none)'}`,
)
check('耗时合理', elapsedMs > 200 && elapsedMs < 120_000, `整轮 ${(elapsedMs / 1000).toFixed(1)}s`)

const failures = checks.filter((c) => !c.ok)
const finalScreen = screen
mkdirSync('.artifacts', { recursive: true })
writeFileSync('.artifacts/live-screen.txt', `${finalScreen.join('\n')}\n`, 'utf8')
writeFileSync(
  '.artifacts/live.html',
  rowsToHtml(
    Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
    { cols: COLS, caption: `live · ${model} · ${new URL(baseUrl).host}` },
  ),
  'utf8',
)
writeFileSync(
  '.artifacts/live-report.json',
  `${JSON.stringify(
    {
      ok: failures.length === 0,
      host: new URL(baseUrl).host,
      model,
      elapsedMs,
      samples: samples.length,
      versionSpan: span,
      tokens: stats.tokens,
      storeRows: api.store.rowCount(),
      presets: [...presets],
      checks,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
console.log('\n模型输出快照：\n')
console.log(finalScreen.filter((l) => l.trim()).slice(-18).join('\n'))
console.log(failures.length ? `\nFAIL: ${failures.length} 项未通过` : '\nPASS: 真实 API 流式链路全部通过')
process.exit(failures.length ? 1 : 0)
