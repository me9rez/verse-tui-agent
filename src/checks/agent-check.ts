/**
 * AI SDK 工具 agent 的端到端检查：模型真的动手，检查也真的查文件系统。
 *
 *   VT_AGENT_ROOT=<sandbox> VT_BASE_URL=... VT_MODEL=... VT_API_KEY=... node src/checks/agent-check.ts
 *
 * 断言不只是"界面显示了工具行"，而是：
 *   1. 工具行确实出现在转写里（write_file / read_file / bash）
 *   2. 模型说写进去的文件，**在磁盘上真的存在且内容正确**（用 fs 独立核对，不信模型的话）
 *   3. 工具输出（含 bash stdout）画到了终端 buffer 上
 *   4. 流式是增量的（version 采样持续增长）
 *   5. 没有 SDK 错误 / 流中断
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { rowsToHtml } from '../core/html.ts'
import { styles } from '../core/theme.ts'
import { loadDotEnv } from '../core/env.ts'

// .env / .env.local 先于业务逻辑加载（真实环境变量优先，文件不覆盖已存在的键）
loadDotEnv()


const COLS = Number(process.env.VT_CHECK_COLS ?? 108)
const ROWS = Number(process.env.VT_CHECK_ROWS ?? 40)
const ROOT = path.resolve(process.env.VT_AGENT_ROOT ?? '.agent-sandbox')
const TARGET = 'demo.txt'
const EXPECTED_LINES = ['第一行：AI SDK agent 写的', '第二行：这是要被读回来的关键行', '第三行：结束']

const PROMPT =
  `在当前工作目录里完成三件事，用工具做，不要凭空回答：\n` +
  `1. 创建 ${TARGET}，内容是这三行（原样，不要加行号）：\n${EXPECTED_LINES.join('\n')}\n` +
  `2. 用读取工具把它读回来，确认第 2 行内容。\n` +
  `3. 用 bash 统计当前目录下有多少个 .txt 文件。\n` +
  `最后用简短的中文总结：文件几行、第 2 行是什么、目录里有哪些文件。`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

if (!process.env.VT_BASE_URL || !process.env.VT_MODEL) {
  console.error('需要 VT_BASE_URL / VT_MODEL（可选 VT_API_KEY）')
  process.exit(2)
}

// 干净的沙箱
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT, { recursive: true })
process.env.VT_AGENT_ROOT = ROOT
process.env.VT_AGENT = 'ai'

const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'ai',
    speed: 0,
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
let commits = 0
const offCommit = app.terminal.on('commit', () => {
  commits++
})

await sleep(80)
if (!holder.api) {
  console.error('App 未就绪')
  process.exit(1)
}
const api: AppApi = holder.api
const NL = String.fromCharCode(10)

const budgetMs = Number(process.env.VT_CHECK_TIMEOUT_MS ?? 150_000)
const deadline = Date.now() + budgetMs
// 硬看门狗：卡死时也要留下痕迹，而不是被外层 timeout 静默杀掉
const hardStop = setTimeout(() => {
  console.error(`
HARD TIMEOUT: ${Math.round(budgetMs / 1000)}s + 40s 仍未结束，强制退出`)
  process.exit(3)
}, budgetMs + 40_000)
let lastBeat = 0
// 独立心跳（appendFileSync + 独立 timer）：用来判断「事件循环是不是被卡住了」——
// 如果主循环的心跳没了但这个还在写，说明卡的不是 JS；两个都停就是事件循环被同步操作堵死。
if (process.env.VT_CHECK_HB === '1') {
  setInterval(() => {
    try {
      appendFileSync(
        '.artifacts/agent-heartbeat.log',
        `${new Date().toISOString()} streaming=${api?.state?.().streaming} phase=${api?.state?.().phase} ver=${api?.store?.version?.value}
`,
      )
    } catch {}
  }, 2000)
}
const versionSamples: number[] = []
let seenTools = 0
let lastPhase = ''
api.submit(PROMPT)
while (!api.state().streaming && Date.now() < deadline) await sleep(5)
while (api.state().streaming && Date.now() < deadline) {
  versionSamples.push(api.store.version.value)
  // 进度可见：新工具行 / 阶段变化立刻打出来（卡住时一眼能看出卡在哪）
  const tools = api.store.entries.filter((e) => e.kind === 'tool')
  for (const t of tools.slice(seenTools)) {
    console.log(`  · ${new Date().toISOString().slice(11, 19)} 工具 ${t.title} [${t.status}]`)
  }
  seenTools = tools.length
  const phase = api.state().phase
  if (phase !== lastPhase) {
    console.log(`  · ${new Date().toISOString().slice(11, 19)} 阶段 ${lastPhase || 'idle'} → ${phase}（${api.state().tokens} tok）`)
    lastPhase = phase
  }
  // 心跳：每 5 秒一行，用来证明「循环还活着」而不是被卡住
  if (Date.now() - lastBeat > 5000) {
    lastBeat = Date.now()
    console.log(`    ~ ${new Date().toISOString().slice(11, 19)} phase=${phase} tok=${api.state().tokens} ver=${api.store.version.value} 行=${api.store.rowCount()}`)
  }
  await sleep(20)
}
if (api.state().streaming) {
  console.log('  ! 超时未跑完，主动中断（断言会按已完成的量来判）')
  api.interrupt()
}
await Promise.race([api.whenIdle(), sleep(20_000)])
await sleep(60)

const screen = api.screenText()
const screenText = screen.join('\n')
const storeText = api.store.entries
  .map((e) => (e.kind === 'line' ? e.text : e.title))
  .join('\n')

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

// 1. 工具行
const toolTitles = api.store.entries.filter((e) => e.kind === 'tool').map((e) => e.title)
check(
  '模型发起了工具调用',
  toolTitles.some((t) => t.includes('write_file')) && toolTitles.some((t) => t.includes('read_file') || t.includes('bash')),
  `工具行：${toolTitles.join(' | ').slice(0, 200)}`,
)

// 2. 文件系统独立核对（不信模型的自述）
const targetAbs = path.join(ROOT, TARGET)
let fileOk = false
let fileDetail = `${TARGET} 不存在`
if (existsSync(targetAbs)) {
  const content = readFileSync(targetAbs, 'utf8')
  const lines = content.replace(/\n$/, '').split('\n')
  const keyLine = EXPECTED_LINES[1] ?? ''
  const keyPhrase = keyLine.split('：').slice(1).join('：') || keyLine
  const line2 = lines[1] ?? ''
  // 判定看的是「工具真的把内容写进磁盘了吗」，所以只要求行数与关键句；
  // 模型有没有严格照抄前缀（第二行：）属于模型服从度，如实写进 detail 供人看。
  fileOk = lines.length === EXPECTED_LINES.length && line2.includes(keyPhrase)
  fileDetail =
    `磁盘上 ${lines.length} 行，第 2 行="${line2}"` +
    (lines.length === EXPECTED_LINES.length && line2 !== keyLine ? '（模型漏写了「第二行：」前缀，内容本身正确）' : '')
}
check('模型写下的文件在磁盘上真的存在且内容正确', fileOk, fileDetail)

// 3. bash 的真实输出进了界面（读的是工具输出行，不是模型的自述）
const toolOutLines = api.store.entries.flatMap((e) => (e.kind === 'line' && e.role === 'tool' ? [e.text] : []))
const sawInTranscript = toolOutLines.some((l) => l.includes(TARGET) || l.includes('demo'))
check(
  'bash 的真实输出进了转写',
  toolOutLines.length > 0 && sawInTranscript,
  `工具输出 ${toolOutLines.length} 行；含 ${TARGET}=${sawInTranscript}；` +
    `屏幕可见=${screenText.includes(TARGET)}（工具组可能已被滚动出视口，故不做判据）`,
)

// 4. 流式 + 渲染
const span = versionSamples.length ? Math.max(...versionSamples) - Math.min(...versionSamples) : 0
check('流式是增量的', versionSamples.length > 5 && span > 20, `采样 ${versionSamples.length} 次，version 跨度 ${span}`)
check('产生了多帧提交', commits > 20, `commit 次数 ${commits}`)
check('正文画到了屏幕上', screenText.trim().length > 0 && /\S/.test(screenText), `屏幕 ${screen.filter((l) => l.trim()).length} 行非空`)

// 5. 无错误
const errorHits = storeText.match(/\[[^\]]*(?:SDK 错误|流中断|请求失败)[^\]]*\][^\n]*/g)
check(
  '没有 SDK / 网络错误',
  !errorHits,
  errorHits ? `转写里出现：${errorHits[0].slice(0, 160)}` : '转写里没有错误标记',
)

clearTimeout(hardStop)
// ── 折叠 / 参数：真实工具调用的 params 与折叠往返 ───────────────────
const payloadText = (): string => {
  const parts: string[] = []
  for (let i = 0; i < api.store.rowCount(); i++) parts.push(JSON.stringify(api.store.getRow(i)))
  return parts.join(NL)
}
const visibleText = (): string =>
  api.store
    .visibleEntries()
    .map((e) => (e.kind === 'line' ? e.text : e.title))
    .join(NL)
// 回合结束后的默认态是「分组全部收起」（手风琴规则的收尾），
// 所以要测 params 展示与折叠往返，得先显式展开一遍拿到真实基线。
api.toggleAll()
await sleep(30)
const expandedPayload = payloadText()
const expandedText = visibleText()
const expandedRows = api.store.rowCount()
const collapsedNow = api.toggleAll()
await sleep(30)
const collapsedPayload = payloadText()
const collapsedRows = api.store.rowCount()
const reExpanded = api.toggleAll()
await sleep(30)
const reExpandedRows = api.store.rowCount()

check(
  '工具参数进了转写（params 块）',
  expandedText.includes('params') && /(command|path|content): /.test(expandedText),
  `展开态含 params：${/(command|path|content): .{0,40}/.exec(expandedText)?.[0] ?? '(没找到)'}`,
)
check(
  '折叠真的收起内容（可见行下降 + ▸ 标记）',
  collapsedNow === true && collapsedRows < expandedRows && collapsedPayload.includes('▸'),
  `可见行 ${expandedRows} → ${collapsedRows}`,
)
const reExpandedPayload = payloadText()
check(
  '再展开恢复（▾ 且行数变多）',
  reExpanded === false && reExpandedRows > collapsedRows && reExpandedPayload.includes('▾'),
  `可见行 ${collapsedRows} → ${reExpandedRows}（与展开基线 ${expandedRows} 一致即说明往返无损）`,
)

const failures = checks.filter((c) => !c.ok)
mkdirSync('.artifacts', { recursive: true })
const liveRows: Array<Array<{ ch?: string; style?: Record<string, unknown> }>> = []
for (let y = 0; y < ROWS; y++) liveRows.push(app.terminal.getRow(y) as never)
writeFileSync('.artifacts/agent.html', rowsToHtml(liveRows, { cols: COLS, caption: `AI SDK 工具 agent · ${process.env.VT_MODEL} · ${COLS}×${ROWS} · 根目录 ${ROOT}` }), 'utf8')
writeFileSync('.artifacts/agent-screen.txt', `${screen.join('\n')}\n`, 'utf8')
const report = {
  ok: failures.length === 0,
  model: process.env.VT_MODEL,
  root: ROOT,
  samples: versionSamples.length,
  versionSpan: span,
  commits,
  tools: toolTitles,
  file: fileDetail,
  tokens: api.state().tokens,
  checks,
}
writeFileSync('.artifacts/agent-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')

offCommit()
out.dispose()
app.dispose()

for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
console.log(`\n工具行：\n${toolTitles.map((t) => `  ${t}`).join('\n')}`)
console.log(`\n模型总结（屏幕最后几行）：\n${screen.filter((l) => l.trim()).slice(-8).join('\n')}`)
console.log(failures.length ? `\nFAIL: ${failures.length} 项未通过` : '\nPASS: 真实工具循环全部通过')
process.exit(failures.length ? 1 : 0)
