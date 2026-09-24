/**
 * RPC 后端的端到端检查：WebSocket + JSON-RPC 2.0，把断言建立在实际收到的事件上。
 *
 *   先起服务端：pnpm backend
 *   再跑：      node src/checks/rpc-check.ts   （或 pnpm rpc；--url/--prompt/--timeout 覆盖 [check] 默认）
 *
 * 断言：
 *   1. 后端真的在流式推事件（version 在过程中持续增长，不是一次性给完）
 *   2. 模型文本落到了终端 buffer 上（拿正文首行去屏幕里找）
 *   3. 没有 [请求失败]/[流中断]/[RPC 错误] 字样（HTTP/网络/RPC 错误都会写进转写）
 *   4. markdown 结构被解析（存在 code/heading/bullet 等非 plain 行）
 *
 * 与 smoke 一样传 persist: false：不往仓库 .verse-sessions/ 写测试会话。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { getBackendModel } from '../session/model.ts'
import { styles } from '../core/theme.ts'
import { rowsToHtml } from '../core/html.ts'
import { DEFAULT_RPC_URL, effectiveConfig, fetchBoot, setBoot } from '../core/config.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const COLS = 100
const ROWS = 44
const RPC_URL = flag('--url') ?? DEFAULT_RPC_URL
// 断言预算与提示词的默认值来自 tui.toml [check]（经 gateway config/get），flag 可覆盖
const boot = await fetchBoot(RPC_URL)
setBoot(boot)
const checkCfg = effectiveConfig().tui.check
const PROMPT =
  flag('--prompt') ||
  checkCfg.prompt ||
  '用一个 ts 代码块加三条要点，讲清 WebSocket 和 SSE 做流式输出各适合什么场景，控制在 15 行以内。'
const TIMEOUT_MS = Number(flag('--timeout') ?? checkCfg.timeout_ms) || 150_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }

// 开跑前先探一下服务端在不在：不在就给明确指引，而不是等转写里冒出 [RPC 错误]
try {
  const probe = await fetch(RPC_URL.replace(/^ws/, 'http'), { signal: AbortSignal.timeout(2000) }).catch(() => null)
  // WS 服务对 HTTP GET 会回 426/400 之类——只要 TCP 通了就算活着；fetch 挂了才是没起
  void probe
} catch {
  /* 同上，忽略 */
}

const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'rpc',
    speed: 1,
    persist: false,
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

console.log(`后端 ${RPC_URL}`)
console.log(`提问 ${PROMPT.slice(0, 40)}…`)

const samples: number[] = []
api.submit(PROMPT)

const deadline = Date.now() + TIMEOUT_MS
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

check('RPC 后端真的在流式推事件', span >= 20 && samples.length >= 10, `采样 ${samples.length} 次，version 跨度 ${span}`)
check(
  '没有 HTTP/网络/RPC 错误',
  !/\[请求失败\]|\[流中断\]|\[RPC 错误\]/.test(storeText) && !/\[请求失败\]|\[流中断\]|\[RPC 错误\]/.test(screenAll),
  '转写里没有 [请求失败]/[流中断]/[RPC 错误]',
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
check('耗时合理', elapsedMs > 200 && elapsedMs < TIMEOUT_MS, `整轮 ${(elapsedMs / 1000).toFixed(1)}s`)

// model 显示：权威来源是握手 initialize.result.model（回填信号），不是任何本地配置
const bm = getBackendModel()
check(
  '握手回填后端 model 且状态栏显示',
  Boolean(bm) && screenAll.includes(bm),
  bm ? `initialize.result.model = ${bm}，状态栏可见` : 'getBackendModel() 为空（握手没回填）',
)
// harness 模式：mode/get 连接即回填，状态栏有独立模式段（新会话默认 plan）
const modeSeg = screenAll.match(/· (plan|execute) ·/)
check(
  '状态栏显示 harness 模式段',
  Boolean(modeSeg),
  modeSeg ? `模式段可见：${modeSeg[0]}` : '状态栏里没找到 · plan/execute ·',
)

const failures = checks.filter((c) => !c.ok)
const finalScreen = screen
mkdirSync('.artifacts', { recursive: true })
writeFileSync('.artifacts/rpc-screen.txt', `${finalScreen.join('\n')}\n`, 'utf8')
writeFileSync(
  '.artifacts/rpc.html',
  rowsToHtml(Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never), {
    cols: COLS,
    caption: `rpc · ${RPC_URL}`,
  }),
  'utf8',
)
writeFileSync(
  '.artifacts/rpc-report.json',
  `${JSON.stringify(
    {
      ok: failures.length === 0,
      url: RPC_URL,
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
console.log('\nRPC 后端输出快照：\n')
console.log(finalScreen.filter((l) => l.trim()).slice(-18).join('\n'))
console.log(failures.length ? `\nFAIL: ${failures.length} 项未通过` : '\nPASS: WebSocket JSON-RPC 流式链路全部通过')
process.exit(failures.length ? 1 : 0)
