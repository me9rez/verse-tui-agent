/**
 * slash 命令补全的端到端检查：真实注入按键（events.dispatch keydown），断言屏幕内容。
 *
 *   pnpm complete   （= vitest run test/complete.test.ts；离线 mock，不需要后端/key）
 *
 * 断言：
 *   1. 输入 '/' 弹出命令补全（判别用欢迎块 Tips 没有的 desc：/clear、/fold）
 *   2. 继续输入 '/fo' 收窄匹配（/clear 的 detail 消失，/fold 仍在）
 *   3. 第一次 Enter = 采用建议而非提交（弹窗收起，转写里还没有 /fold 执行记录）
 *   4. 第二次 Enter = 真提交（/fold 的「…全部分组」note 进入转写，输入框清空）
 *   5. Shift+Tab 快捷键：mock 下提示「没有 harness 模式」
 *
 * 与 smoke 一样传 persist: false：不往仓库 .verse-sessions/ 写测试会话。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { afterAll, expect, test } from 'vitest'
import { App, type AppApi } from '../src/ui/App.ts'
import { styles } from '../src/core/theme.ts'
import { rowsToHtml } from '../src/core/html.ts'

const COLS = 100
const ROWS = 44

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }

const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'mock',
    speed: 0,
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

/** 软断言 = 旧 check()「失败不阻断、最后统一算账」语义 */
const check = (name: string, ok: boolean, detail: string): void => {
  expect.soft(ok, `${name} — ${detail}`).toBe(true)
}

/** 供 afterAll 写产物的最后一帧屏幕 */
let lastScreen = ''

test('slash 命令补全的按键链路', { timeout: 300_000 }, async () => {
  await sleep(150)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api

  // prompt 弹窗只在输入框 focused 时计算（promptContext 在 !focused 时为 null）
  if (!app.events.getFocused()) {
    const node = app.events.debugNodes().find((n) => n.focusable && n.visible)
    if (node) app.events.focus(node.id)
  }
  // eslint-disable-next-line no-console
  console.log('focused node =', app.events.getFocused())

  /** 注入一个按键（与 stdin driver 同构的 keydown 记录）。 */
  function key(k: string, opts: Record<string, boolean> = {}): boolean {
    return app.events.dispatch({ type: 'keydown', key: k, ...opts })
  }
  const screen = (): string => api.screenText().join('\n')
  const storeText = (): string =>
    api.store.entries
      .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
      .join('\n')

  // 1. 输入 '/' → 弹出全部命令建议
  //    判别用欢迎块 Tips 里**没有**的命令 desc（/clear、/new），避免与空态常驻文案互相污染
  key('/')
  await sleep(120)
  const s1 = screen()
  check(
    "输入 '/' 弹出命令补全",
    s1.includes('清空转写') && s1.includes('新建一个空会话') && s1.includes('切换会话（恢复转写与模型上下文）'),
    '屏幕上出现 /clear、/new、/open 的 detail 文案（首窗内、欢迎块没有）',
  )

  // 判别词「折叠/展开全部」只有补全弹窗会写：右列（TipsColumn）的常驻文案里绝不能出现同一个串，
  // 否则「弹窗已收起」会被右列永久判为假 —— 加两列布局时就踩过一次（右列当时写的正是这个串）。
  // 2. 收窄到 '/fo' → 只剩 /fold
  key('f')
  await sleep(60)
  key('o')
  await sleep(120)
  const s2 = screen()
  check(
    "查询 '/fo' 收窄匹配",
    s2.includes('折叠/展开全部') && !s2.includes('清空转写'),
    '只剩 /fold 的 detail，/clear 被过滤（两者都不在欢迎块里）',
  )

  // 3. 第一次 Enter = 采用建议（弹窗收起、未提交）
  key('Enter')
  await sleep(120)
  const s3 = screen()
  check(
    'Enter 采用建议而非提交',
    !s3.includes('折叠/展开全部') && !storeText().includes('全部分组'),
    '弹窗收起（suppressed），转写里还没有 /fold 的执行记录',
  )

  // 4. 第二次 Enter = 真提交 → /fold 执行记录进转写
  key('Enter')
  const deadline = Date.now() + 5000
  // 空转写上 toggleAllGroups 返回 false → note 是「已展开全部分组」变体，用公共词「全部分组」判别
  while (Date.now() < deadline && !screen().includes('全部分组')) await sleep(30)
  const s4 = screen()
  lastScreen = s4
  const submitted = s4.includes('全部分组') && storeText().includes('全部分组')
  check('/fold 被真正执行', submitted, submitted ? '/fold 的「…全部分组」note 出现在转写' : '没等到执行记录')

  // 5. Shift+Tab：mock 没有 harness 模式 → 提示落到转写（真实 plan/execute 切换在 rpc.test 断言）
  key('BackTab')
  await sleep(150)
  check(
    'Shift+Tab 在 mock 下给出提示',
    storeText().includes('mock 是离线剧本，没有 harness 模式'),
    'BackTab 事件经 onKey 路由到模式切换，mock 分支提示可见',
  )
})

afterAll(() => {
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/complete-screen.txt', `${lastScreen}\n`, 'utf8')
  writeFileSync(
    '.artifacts/complete.html',
    rowsToHtml(
      Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
      { cols: COLS, caption: 'slash 补全 · mock' },
    ),
    'utf8',
  )
  out.dispose()
  app.dispose()
})
