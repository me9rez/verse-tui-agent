/**
 * /theme 主题命令的离线面：真实注入按键 + api.submit，断言 palette 与屏幕。
 *
 *   pnpm theme   （= vitest run test/theme.test.ts；离线 mock，不需要后端/key）
 *
 * 断言：
 *   1. '/' 补全弹窗出现 /theme 的 detail 文案
 *   2. mock 下 /theme light 直切内置 light（主题不需要后端）→ palette 整组换掉
 *   3. 再从 light 切回 dark → palette 回到 Kimi dark 真值
 *   4. 未知主题名 → 守卫提示列出可选项（不是静默不变）
 *   5. 无参 /theme → 主题选择器弹出，条目含内置两项
 *   6. /help 的 HELP 文案含 /theme（COMMANDS 单一数据源派生）
 *
 * 与 smoke 一样传 persist: false：不往仓库 .verse-sessions/ 写测试会话。
 * 真后端链路（theme/list、theme/set、自定义主题目录）在 backend/tests/test_theme.py 断言。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { afterAll, expect, test } from 'vitest'
import { App, type AppApi } from '../src/ui/App.ts'
import { DEFAULT_THEME, LIGHT_THEME, palette, styles } from '../src/core/theme.ts'
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

let lastScreen = ''

test('/theme 主题：补全、内置切换、未知名字守卫与选择器', { timeout: 300_000 }, async () => {
  await sleep(150)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api

  if (!app.events.getFocused()) {
    const node = app.events.debugNodes().find((n) => n.focusable && n.visible)
    if (node) app.events.focus(node.id)
  }

  function key(k: string, opts: Record<string, boolean> = {}): boolean {
    return app.events.dispatch({ type: 'keydown', key: k, ...opts })
  }
  const screen = (): string => api.screenText().join('\n')
  const storeText = (): string =>
    api.store.entries
      .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
      .join('\n')

  // 起始态：内置 dark（Kimi 真值）
  check(
    '启动即 Kimi dark',
    palette.text === DEFAULT_THEME.text && palette.primary === DEFAULT_THEME.primary,
    `palette.text=${palette.text}（期望 ${DEFAULT_THEME.text}）`,
  )

  // 1. 输入 '/the' 收窄 → 补全弹窗里有 /theme 的 detail
  for (const ch of '/the') key(ch)
  await sleep(120)
  check(
    "查询 '/the' 补全出现 /theme",
    screen().includes('弹出主题选择器'),
    '屏幕上出现 /theme 的 detail 文案（首窗内）',
  )
  key('Escape')
  await sleep(80)

  // 2. mock 下 /theme light 直切内置 light：主题不依赖后端，palette 整组换掉
  const versionBefore = api.store.version.value
  api.submit('/theme light')
  await sleep(250)
  check(
    'palette 切到 light',
    palette.text === LIGHT_THEME.text && palette.background === '#FFFFFF',
    `palette.text=${palette.text}（期望 ${LIGHT_THEME.text}）· background=${palette.background}`,
  )
  check(
    '切换后转写区被要求重绘',
    api.store.version.value > versionBefore,
    `store.version ${versionBefore} → ${api.store.version.value}（换色靠 bump 全量重绘）`,
  )
  check(
    '切换提示进转写',
    storeText().includes('主题已切换为 light'),
    '提示文案包含生效主题名',
  )

  // 3. 切回 dark（Kimi 真值）—— 断言的是真实 palette，不是提示文案
  api.submit('/theme dark')
  await sleep(250)
  check(
    'palette 切回 dark',
    palette.text === DEFAULT_THEME.text && palette.background === '#0A0A0A',
    `palette.text=${palette.text}（期望 ${DEFAULT_THEME.text}）`,
  )
  // 派生关系仍成立（语法色跟着主题走，不会留在上一套）
  check(
    '派生色随主题一起换',
    palette.accent === DEFAULT_THEME.primary && palette.synString === DEFAULT_THEME.success,
    `accent=${palette.accent} · synString=${palette.synString}`,
  )

  // 4. 未知主题名 → 守卫列出可选项（静默不变是最糟的体验）
  api.submit('/theme ghost')
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && !storeText().includes('没有主题「ghost」')) await sleep(30)
  check(
    '未知主题给出可选项',
    storeText().includes('没有主题「ghost」') && storeText().includes('light'),
    '提示里列出可用主题名',
  )

  // 5. 无参 /theme → 选择器弹出
  api.submit('/theme')
  await sleep(250)
  const s5 = screen()
  lastScreen = s5
  check('无参 /theme 弹出选择器', s5.includes('选择主题'), 'TCommandPalette 标题可见')
  check('选择器含内置主题条目', s5.includes('dark') && s5.includes('light'), '内置 dark / light 两项')
  key('Escape')
  await sleep(120)

  // 6. /help 文案含 /theme（COMMANDS 派生，别在别处抄命令表）
  api.submit('/help')
  await sleep(200)
  check(
    '/help 含 /theme 条目',
    storeText().includes('/theme') && storeText().includes('弹出主题选择器'),
    `HELP 文案由 COMMANDS 派生出 /theme 行（占位符形式不写死，见 texts.ts 的 usage）`,
  )
})

afterAll(() => {
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/theme-screen.txt', `${lastScreen}\n`, 'utf8')
  writeFileSync(
    '.artifacts/theme.html',
    rowsToHtml(
      Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
      { cols: COLS, caption: '/theme · 内置主题选择器' },
    ),
    'utf8',
  )
  out.dispose()
  app.dispose()
})
