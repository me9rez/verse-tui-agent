/**
 * `/model` 模型选择器的端到端检查（需 gateway 在跑，仿 test/rpc.test.ts 的 live 模式）。
 *
 *   先起服务端：pnpm backend
 *   再跑：      pnpm vitest run test/model.test.ts
 *
 * 断言：
 *   1. rpc 下 `/model`（无参）弹出选择器：标题「选择模型」+ [models] 全部别名上屏
 *   2. ↑↓ 移动后 Enter → 「模型已切换为 <别名>」，且切到了与当前不同的别名
 *   3. 再开选择器按 Esc → 关闭、不产生新的切换 note、模型保持不变
 *   4. 文本路径 `/model <id>` 仍可直切（并恢复原值——两条路径共用 applyModelSwitch）
 *   5. mock 下 `/model`（无参）仍是回显 note、绝不弹选择器（防回归）
 *
 * 与 smoke/rpc 一样传 persist: false：不往仓库 .verse-sessions/ 写测试会话。
 * 切换模型会重建服务端 harness（plan/todos 重置），所以第 2 步切走、第 4 步切回。
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

/** 注入按键（与 stdin driver 同构的 keydown 记录）。 */
function key(k: string, opts: Record<string, boolean> = {}): boolean {
  return app.events.dispatch({ type: 'keydown', key: k, ...opts })
}

/** 轮询直到条件成立或超时；返回是否成立。 */
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(30)
  }
  return pred()
}

test('/model 选择器：弹出 / ↑↓+Enter 切换 / Esc 取消 / 文本路径恢复', { timeout: 300_000 }, async () => {
  // 配置（models 列表来自 gateway config/get，与选择器同一数据源）
  const boot = await fetchBoot(RPC_URL)
  setBoot(boot)
  const aliases = effectiveConfig().models.map((m) => m.alias)
  check('前置：config 有模型别名', aliases.length > 0, `[models] 别名：${aliases.join(', ') || '(空)'}`)
  if (aliases.length === 0) return

  await sleep(150)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api
  const screen = (): string => api.screenText().join('\n')
  const storeText = (): string =>
    api.store.entries
      .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
      .join('\n')
  const switchNotes = (): string[] => storeText().split('\n').filter((l) => l.includes('模型已切换为'))

  // ── 1. /model（无参）弹出选择器 ──
  const orig = getBackendModel()
  check('前置：握手已回填当前模型', Boolean(orig) && aliases.includes(orig), `当前模型 = ${orig || '(空)'}`)
  api.submit('/model')
  await sleep(250)
  const s1 = screen()
  finalScreen = api.screenText()
  check(
    '/model 弹出模型选择器',
    s1.includes('选择模型') && aliases.every((a) => s1.includes(a)),
    s1.includes('选择模型')
      ? `标题上屏，别名可见：${aliases.join(', ')}`
      : `屏幕上没有「选择模型」（现状是回显 note：${storeText().includes('当前模型：') ? '检测到回显 note' : '无'}）`,
  )

  // ── 2. ArrowDown → Enter：切到另一个别名 ──
  key('ArrowDown')
  await sleep(80)
  key('Enter')
  const switched = await waitFor(() => switchNotes().length > 0, 30_000)
  const after2 = getBackendModel()
  check(
    '↑↓ 移动 + Enter 切换模型',
    switched && after2 !== orig && aliases.includes(after2),
    switched
      ? `切换 note 出现，model: ${orig} → ${after2}`
      : `30s 内没有「模型已切换为」note（当前 model=${after2}）`,
  )
  finalScreen = api.screenText()

  // ── 3. 再开选择器按 Esc：取消，不切换 ──
  const notesBeforeEsc = switchNotes().length
  api.submit('/model')
  await sleep(250)
  const s3open = screen()
  check(
    '第二次 /model 仍能弹出选择器',
    s3open.includes('选择模型'),
    s3open.includes('选择模型') ? '标题再次上屏' : '第二次没弹出（焦点/状态残留问题）',
  )
  key('Escape')
  await sleep(200)
  const s3closed = screen()
  check(
    'Esc 关闭选择器且不切换',
    !s3closed.includes('选择模型') && switchNotes().length === notesBeforeEsc && getBackendModel() === after2,
    `选择器${s3closed.includes('选择模型') ? '仍可见' : '已关闭'}，切换 note 数 ${switchNotes().length}（应 ${notesBeforeEsc}），model=${getBackendModel()}`,
  )
  finalScreen = api.screenText()

  // ── 4. 文本路径直切恢复原值（回归 applyModelSwitch 复用 + 探针语义） ──
  //    model 可能本来就是 orig（第 2 步失败时），所以等的是切换 note 落地，不是 model 值
  api.submit(`/model ${orig}`)
  const noteArrived = await waitFor(() => switchNotes().length === notesBeforeEsc + 1, 30_000)
  const restored = noteArrived && getBackendModel() === orig
  check(
    '文本路径 /model <id> 仍可直切并恢复',
    restored,
    restored ? `已恢复为 ${orig}，note 数 ${switchNotes().length}` : `恢复失败，note 数 ${switchNotes().length}（应 ${notesBeforeEsc + 1}），当前 model=${getBackendModel()}`,
  )
  finalScreen = api.screenText()

  report = { aliases, orig, switchedTo: after2, notes: switchNotes().length }
})

test('/model 在 mock 下只回显、不弹选择器', { timeout: 60_000 }, async () => {
  const mholder: { api: AppApi | null } = { api: null }
  const mockApp = createTerminalApp({
    cols: COLS,
    rows: ROWS,
    component: App,
    props: {
      sessionKind: 'mock',
      speed: 0,
      persist: false,
      onReady(next: AppApi) {
        mholder.api = next
      },
    },
    defaultStyle: styles.text,
  })
  mockApp.mount()
  const mout = createStdoutRenderer(mockApp.terminal, {
    output: { write: () => {}, isTTY: false },
    clear: false,
    hideCursor: false,
    altScreen: false,
    trackResize: false,
    defaultBg: null,
  })
  try {
    await sleep(150)
    if (!mholder.api) throw new Error('mock App 未就绪')
    const mapi = mholder.api
    mapi.submit('/model')
    await sleep(250)
    const s = mapi.screenText().join('\n')
    const st = mapi.store.entries
      .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
      .join('\n')
    check(
      'mock /model 回显且不弹选择器',
      st.includes('当前模型：') && !s.includes('选择模型'),
      st.includes('当前模型：')
        ? '回显 note 存在，屏幕上无选择器'
        : `预期回显 note，实际转写片段：${st.slice(-120)}`,
    )
    finalScreen = mapi.screenText()
  } finally {
    mout.dispose()
    mockApp.dispose()
  }
})

afterAll(() => {
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/model-screen.txt', `${finalScreen.join('\n')}\n`, 'utf8')
  writeFileSync('.artifacts/model-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  out.dispose()
  app.dispose()
})
