/**
 * 无头 smoke：不碰真终端，直接断言「内容真的进了终端 buffer」。
 *
 *   pnpm smoke   （= vitest run test/smoke.test.ts）
 *
 * 断言的不是"函数被调用了"，而是四件实事：
 *   1. 流式是增量的（采样到的 version 持续增长，不是一次性写完）
 *   2. 正文真的画到了屏幕行上（读 terminal buffer，不是读 store）
 *   3. 工具输出是真实子进程的 stdout（能读到源文件名与统计结果）
 *   4. Esc 真的能中断一轮
 * 失败以 vitest failed 退出，可直接进 CI。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { listSessions, loadSession, setSessionDir } from '../src/session/persist/index.ts'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../src/ui/App.ts'
import { styles } from '../src/core/theme.ts'

// 会话落盘断言会真的写文件，所以把会话目录指到临时目录——绝不往仓库的 .verse-sessions/ 里写测试数据。
setSessionDir(mkdtempSync(join(tmpdir(), 'verse-smoke-')))


const COLS = 100
const ROWS = 30
const PROMPT_1 = '这个 demo 的流式渲染是怎么实现的？'
const PROMPT_LONG = '/long'

const NL = String.fromCharCode(10)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

/** 软断言 = 旧 check()「失败不阻断、最后统一算账」语义 */
const check = (name: string, ok: boolean, detail: string): void => {
  expect.soft(ok, `${name} — ${detail}`).toBe(true)
}

/** 供 afterAll 写产物的最后一帧 */
let finalScreen: string[] = []
let reportStats: Record<string, unknown> = {}

test('smoke：流式 / 渲染 / 折叠 / 颜色 / 落盘 / 中断全链路', { timeout: 300_000 }, async () => {
  let commits = 0
  const offCommit = app.terminal.on('commit', () => {
    commits++
  })

  await sleep(60)
  if (!holder.api) {
    throw new Error('App 未在 60ms 内就绪（onReady 未触发）')
  }
  const api: AppApi = holder.api

  const screenText = (): string => api.screenText().join('\n')
  /** 数据层文本：屏幕只有几十行，早期内容会滚出视口，所以完整性与屏幕断言分开。 */
  const storeText = (): string => api.store.entries.map((e) => (e.kind === 'line' ? e.text : e.title)).join('\n')

  // ── 第 1 轮：流式增量 ────────────────────────────────────────────────
  const versionSamples: number[] = []
  // 手风琴不变式：一轮进行中，展开的分组数任何时刻都不能超过 1
  const openGroupSamples: number[] = []
  api.submit(PROMPT_1)
  const deadline = Date.now() + 20_000
  // 先等这一轮真的开跑（submit 是异步启动），再采样——否则第一帧就会漏掉。
  while (!api.state().streaming && Date.now() < deadline) await sleep(2)
  while (api.state().streaming && Date.now() < deadline) {
    versionSamples.push(api.store.version.value)
    openGroupSamples.push(api.groups().filter((g) => !g.collapsed).length)
    await sleep(3)
  }
  await api.whenIdle()

  const afterFirst = screenText()
  const firstState = api.state()
  const groupsAfterTurn = api.groups()


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
  // 回合结束后是「全收起」，先展开全部作为基线，再测折叠往返
  api.toggleAll()
  await sleep(20)
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
  await sleep(60)
  // /long 会先清空转写：基线要取「清空后、这一轮开跑时」的行数
  const rowsAtLongStart = api.store.rowCount()
  await sleep(60)
  api.interrupt()
  await api.whenIdle()
  await sleep(20)
  const afterInterrupt = screenText()
  finalScreen = api.screenText()

  offCommit()

  // ── 断言 ─────────────────────────────────────────────────────────────
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
    /不会把你拽下来/.test(afterFirst),
    '视口底部是回答的最后一段：autoStickToBottom 生效',
  )
  check(
    '工具输出是真实子进程',
    storeText().includes('src/transcript/store.ts') && /合计 \d+ 个文件/.test(storeText()),
    '含 Read 的真实源码行与行数统计（由子进程 stdout 流式读入）',
  )
  check('工具结果状态正确', firstState.tools >= 2, `统计到 ${firstState.tools} 个工具调用`)
  check(
    '工具调用显示了参数',
    expandedText.includes('params') && /(command|path): /.test(expandedText),
    `展开态工具组含 params 块：${/(command|path): .{0,40}/.exec(expandedText)?.[0] ?? '(没找到)'}`,
  )
  check(
    '思考与每次工具调用各自成组',
    groupsAfterFirst.some((g) => g.kind === 'thinking' && g.lines > 0) &&
      groupsAfterFirst.filter((g) => g.kind === 'tool').length >= 2,
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
  const fgsOf = (row: Record<string, unknown>): string[] =>
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
    '流式中只展开当前组（手风琴）',
    openGroupSamples.length > 0 && Math.max(...openGroupSamples) <= 1,
    `采样 ${openGroupSamples.length} 次，展开组数最大值 ${openGroupSamples.length ? Math.max(...openGroupSamples) : '-'}（期望 ≤ 1）`,
  )
  check(
    '回合结束后分组全部收起',
    groupsAfterTurn.length > 1 && groupsAfterTurn.every((g) => g.collapsed),
    `${groupsAfterTurn.length} 个分组，收起 ${groupsAfterTurn.filter((g) => g.collapsed).length} 个`,
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
    '输入行渲染正常',
    afterFirst.includes('问点什么') && />/.test(afterFirst),
    "'>' 前缀与占位符可见（step 风格无边框输入行）",
  )
  check('响应式宽度未溢出', finalScreen.every((line) => line.length <= COLS), `所有行 ≤ ${COLS} 列`)
  check(
    'Esc 能中断一轮',
    api.store.rowCount() > rowsAtLongStart && /已中断/.test(afterInterrupt),
    `这一轮从 ${rowsAtLongStart} 行涨到 ${api.store.rowCount()} 行（清空前是 ${rowsBeforeLong} 行）；屏上出现中断提示=${/已中断/.test(afterInterrupt)}`,
  )

  check(
    '一轮结束后会话落盘（含用户输入与正文）',
    (() => {
      const one = listSessions()[0]
      return Boolean(one && one.turns.length >= 1 && one.turns[0]?.user === PROMPT_1 && one.turns[0].answer.length > 0)
    })(),
    (() => {
      const one = listSessions()[0]
      return `sessions=${listSessions().length} turns=${one?.turns.length ?? 0} user=${JSON.stringify(one?.turns[0]?.user ?? '')} 正文行=${one?.turns[0].answer.length ?? 0}`
    })(),
  )
  check(
    '落盘的会话能被读回来（含工具与思考）',
    (() => {
      const id = listSessions()[0]?.id
      const one = id ? loadSession(id) : null
      return Boolean(one?.turns[0].tools.length && one.turns[0].thinking.length)
    })(),
    (() => {
      const id = listSessions()[0]?.id ?? ''
      const one = id ? loadSession(id) : null
      return `id=${id} tools=${one?.turns[0]?.tools.length ?? 0} thinking=${one?.turns[0]?.thinking.length ?? 0}`
    })(),
  )

  // ── 多会话：/sessions 列表、/new 新建、/open 切换、/delete 保护当前 ──────
  api.submit('/sessions')
  await api.whenIdle()
  check(
    '/sessions 列出会话并标记当前',
    storeText().includes('会话列表') && storeText().includes('▶'),
    `含列表头=${storeText().includes('会话列表')} 含 ▶=${storeText().includes('▶')}`,
  )

  const firstId = listSessions().at(-1)?.id ?? ''
  // 空会话不落盘（首次写出内容时才建文件），所以这里断言「当前会话 id 变了 + 转写清空」
  const idBeforeNew = api.currentSessionId()
  api.submit('/new 测试会话')
  await api.whenIdle()
  check(
    '/new 换了新会话并清空转写',
    api.currentSessionId() !== idBeforeNew &&
      Boolean(api.currentSessionId()) &&
      storeText().includes('已新建会话') &&
      !storeText().includes('流式输出的关键就三步'),
    `id ${idBeforeNew} → ${api.currentSessionId()}`,
  )

  api.submit(`/open ${firstId}`)
  await api.whenIdle()
  check(
    '/open 恢复目标会话的转写',
    storeText().includes('流式输出的关键就三步') && storeText().includes('已切到'),
    `target=${firstId} 正文回来了=${storeText().includes('流式输出的关键就三步')}`,
  )
  check(
    '/open 后当前会话确实切过去了',
    api.currentSessionId() === firstId,
    `current=${api.currentSessionId()} 期望=${firstId}`,
  )

  api.submit(`/delete ${firstId}`)
  await api.whenIdle()
  check(
    '/delete 拒绝删当前会话',
    storeText().includes('不能删当前会话'),
    '出现拒绝提示',
  )

  reportStats = { commits, versionSamples: versionSamples.length, versionSpan: incr, stats: firstState }
})

afterAll(() => {
  const artifactDir = '.artifacts'
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(`${artifactDir}/smoke-screen.txt`, `${finalScreen.join('\n')}\n`, 'utf8')
  writeFileSync(`${artifactDir}/smoke-report.json`, `${JSON.stringify(reportStats, null, 2)}\n`, 'utf8')
  out.dispose()
  app.dispose()
})
