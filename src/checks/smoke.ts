/**
 * 无头 smoke：不碰真终端，直接断言「内容真的进了终端 buffer」。
 *
 *   node src/checks/smoke.ts
 *
 * 断言的不是"函数被调用了"，而是四件实事：
 *   1. 流式是增量的（采样到的 version 持续增长，不是一次性写完）
 *   2. 正文真的画到了屏幕行上（读 terminal buffer，不是读 store）
 *   3. 工具输出是真实子进程的 stdout（能读到源文件名与统计结果）
 *   4. Esc 真的能中断一轮
 * 失败时以非 0 退出，可直接进 CI。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { loadDotEnv } from '../core/env.ts'

// .env / .env.local 先于业务逻辑加载（真实环境变量优先，文件不覆盖已存在的键）
loadDotEnv()


const COLS = 100
const ROWS = 30
const PROMPT_1 = '这个 demo 的流式渲染是怎么实现的？'
const PROMPT_LONG = '/long'

const NL = String.fromCharCode(10)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** onReady 在回调里赋值，用容器读取以免 TS 把变量收窄成 null。 */
const holder: { api: AppApi | null } = { api: null }

const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    // 给一点节奏：既够快，又能采样到中间帧（speed 0 会把整轮压进微任务）。
    speed: 0.1,
    onReady(next: AppApi) {
      holder.api = next
    },
  },
  defaultStyle: styles.text,
})
app.mount()

// 渲染器接一个黑洞输出：buffer 才是断言对象，写终端没有意义。
const out = createStdoutRenderer(app.terminal, {
  output: { write: () => {}, isTTY: false },
  clear: false,
  hideCursor: false,
  altScreen: false,
  trackResize: false,
  defaultBg: null,
})
void out

let commits = 0
const offCommit = app.terminal.on('commit', () => {
  commits++
})

await sleep(60)
if (!holder.api) {
  console.error('App 未在 60ms 内就绪（onReady 未触发）')
  process.exit(1)
}
const api: AppApi = holder.api

const screenText = (): string => api.screenText().join('\n')
/** 数据层文本：屏幕只有几十行，早期内容会滚出视口，所以完整性与屏幕断言分开。 */
const storeText = (): string => api.store.entries.map((e) => (e.kind === 'line' ? e.text : e.title)).join('\n')

// ── 第 1 轮：流式增量 ────────────────────────────────────────────────
const versionSamples: number[] = []
api.submit(PROMPT_1)
const deadline = Date.now() + 20_000
// 先等这一轮真的开跑（submit 是异步启动），再采样——否则第一帧就会漏掉。
while (!api.state().streaming && Date.now() < deadline) await sleep(2)
while (api.state().streaming && Date.now() < deadline) {
  versionSamples.push(api.store.version.value)
  await sleep(3)
}
await api.whenIdle()

const afterFirst = screenText()
const firstState = api.state()

// ── 折叠/展开：数据层（可见行）与屏幕层都要跟着变 ────────────────────
const visText = (): string =>
  api.store
    .visibleEntries()
    .map((e) => (e.kind === 'line' ? e.text : e.title))
    .join(NL)
/** 逐行取 getRow() 的 JSON：断言的是「喂给视图的行数据」，不受视口滚动影响 */
const rowPayloadText = (): string => {
  const parts: string[] = []
  for (let i = 0; i < api.store.rowCount(); i++) parts.push(JSON.stringify(api.store.getRow(i)))
  return parts.join(NL)
}
const expandedPayload = rowPayloadText()
const groupsAfterFirst = api.groups()
const expandedText = visText()
const expandedRows = api.store.rowCount()
const nowCollapsed = api.toggleAll()
await sleep(20)
const collapsedText = visText()
const collapsedRows = api.store.rowCount()
const collapsedPayload = rowPayloadText()
const nowExpanded = api.toggleAll()
await sleep(20)
const reExpandedText = visText()
const reExpandedRows = api.store.rowCount()
const reExpandedPayload = rowPayloadText()

// ── 第 2 轮：中断 ────────────────────────────────────────────────────
const rowsBeforeLong = api.store.rowCount()
api.submit(PROMPT_LONG)
await sleep(120)
api.interrupt()
await api.whenIdle()
await sleep(20)
const afterInterrupt = screenText()
const finalScreen = api.screenText()

offCommit()
out.dispose()
app.dispose()

// ── 断言 ─────────────────────────────────────────────────────────────
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

const incr = versionSamples.length ? Math.max(...versionSamples) - Math.min(...versionSamples) : 0
check('流式是增量的', versionSamples.length >= 5 && incr >= 20, `采样 ${versionSamples.length} 次，version 跨度 ${incr}`)
check('产生了多帧提交', commits >= 5, `commit 次数 ${commits}`)
check(
  '正文进入转写（数据层完整）',
  storeText().includes('流式输出的关键就三步'),
  'store 里能找到正文首句（可能已被滚动出视口）',
)
check(
  '正文末尾画在屏幕上（自动贴底）',
  /不会把你拽下来|VT_LIVE=1/.test(afterFirst),
  '视口底部是回答的最后一段：autoStickToBottom 生效',
)
check(
  '工具输出是真实子进程',
  storeText().includes('src/core/transcript/store.ts') && /合计 \d+ 个文件/.test(storeText()),
  '含 Read 的真实源码行与行数统计（由子进程 stdout 流式读入）',
)
check('工具结果状态正确', firstState.tools >= 2, `统计到 ${firstState.tools} 个工具调用`)
check(
  '工具调用显示了参数',
  expandedText.includes('params') && /(command|path): /.test(expandedText),
  `展开态工具组含 params 块：${/(command|path): .{0,40}/.exec(expandedText)?.[0] ?? '(没找到)'}`,
)
check(
  '思考被归成一个分组并自动收起',
  groupsAfterFirst.some((g) => g.kind === 'thinking' && g.collapsed && g.lines > 0),
  `groups=${JSON.stringify(groupsAfterFirst)}`,
)

// —— 颜色：断言读的是 row 里的 segments（数据层），不是屏幕像素 ——
type Seg = { text?: string; style?: { fg?: string; bg?: string } }
const rowsJson = (): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = []
  for (let i = 0; i < api.store.rowCount(); i++) out.push(api.store.getRow(i) as Record<string, unknown>)
  return out
}
const segsOf = (row: Record<string, unknown> | undefined): Seg[] =>
  Array.isArray(row?.segments) ? (row!.segments as Seg[]) : []
const fgsOf = (row: Record<string, unknown> | undefined): string[] =>
  [...new Set(segsOf(row).map((s) => s.style?.fg).filter((v): v is string => !!v))]
// 代码行：底色是 codeBg（正文里只有代码块用这个底色）。单行可能只有「基础色 + 函数色」
// 两种，所以要跨行取并集才说明高亮器真的在工作（关键字/函数/注释至少两类）。
const codeRows = rowsJson().filter(
  (r) => segsOf(r).length >= 2 && segsOf(r).every((s) => s.style?.bg === '#23252e'),
)
const codeFgs = [...new Set(codeRows.flatMap((r) => fgsOf(r)))]
check(
  '代码块按语言上色',
  codeRows.length > 0 && codeFgs.length >= 3,
  `${codeRows.length} 行代码，合计 ${codeFgs.length} 种前景色：${codeFgs.slice(0, 5).join(' ')}`,
)
// 分组头部的颜色：工具组按工具类型着色、思考组是暗色斜体 —— 至少要有两种才叫区分
const headRows = rowsJson().filter(
  (r) =>
    /^[▸▾] /.test(segsOf(r)[0]?.text ?? '') ||
    (r.kind === 'tool-call' && Array.isArray(r.summary) && (r.summary as Seg[]).length > 0),
)
const headFgs = [
  ...new Set(
    headRows
      .flatMap((r) => (r.kind === 'tool-call' ? (r.summary as Seg[]) : segsOf(r)))
      .map((s) => s.style?.fg)
      .filter((v): v is string => !!v),
  ),
]
check(
  '分组头部按类型上色',
  headFgs.length >= 2,
  `头部出现 ${headFgs.length} 种颜色：${headFgs.join(' ')}`,
)

check(
  '折叠真的隐藏了内容行',
  nowCollapsed === true && collapsedRows < expandedRows && !collapsedText.includes('合计'),
  `可见行 ${expandedRows} → ${collapsedRows}；折叠后仍能读到「合计」=${collapsedText.includes('合计')}`,
)
check(
  '展开真的恢复内容行',
  nowExpanded === false && reExpandedRows > collapsedRows && reExpandedText.includes('合计'),
  `可见行 ${collapsedRows} → ${reExpandedRows}（此前 ${expandedRows} 是「思考已自动收起」的混合态）`,
)
check(
  '折叠标记进入行数据（▸ + 已折叠）',
  collapsedPayload.includes('▸') && collapsedPayload.includes('已折叠'),
  '头部行带上 ▸ 与「N 行已折叠（点我展开）」',
)
check(
  '展开态头部显示 ▾ 与行数',
  /▾ ✻ Thinking/.test(reExpandedPayload) && /· \d+ 行/.test(reExpandedPayload) && /"collapsed":false/.test(reExpandedPayload),
  '思考头展开为 ▾ 且带「N 行」；工具行以 collapsed:false 交给库去画 ▾',
)
check('状态栏渲染正常', /✻ ready/.test(afterFirst) && /tok/.test(afterFirst), '状态栏含 ready 与 token 计数')
check(
  '输入框渲染正常',
  afterFirst.includes('输入消息 · Enter 发送') && /┌.*┐/.test(afterFirst),
  '输入框边框与标题可见（TInputBox 的 placeholder 属性在 1.1.9 未接线，故用标题承载提示）',
)
check('响应式宽度未溢出', finalScreen.every((line) => line.length <= COLS), `所有行 ≤ ${COLS} 列`)
check(
  'Esc 能中断一轮',
  api.store.rowCount() > rowsBeforeLong && /已中断/.test(afterInterrupt),
  `行数 ${rowsBeforeLong} → ${api.store.rowCount()}；屏上出现中断提示=${/已中断/.test(afterInterrupt)}`,
)

const failures = checks.filter((c) => !c.ok)
const report = {
  ok: failures.length === 0,
  cols: COLS,
  rows: ROWS,
  commits,
  versionSamples: versionSamples.length,
  versionSpan: incr,
  storeRows: api.store.rowCount(),
  stats: firstState,
  groups: groupsAfterFirst,
  checks,
}

const artifactDir = '.artifacts'
mkdirSync(artifactDir, { recursive: true })
writeFileSync(`${artifactDir}/smoke-screen.txt`, `${finalScreen.join('\n')}\n`, 'utf8')
writeFileSync(`${artifactDir}/smoke-interrupted.txt`, `${afterInterrupt}\n`, 'utf8')
writeFileSync(`${artifactDir}/smoke-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
console.log(`\n正文快照（${artifactDir}/smoke-screen.txt）：\n`)
console.log(finalScreen.filter((line) => line.trim()).slice(0, 24).join('\n'))
console.log(failures.length ? `\nFAIL: ${failures.length} 项未通过` : '\nPASS: 全部通过')
process.exit(failures.length ? 1 : 0)
