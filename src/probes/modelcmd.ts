/* /model 命令端到端：真连后端，无参弹选择器 → 文本直切 → 信号跟随 → 恢复原值。
 * 无参 /model 现在弹模型选择器（不再回显 note），查询断言改用 getBackendModel() 权威信号。 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { getBackendModel } from '../session/model.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: 100,
  rows: 30,
  component: App,
  props: { sessionKind: 'rpc', speed: 0, persist: false, onReady: (n: AppApi) => { holder.api = n } },
  defaultStyle: styles.text,
})
app.mount()
const out = createStdoutRenderer(app.terminal, {
  output: { write: () => {}, isTTY: false },
  clear: false, hideCursor: false, altScreen: false, trackResize: false, defaultBg: null,
})
void out
await sleep(400) // 等握手 initialize 回填
const api = holder.api!
const orig = getBackendModel()
console.log('握手后 model =', orig || '(空)')

const notes = (): string =>
  api.store.entries.filter((e) => e.kind === 'line').map((e) => e.text).join('\n')

/** 命令分支不进 streaming（whenIdle 对它是竞态的），轮询等到目标 note 出现 */
async function submitAndWait(text: string, expect: string): Promise<void> {
  api.submit(text)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !notes().includes(expect)) await sleep(20)
  const found = notes().includes(expect)
  const last = notes().split('\n').filter(Boolean).at(-1) ?? ''
  console.log(found ? '✔' : '✘', `[${text}]`, last.slice(0, 70), '| 信号 =', getBackendModel())
  if (!found) process.exitCode = 1
}

// 1. 无参 /model → 弹出选择器 → Esc 关闭
const screen = (): string => api.screenText().join('\n')
api.submit('/model')
await sleep(300)
let ok = screen().includes('选择模型')
console.log(ok ? '✔' : '✘', '[/model] 选择器弹出（标题「选择模型」上屏）')
if (!ok) process.exitCode = 1
app.events.dispatch({ type: 'keydown', key: 'Escape' })
await sleep(200)
ok = !screen().includes('选择模型')
console.log(ok ? '✔' : '✘', '[Esc] 选择器关闭')
if (!ok) process.exitCode = 1

// 2. 文本直切 → 后端确认 note；3. 显示跟随改查权威信号
await submitAndWait('/model probe-ui-model', '模型已切换为 probe-ui-model')
const followed = getBackendModel() === 'probe-ui-model'
console.log(followed ? '✔' : '✘', '[查询] getBackendModel =', getBackendModel())
if (!followed) process.exitCode = 1

// 4. 恢复原值
await submitAndWait(`/model ${orig}`, `模型已切换为 ${orig}`)
process.exit(process.exitCode ?? 0)
