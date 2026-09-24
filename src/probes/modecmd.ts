/* Shift+Tab 切 harness 模式端到端（真连后端）：BackTab 事件 → note + 状态段 + 信号跟随，来回切一圈。 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { getBackendMode } from '../session/mode.ts'
import { styles } from '../core/theme.ts'
import { loadDotEnv } from '../core/env.ts'

loadDotEnv()
process.env.VT_NO_PERSIST = '1'
process.env.VT_AGENT = 'rpc'

const COLS = 100
const ROWS = 44
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }

const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: { sessionKind: 'rpc', speed: 1, onReady: (n: AppApi) => { holder.api = n } },
  defaultStyle: styles.text,
})
app.mount()
const out = createStdoutRenderer(app.terminal, {
  output: { write: () => {}, isTTY: false },
  clear: false, hideCursor: false, altScreen: false, trackResize: false, defaultBg: null,
})
void out

await sleep(400) // 等 initialize + mode/get 握手回填
if (!holder.api) { console.error('App 未就绪'); process.exit(1) }
const api = holder.api

const screen = () => api!.screenText().join('\n')
const storeText = () =>
  api!.store.entries.filter((e) => e.kind === 'line').map((e) => e.text).join('\n')

async function waitFor(needle: string, label: string, ms = 5000): Promise<boolean> {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (storeText().includes(needle) || screen().includes(needle)) return true
    await sleep(30)
  }
  console.log(`✘ ${label} — 等不到「${needle}」；mode=${getBackendMode()}`)
  return false
}

const checks: Array<[string, boolean, string]> = []
const check = (n: string, ok: boolean, d: string) => { checks.push([n, ok, d]); console.log(`${ok ? '✔' : '✘'} ${n} — ${d}`) }

// 0. 握手回填：默认 plan 且状态栏有模式段
check('握手回填默认模式', getBackendMode() === 'plan', `mode=${getBackendMode()}，状态段 ${/· plan ·/.test(screen()) ? '有' : '无'}`)

// 1. 第一次 Shift+Tab → execute
app.events.dispatch({ type: 'keydown', key: 'BackTab' })
const gotExec = await waitFor('已切换到 execute 模式', 'execute 切换 note')
check('Shift+Tab → execute', gotExec && getBackendMode() === 'execute',
  `mode=${getBackendMode()}，状态段 ${/· execute ·/.test(screen()) ? '有' : '无'}`)
check('状态栏显示 execute 模式段', /· execute ·/.test(screen()), getBackendMode())

// 2. 再按 Shift+Tab → 回 plan
app.events.dispatch({ type: 'keydown', key: 'BackTab' })
const gotPlan = await waitFor('已切换到 plan 模式', 'plan 切换 note')
check('再 Shift+Tab → 回 plan', gotPlan && getBackendMode() === 'plan',
  `mode=${getBackendMode()}，状态段 ${/· plan ·/.test(screen()) ? '有' : '无'}`)

const fails = checks.filter(([, ok]) => !ok)
console.log(fails.length ? `\nFAIL: ${fails.length} 项未通过` : `\nPASS: Shift+Tab 模式切换 ${checks.length}/${checks.length} 全部通过`)
process.exit(fails.length ? 1 : 0)
