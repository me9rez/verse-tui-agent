/**
 * /effort 思考强度命令的离线面：真实注入按键 + api.submit，断言屏幕与转写。
 *
 *   pnpm effort   （= vitest run test/effort.test.ts；离线 mock，不需要后端/key）
 *
 * 断言：
 *   1. '/' 补全弹窗出现 /effort 的 detail 文案（欢迎块 Tips 没有 /effort，判别安全）
 *   2. mock 下 /effort high 文本路径 → 「mock 剧本，没有思考档位」守卫提示进转写
 *   3. mock 下无参 /effort → 同样回退提示，思考强度选择器不弹（rpc 才弹）
 *   4. /help 的 HELP 文案含 /effort（COMMANDS 单一数据源派生）
 *   5. /effort 的档位守卫只走 mock 分支——真实 thinking/get·set 链路在 pytest 协议套件断言
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

test('/effort 思考强度：补全、mock 守卫与选择器回退', { timeout: 300_000 }, async () => {
  await sleep(150)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api

  if (!app.events.getFocused()) {
    const node = app.events.debugNodes().find((n) => n.focusable && n.visible)
    if (node) app.events.focus(node.id)
  }

  /** 注入一个按键（与 stdin driver 同构的 keydown 记录）。 */
  function key(k: string, opts: Record<string, boolean> = {}): boolean {
    return app.events.dispatch({ type: 'keydown', key: k, ...opts })
  }
  const screen = (): string => api.screenText().join('\n')
  const storeText = (): string =>
    api.store.entries
      .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
      .join('\n')

  // 1. 输入 '/eff' 收窄 → 补全弹窗里有 /effort 的 detail（欢迎块 Tips 没有 /effort 文案；
  //    补全 promptMaxItems=8 只显前 8 条，/effort 排第 13，必须收窄才进首窗）
  for (const ch of '/eff') key(ch)
  await sleep(120)
  const s1 = screen()
  check(
    "查询 '/eff' 补全出现 /effort",
    s1.includes('弹出思考强度选择器'),
    '屏幕上出现 /effort 的 detail 文案（首窗内、欢迎块没有）',
  )
  key('Escape')
  await sleep(80)

  // 2. mock 下 /effort high → 守卫提示进转写（真实切换在 rpc 后端，pytest 协议套件覆盖）
  api.submit('/effort high')
  await sleep(150)
  check(
    'mock 下 /effort <档位> 走守卫',
    storeText().includes('mock 剧本，没有思考档位'),
    'applyEffortSwitch 的 mock 分支提示可见',
  )

  // 3. mock 下无参 /effort → 回退提示且选择器不弹（rpc 才弹）
  api.submit('/effort')
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && storeText().split('mock 剧本，没有思考档位').length < 3) await sleep(30)
  await sleep(100)
  const s3 = screen()
  lastScreen = s3
  check(
    'mock 下无参 /effort 回退提示',
    storeText().split('mock 剧本，没有思考档位').length >= 3,
    '守卫提示出现两次（带参与无参）',
  )
  check(
    '思考强度选择器在 mock 下不弹',
    !s3.includes('选择模型') && !s3.includes('↑↓ 选择 · Enter 切换'),
    'TCommandPalette 的标题/提示不在屏幕上',
  )

  // 4. /help 文案含 /effort（COMMANDS 派生，别在别处抄命令表）
  api.submit('/help')
  await sleep(150)
  check(
    '/help 含 /effort 条目',
    storeText().includes('/effort <档位>') && storeText().includes('弹出思考强度选择器'),
    'HELP 文案由 COMMANDS 派生出 /effort 行',
  )
})

afterAll(() => {
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/effort-screen.txt', `${lastScreen}\n`, 'utf8')
  writeFileSync(
    '.artifacts/effort.html',
    rowsToHtml(
      Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
      { cols: COLS, caption: '/effort · mock 守卫' },
    ),
    'utf8',
  )
  out.dispose()
  app.dispose()
})
