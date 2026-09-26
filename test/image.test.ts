/**
 * Alt+V 贴图（多模态输入）的离线面：真实注入按键，断言屏幕与转写。
 *
 *   pnpm image   （= vitest run test/image.test.ts；离线 mock，不需要后端/key/剪贴板）
 *
 * 断言：
 *   1. mock 下 Alt+V → 「mock 剧本，贴不了图」守卫 note 进转写（键经根节点
 *      onKeydownCapture 捕获阶段路由到 pasteImageFromClipboard）
 *   2. 不带 altKey 的 'v' 不触发贴图分支（正常字符输入）
 *   3. mock（无 capabilities）下占位符不含「Alt+V 贴图」提示、待发指示条不出现
 *   4. 支持模型的提示与指示条只在 rpc + image_in 下出现——真实链路在 pytest 协议套件
 *      断言参数校验（images 形状/base64/大小），端到端消费由端点决定
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

test('Alt+V 贴图：mock 守卫与能力门控', { timeout: 300_000 }, async () => {
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

  // 1. mock 下 Alt+V → 守卫 note（支持模型的贴图链路在 rpc 后端，pytest 协议套件覆盖参数校验）
  key('v', { altKey: true })
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && !storeText().includes('mock 剧本，贴不了图')) await sleep(30)
  check(
    'mock 下 Alt+V 走守卫',
    storeText().includes('mock 剧本，贴不了图'),
    'pasteImageFromClipboard 的 mock 分支提示可见',
  )

  // 2. 不带 alt 的 'v' 是普通字符：不触发贴图分支（note 计数不增加）
  key('v')
  await sleep(150)
  check(
    "无 alt 的 'v' 不触发贴图",
    storeText().split('mock 剧本，贴不了图').length === 2,
    '守卫 note 只有一条（第 1 步的），输入字符未被误路由',
  )

  // 3. mock（无 capabilities）下：占位符无 Alt+V 提示、待发指示条不出现
  const s3 = screen()
  lastScreen = s3
  check(
    '不支持模型不显示 Alt+V 提示',
    !s3.includes('Alt+V 贴图'),
    '占位符未附加 Alt+V 提示（image_in 门控）',
  )
  check(
    '待发指示条不出现',
    !s3.includes('随下一条消息发送]'),
    'pendingImage 为空时 chip 不渲染',
  )
})

afterAll(() => {
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/image-screen.txt', `${lastScreen}\n`, 'utf8')
  writeFileSync(
    '.artifacts/image.html',
    rowsToHtml(
      Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
      { cols: COLS, caption: 'Alt+V 贴图 · mock 守卫' },
    ),
    'utf8',
  )
  out.dispose()
  app.dispose()
})
