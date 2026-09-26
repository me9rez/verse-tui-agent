/**
 * 快捷键 Alt+M / Alt+E 与状态栏 usage 的离线面。
 *
 *   pnpm hotkeys   （= vitest run test/hotkeys.test.ts；离线 mock，不需要后端/key）
 *
 * 断言：
 *   1. mock 下 Alt+M → 路由到 /model 无参路径的守卫 note（openModelPicker 共用实现）
 *   2. mock 下 Alt+E → 路由到 /effort 无参路径的守卫 note（openEffortPicker 共用实现）
 *   3. 无 alt 的 m/e 是普通字符，不触发两个分支
 *   4. usage 格式化纯函数：readUsage 映射缓存键、ctxText 百分比、cacheText 命中率、
 *      空 usage → 状态栏退回本地估算（null）
 *   5. 状态栏窄终端裁切（fitStatus）：100 列 + 真实 usage 下保住模型段与 harness 段、
 *      先丢 cwd 与 ctx 细节、phase 段保底；宽屏不动任何段
 *
 * 与 smoke 一样传 persist: false：不往仓库 .verse-sessions/ 写测试会话。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { afterAll, expect, test } from 'vitest'
import { App, type AppApi } from '../src/ui/App.ts'
import { styles } from '../src/core/theme.ts'
import { rowsToHtml } from '../src/core/html.ts'
import { cacheText, ctxText, fmtK, readUsage } from '../src/ui/usage.ts'
import { fitStatus } from '../src/ui/hooks/useStatusBar.ts'

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

test('Alt+M / Alt+E 路由与 usage 格式化', { timeout: 300_000 }, async () => {
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

  // 1. mock 下 Alt+M → 顺序直切被守卫拦截（cycleModel 的 mock 分支，与 /model 同文案）
  key('m', { altKey: true })
  const deadline1 = Date.now() + 3000
  while (Date.now() < deadline1 && !storeText().includes('mock 剧本无模型')) await sleep(30)
  check('Alt+M 直切被 mock 守卫拦截', storeText().includes('mock 剧本无模型'), 'cycleModel 的 mock 分支可见')

  // 2. mock 下 Alt+E → 顺序直切被守卫拦截（cycleEffort 的 mock 分支，与 /effort 同文案）
  key('e', { altKey: true })
  const deadline2 = Date.now() + 3000
  while (Date.now() < deadline2 && !storeText().includes('mock 剧本，没有思考档位')) await sleep(30)
  check('Alt+E 直切被 mock 守卫拦截', storeText().includes('mock 剧本，没有思考档位'), 'cycleEffort 的 mock 分支可见')

  // 3. 无 alt 的 m/e 是普通字符：note 计数不变
  key('m')
  key('e')
  await sleep(150)
  check(
    "无 alt 的 m/e 不触发",
    storeText().split('mock 剧本无模型').length === 2 && storeText().split('mock 剧本，没有思考档位').length === 2,
    '守卫 note 各只有一条',
  )

  // 4. usage 格式化纯函数（真实键名来自框架 UsageDetails）
  const uv = readUsage({
    input_token_count: 12345,
    output_token_count: 678,
    total_token_count: 13023,
    cache_read_input_token_count: 8123,
  })
  check('readUsage 映射缓存键', uv?.cached === 8123 && uv.input === 12345, JSON.stringify(uv))
  check('ctxText 带窗口百分比', ctxText(uv!, 200_000) === 'ctx 12.3k/200k 6%', ctxText(uv!, 200_000))
  check('ctxText 无窗口只显示绝对值', ctxText(uv!, 0) === 'ctx 12.3k', ctxText(uv!, 0))
  check('cacheText 命中率', cacheText(uv!) === 'cache 8.1k 66%', cacheText(uv!) ?? 'null')
  check('无缓存信息不显示缓存段', cacheText(readUsage({ input_token_count: 100, output_token_count: 5 })!) === null, 'cached 缺席 → null')
  check('全零 usage → null（退回本地估算）', readUsage({}) === null, 'readUsage({})')
  check('fmtK 边界', fmtK(999) === '999' && fmtK(12_345) === '12.3k' && fmtK(99_999) === '100k', 'k 进位')

  // 5. 状态栏窄终端裁切：按信息优先级丢段（dropPrio 与 useStatusBar 的 PRIO 表同值）
  type Seg = { text: string; dropPrio?: number }
  const leftSegs = (): Seg[] => [
    { text: '✻ ready' }, // phase：不标优先级 = 保底，永不丢
    { text: 'rpc', dropPrio: 11 },
    { text: 'plan', dropPrio: 9 },
    { text: 'workbuddy/hy3', dropPrio: 7 },
    { text: 'D:\\workspace\\verse-tui-agent', dropPrio: 1 },
  ]
  const rightSegs = (): Seg[] => [
    { text: 'rpc · 127.0.0.1:8765', dropPrio: 10 },
    { text: 'in 3.8k', dropPrio: 6 },
    { text: 'out 813', dropPrio: 6 },
    { text: 'ctx 3.8k/192k 2%', dropPrio: 4 },
    { text: '0 tools', dropPrio: 8 },
  ]
  const narrowL = leftSegs()
  const narrowR = rightSegs()
  fitStatus(narrowL, narrowR, COLS)
  const visible = [...narrowL, ...narrowR].map((s) => s.text).join(' · ')
  check(
    '100 列下保住模型段与 harness 段',
    narrowL.some((s) => s.text === 'workbuddy/hy3') && narrowL.some((s) => s.text === 'plan'),
    visible,
  )
  check(
    '先丢 cwd 与 ctx 细节',
    !narrowL.some((s) => s.text.startsWith('D:')) && !narrowR.some((s) => s.text.startsWith('ctx')),
    visible,
  )
  check('phase 段永不留失', narrowL[0]?.text === '✻ ready', visible)
  const wideL = leftSegs()
  const wideR = rightSegs()
  fitStatus(wideL, wideR, 200)
  check('宽屏不动任何段', wideL.length === 5 && wideR.length === 5, `${wideL.length}/${wideR.length}`)

  lastScreen = screen()
})

afterAll(() => {
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/hotkeys-screen.txt', `${lastScreen}\n`, 'utf8')
  writeFileSync(
    '.artifacts/hotkeys.html',
    rowsToHtml(
      Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
      { cols: COLS, caption: 'Alt+M/E · usage 格式化' },
    ),
    'utf8',
  )
  out.dispose()
  app.dispose()
})
