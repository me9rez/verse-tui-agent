/**
 * `/open` 会话选择器的端到端检查（离线 mock + 临时会话目录，不需要后端/key）。
 *
 *   pnpm open   （= vitest run test/open.test.ts）
 *
 * 断言：
 *   1. 空目录：`/open` 回退提示「还没有落盘的会话」，不弹选择器
 *   2. 前置：两个落盘会话按 updatedAt 倒序（旧甲、新乙 → [乙, 甲]）
 *   3. 文本路径 `/open <id>` 仍可直切（回归锚）
 *   4. `/open`（无参）弹出「切换会话」，全部标题上屏
 *   5. 当前会话行带 ▶ 标记（沿用 /sessions 的 ▶ = 当前 约定）
 *   6. ArrowDown + Enter → note「已切到 <甲 id>」（初始高亮在当前会话=乙，下一移=甲）
 *   7. Esc 取消：选择器关闭、不产生新的切换 note
 *
 * 与 smoke/session 一样用临时会话目录：绝不碰仓库 .verse-sessions/。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { afterAll, expect, test } from 'vitest'
import { App, type AppApi } from '../src/ui/App.ts'
import { styles } from '../src/core/theme.ts'
import {
  SESSION_SCHEMA_V,
  listSessions,
  saveSession,
  setSessionDir,
  type StoredSession,
} from '../src/session/persist/index.ts'

const COLS = 100
const ROWS = 44
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 临时会话目录：必须在 App 挂载/任何 listSessions 调用之前生效
const dir = mkdtempSync(join(tmpdir(), 'verse-open-'))
setSessionDir(dir)

const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'mock',
    speed: 0,
    persist: true,
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

/** 注入按键（与 stdin driver 同构的 keydown 记录）。 */
function key(k: string, opts: Record<string, boolean> = {}): boolean {
  return app.events.dispatch({ type: 'keydown', key: k, ...opts })
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(30)
  }
  return pred()
}

function makeSession(id: string, over: Partial<StoredSession> = {}): StoredSession {
  const now = new Date().toISOString()
  return {
    v: SESSION_SCHEMA_V,
    id,
    title: `会话 ${id}`,
    kind: 'mock',
    createdAt: now,
    updatedAt: now,
    turns: [],
    ...over,
  }
}

let finalScreen: string[] = []

test('/open 选择器：空回退 / 弹出 / ▶ 标记 / ↑↓+Enter 切换 / Esc / 文本路径', { timeout: 60_000 }, async () => {
  await sleep(150)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api
  const screen = (): string => api.screenText().join('\n')
  const storeText = (): string =>
    api.store.entries
      .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
      .join('\n')
  const switchNotes = (): string[] => storeText().split('\n').filter((l) => l.includes('已切到'))

  // ── 1. 空目录：回退提示，不弹选择器 ──
  api.submit('/open')
  await sleep(200)
  check(
    '空目录回退提示',
    storeText().includes('还没有落盘的会话') && !screen().includes('切换会话'),
    storeText().includes('还没有落盘的会话')
      ? '提示可见，屏幕上无选择器'
      : `预期「还没有落盘的会话」，实际转写尾部：${storeText().slice(-120)}`,
  )
  finalScreen = api.screenText()

  // ── 2. 造两个落盘会话：旧甲、新乙 → listSessions 倒序 [乙, 甲] ──
  const A = makeSession('20260101-000001-aaaa', { title: '甲会话', updatedAt: '2026-01-01T00:00:00.000Z' })
  const B = makeSession('20260102-000002-bbbb', { title: '乙会话', updatedAt: '2026-01-02T00:00:00.000Z' })
  saveSession(A)
  saveSession(B)
  const all = listSessions()
  check(
    '前置：列表按 updatedAt 倒序',
    all.length === 2 && all[0].id === B.id && all[1].id === A.id,
    `实际顺序：${all.map((s) => s.id).join(' → ')}`,
  )

  // ── 3. 文本路径直切乙（回归锚：把「当前会话」变成列表内的乙，给 ▶ 标记铺路） ──
  api.submit(`/open ${B.id}`)
  const switchedB = await waitFor(() => switchNotes().some((l) => l.includes(B.id)), 5_000)
  check('文本路径 /open <id> 直切', switchedB, switchedB ? `已切到 ${B.id}` : `5s 内没等到「已切到 ${B.id}」`)

  // ── 4. 无参 /open → 弹选择器，全部标题上屏 ──
  api.submit('/open')
  await sleep(250)
  const s4 = screen()
  check(
    '/open 弹出会话选择器',
    s4.includes('切换会话') && s4.includes('甲会话') && s4.includes('乙会话'),
    s4.includes('切换会话')
      ? '标题上屏，甲/乙两个会话标题都在列表里'
      : `屏幕上没有「切换会话」（转写尾部：${storeText().slice(-80)}）`,
  )

  // ── 5. 当前会话（乙）行带 ▶ 标记 ──
  check(
    '当前会话带 ▶ 标记',
    s4.includes('▶'),
    s4.includes('▶') ? '屏上可见 ▶' : '列表里没有 ▶（当前会话标记）',
  )
  finalScreen = api.screenText()

  // ── 6. ArrowDown + Enter → 切到列表下一项（甲） ──
  const beforeSwitch = switchNotes().length
  key('ArrowDown')
  await sleep(80)
  key('Enter')
  const switchedA = await waitFor(
    () => switchNotes().length > beforeSwitch && switchNotes().some((l) => l.includes(A.id)),
    5_000,
  )
  check(
    '↑↓ 移动 + Enter 切换会话',
    switchedA,
    switchedA ? `已切到 ${A.id}（列表第 2 项）` : `5s 内没等到「已切到 ${A.id}」，note 数 ${switchNotes().length}`,
  )
  finalScreen = api.screenText()

  // ── 7. 再开一次按 Esc：关闭且不产生新的切换 note ──
  api.submit('/open')
  await sleep(250)
  const openAgain = screen().includes('切换会话')
  const notesBeforeEsc = switchNotes().length
  key('Escape')
  await sleep(200)
  const s7 = screen()
  check(
    'Esc 关闭选择器且不切换',
    openAgain && !s7.includes('切换会话') && switchNotes().length === notesBeforeEsc,
    `再次弹出=${openAgain}，Esc 后${s7.includes('切换会话') ? '仍可见' : '已关闭'}，切换 note 数 ${switchNotes().length}（应 ${notesBeforeEsc}）`,
  )
  finalScreen = api.screenText()
})

afterAll(() => {
  out.dispose()
  app.dispose()
  rmSync(dir, { recursive: true, force: true })
})
