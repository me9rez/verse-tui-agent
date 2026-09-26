/**
 * RPC 后端的端到端检查：WebSocket + JSON-RPC 2.0，把断言建立在实际收到的事件上。
 *
 *   先起服务端：pnpm backend
 *   再跑：      pnpm rpc   （= vitest run test/rpc.test.ts）
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
import { afterAll, expect, test } from 'vitest'
import { App, type AppApi } from '../src/ui/App.ts'
import { getBackendModel } from '../src/session/model.ts'
import { styles } from '../src/core/theme.ts'
import { rowsToHtml } from '../src/core/html.ts'
import { DEFAULT_RPC_URL, effectiveConfig, fetchBoot, setBoot } from '../src/core/config.ts'

const COLS = 100
const ROWS = 44
const RPC_URL = DEFAULT_RPC_URL

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }

/** 软断言 = 旧 check()「失败不阻断、最后统一算账」语义 */
const check = (name: string, ok: boolean, detail: string): void => {
  expect.soft(ok, `${name} — ${detail}`).toBe(true)
}

/** 供 afterAll 写产物 */
let finalScreen: string[] = []
let report: Record<string, unknown> = {}

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

test('rpc 端到端：流式 / buffer / 错误字样 / markdown / model 回填', { timeout: 300_000 }, async () => {
  // 断言预算与提示词的默认值来自 tui.toml [check]（经 gateway config/get）
  const boot = await fetchBoot(RPC_URL)
  setBoot(boot)
  const checkCfg = effectiveConfig().tui.check
  const PROMPT =
    checkCfg.prompt ||
    '用一个 ts 代码块加三条要点，讲清 WebSocket 和 SSE 做流式输出各适合什么场景，控制在 15 行以内。'
  const TIMEOUT_MS = Number(checkCfg.timeout_ms) || 150_000

  await sleep(80)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api

  // eslint-disable-next-line no-console
  console.log(`后端 ${RPC_URL} · 提问 ${PROMPT.slice(0, 40)}…`)

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
  finalScreen = screen

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
  // 同一份模式信息也常驻右列「模式」区（右列窄，用短说明；见 texts.ts 的 MODE_HINT）
  const modeHint = screenAll.match(/(只规划，等批准|自主执行)/)
  check(
    '右列模式区显示当前模式说明',
    Boolean(modeHint),
    modeHint ? `右列模式说明：${modeHint[0]}` : '右列里没找到模式短说明',
  )

  report = {
    url: RPC_URL,
    elapsedMs,
    samples: samples.length,
    versionSpan: span,
    tokens: stats.tokens,
    presets: [...presets],
  }
})

afterAll(() => {
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
  writeFileSync('.artifacts/rpc-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  out.dispose()
  app.dispose()
})
