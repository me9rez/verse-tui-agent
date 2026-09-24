/**
 * slash 命令补全的端到端检查：真实注入按键（events.dispatch keydown），断言屏幕内容。
 *
 *   node src/checks/complete-check.ts        # 离线 mock，不需要后端/key
 *
 * 断言：
 *   1. 输入 '/' 弹出命令补全（判别用欢迎块 Tips 没有的 desc：/clear、/fold）
 *   2. 继续输入 '/fo' 收窄匹配（/clear 的 detail 消失，/fold 仍在）
 *   3. 第一次 Enter = 采用建议而非提交（弹窗收起，转写里还没有 /fold 执行记录）
 *   4. 第二次 Enter = 真提交（/fold 的「…全部分组」note 进入转写）
 *
 * 与 smoke 一样 VT_NO_PERSIST=1：不往仓库 .verse-sessions/ 写测试会话。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { rowsToHtml } from '../core/html.ts'
import { loadDotEnv } from '../core/env.ts'

loadDotEnv()
process.env.VT_NO_PERSIST = '1'

const COLS = 100
const ROWS = 44

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }

const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'mock',
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
void out

await sleep(150)
if (!holder.api) {
  console.error('App 未就绪')
  process.exit(1)
}
const api: AppApi = holder.api

// prompt 弹窗只在输入框 focused 时计算（promptContext 在 !focused 时为 null）
if (!app.events.getFocused()) {
  const node = app.events.debugNodes().find((n) => n.focusable && n.visible)
  if (node) app.events.focus(node.id)
}
console.log('focused node =', app.events.getFocused())

/** 注入一个按键（与 stdin driver 同构的 keydown 记录）。 */
function key(k: string, opts: Record<string, boolean> = {}): boolean {
  return app.events.dispatch({ type: 'keydown', key: k, ...opts })
}
const screen = () => api.screenText().join('\n')
const storeText = () =>
  api.store.entries
    .map((e) => (e.kind === 'line' ? e.text : (e as { title?: string }).title ?? ''))
    .join('\n')

const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

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
const submitted = s4.includes('全部分组') && storeText().includes('全部分组')
check('/fold 被真正执行', submitted, submitted ? '/fold 的「…全部分组」note 出现在转写' : '没等到执行记录')

const failures = checks.filter((c) => !c.ok)
mkdirSync('.artifacts', { recursive: true })
writeFileSync('.artifacts/complete-screen.txt', `${s4}\n`, 'utf8')
writeFileSync(
  '.artifacts/complete.html',
  rowsToHtml(
    Array.from({ length: ROWS }, (_, y) => app.terminal.getRow(y) as never),
    { cols: COLS, caption: 'slash 补全 · mock' },
  ),
  'utf8',
)
writeFileSync(
  '.artifacts/complete-report.json',
  `${JSON.stringify({ ok: failures.length === 0, focused: app.events.getFocused(), checks }, null, 2)}\n`,
  'utf8',
)

for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
console.log('\n屏幕快照（含弹窗/输入框/转写尾部）：\n')
console.log(s4.split('\n').filter((l) => l.trim()).slice(-20).join('\n'))
console.log(failures.length ? `\nFAIL: ${failures.length} 项未通过` : '\nPASS: slash 命令补全链路全部通过')
process.exit(failures.length ? 1 : 0)
