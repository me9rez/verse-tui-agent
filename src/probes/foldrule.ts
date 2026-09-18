/**
 * 探针：把一轮对话里「分组展开/收起」的轨迹按阶段打出来。
 *
 * 用途：确认手风琴规则真的按预期走 ——
 *   思考阶段：思考组展开
 *   工具阶段：思考组收起、当前工具组展开（前面的工具组也收起）
 *   正文阶段：没有「当前组」，全部收起
 *   回合结束：全部收起
 *
 * 用法：node src/probes/foldrule.ts
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'
import { loadDotEnv } from '../core/env.ts'

loadDotEnv()

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: 110,
  rows: 40,
  component: App,
  props: {
    speed: 4, // 放慢，让每个阶段都有稳定的采样窗口
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

await sleep(60)
const api = holder.api
if (!api) {
  console.error('App 未就绪')
  process.exit(1)
}

/** 当前展开的组：`kind:lines` 形式，便于一眼看出轨迹 */
const openGroups = (): string => {
  const open = api.groups().filter((g) => !g.collapsed)
  return open.length ? open.map((g) => `${g.kind}(${g.lines}行)`).join(', ') : '（无，全部收起）'
}

api.submit('这个 demo 的流式输出是怎么实现的？')
const deadline = Date.now() + 60_000
const seen: string[] = []
let maxOpen = 0
while (api.state().streaming && Date.now() < deadline) {
  const phase = api.state().phase
  const openCount = api.groups().filter((g) => !g.collapsed).length
  maxOpen = Math.max(maxOpen, openCount)
  const line = `${phase.padEnd(9)} 展开: ${openGroups()}`
  if (seen.at(-1) !== line) {
    seen.push(line)
    console.log('  ' + line)
  }
  await sleep(15)
}
await api.whenIdle()
await sleep(30)
console.log('  ' + `${api.state().phase.padEnd(9)} 展开: ${openGroups()}   ← 回合结束`)
console.log(`\n阶段变化 ${seen.length} 次；过程中最大同时展开数 = ${maxOpen}（规则要求 ≤ 1）`)

out.dispose()
process.exit(0)
