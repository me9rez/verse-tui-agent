/**
 * 探针：抓 stdout 渲染器真实写出的字节，看同一份 hex 配色在不同色深下用哪种 SGR 形式。
 *
 * 用法：
 *   node src/probes/color.ts                        # 跟随终端能力探测
 *   VUE_TUI_COLOR_MODE=truecolor node src/probes/color.ts
 *   VUE_TUI_COLOR_MODE=ansi256   node src/probes/color.ts
 *   VUE_TUI_COLOR_MODE=ansi16    node src/probes/color.ts
 *   VUE_TUI_COLOR_MODE=ansi8     node src/probes/color.ts
 *
 * 结论：库内部按「终端能力」把 hex 降级到 ansi256 / ansi16 / ansi8，
 * 所以同一份 palette 在弱终端上也不会糊成一堆转义码。
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'

const COLS = 96
const ROWS = 24
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// 把渲染器的输出收集起来，而不是写到真终端（这样无 TTY 也能拿到真实字节）
const chunks: string[] = []
const capture = {
  write: (chunk: string) => {
    chunks.push(chunk)
    return true
  },
  isTTY: false,
  columns: COLS,
  rows: ROWS,
}

const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'mock',
    speed: 0.05,
    onReady(next: AppApi) {
      holder.api = next
    },
  },
  defaultStyle: styles.text,
})
app.mount()

const renderer = createStdoutRenderer(app.terminal, {
  output: capture,
  clear: false,
  hideCursor: true,
  altScreen: false,
  trackResize: false,
  defaultBg: null,
})

await sleep(60)
if (!holder.api) {
  console.error('App 未就绪')
  process.exit(1)
}
holder.api.submit('这个 demo 的流式输出是怎么实现的？')
await sleep(1500)
renderer.render()
await sleep(120)
renderer.dispose()

const all = chunks.join('')
const forms: Array<[string, RegExp]> = [
  ['真彩 fg 38;2;R;G;B', /\x1b\[[0-9;]*38;2;\d+;\d+;\d+/g],
  ['真彩 bg 48;2;R;G;B', /\x1b\[[0-9;]*48;2;\d+;\d+;\d+/g],
  ['256 色 fg 38;5;N', /\x1b\[[0-9;]*38;5;\d+/g],
  ['256 色 bg 48;5;N', /\x1b\[[0-9;]*48;5;\d+/g],
  ['16 色 fg 30-37/90-97', /\x1b\[[0-9;]*\b(3[0-7]|9[0-7])m/g],
  ['样式 1/2/3/4/7（粗/暗/斜/下划线/反显）', /\x1b\[[0-9;]*\b(1|2|3|4|7)m/g],
  ['重置 0m', /\x1b\[0m/g],
]

console.log(`色深模式：VUE_TUI_COLOR_MODE=${process.env.VUE_TUI_COLOR_MODE ?? '(未设，走自动探测)'}`)
console.log(`渲染器 capabilities：${JSON.stringify(renderer.capabilities)}`)
console.log(`输出总量：${all.length} 字节 / ${chunks.length} 次 write\n`)
for (const [label, rx] of forms) {
  const hits = all.match(rx) ?? []
  const uniq = [...new Set(hits)].slice(0, 4).map((s) => JSON.stringify(s)).join(' ')
  console.log(`  ${label.padEnd(40)} ${String(hits.length).padStart(5)} 次  ${uniq}`)
}
// 顶栏那一行原始字节（含颜色码）
const headerLine = all.split(/\x1b\[\d+;\d+H/).find((s) => s.includes('Verse'))
if (headerLine) {
  console.log('\n顶栏原始字节片段：')
  console.log('  ' + JSON.stringify(headerLine.slice(0, 200)))
}

// 收尾：这几行是探针必须的——渲染器与 App 的定时器会吊住事件循环，
// 只 dispose 不够（实测超时挂死），所以打完就显式退出。
renderer.dispose()
process.exit(0)
