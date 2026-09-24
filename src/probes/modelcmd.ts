/* /model 命令端到端：真连后端，切换 → 显示跟随 → 查询 → 恢复原值。 */
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

await submitAndWait('/model', '当前模型：')
await submitAndWait('/model probe-ui-model', '模型已切换为 probe-ui-model')
await submitAndWait('/model', '当前模型：probe-ui-model')
await submitAndWait(`/model ${orig}`, `模型已切换为 ${orig}`)
process.exit(process.exitCode ?? 0)
