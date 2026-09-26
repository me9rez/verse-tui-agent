/* 调试 v2：包装在 app.mount() 之前装上（组件 mount 时绑定引用），打印 y31-39 的全部写入 + 调用者。 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { layoutOf } from '../ui/layout.ts'
import { styles } from '../core/theme.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: 100,
  rows: 44,
  component: App,
  props: { sessionKind: 'mock', speed: 0, persist: false, onReady: (n: AppApi) => { holder.api = n } },
  defaultStyle: styles.text,
})

// ── mount 之前包装：之后组件绑定的也是包装版 ──
// 监听弹窗区域的每一次写入：区域随布局走（弹窗挂在输入行上方）
const L = layoutOf(44, 120)
const Y0 = L.inputY - 9
const Y1 = L.inputY - 1
const origWrite = app.terminal.write.bind(app.terminal)
const origPut = app.terminal.put.bind(app.terminal)
let clock = 0
const who = (): string => {
  const st = (new Error().stack ?? '').split('\n').slice(3, 6)
  return st.map((s) => s.trim().replace(/^at\s+/, '').slice(0, 70)).join(' | ').slice(0, 140)
}
let armed = false // 只记录按 / 之后的写入
;(app.terminal as unknown as { write: typeof origWrite }).write = (text, opts) => {
  if (armed && opts && typeof opts.y === 'number' && opts.y >= Y0 && opts.y <= Y1) {
    const t = JSON.stringify(String(text).slice(0, 18))
    console.log(`[write +${clock}ms] y=${opts.y} x=${opts.x} ${t}${text.trim() === '' ? ' 空白' : ''}`)
    console.log(`    ← ${who()}`)
  }
  return origWrite(text, opts)
}
;(app.terminal as unknown as { put: typeof origPut }).put = (x, y, ch, style) => {
  if (armed && y >= Y0 && y <= Y1 && ch !== '│' && ch !== '┌' && ch !== '└' && ch !== '▲') {
    console.log(`[put   +${clock}ms] (${x},${y}) ${JSON.stringify(ch)}${ch === ' ' ? ' 空白' : ''}`)
    console.log(`    ← ${who()}`)
  }
  return origPut(x, y, ch, style)
}
const tick = setInterval(() => { clock += 10 }, 10)
tick.unref?.()

// fill/clear/scroll/batch 是绕过 write/put 改 buffer 的路径，一并拦截
for (const fn of ['fill', 'clear', 'scroll'] as const) {
  const orig = (app.terminal as unknown as Record<string, (...a: unknown[]) => unknown>)[fn].bind(app.terminal)
  ;(app.terminal as unknown as Record<string, unknown>)[fn] = (...args: unknown[]) => {
    if (armed) console.log(`[${fn}   +${clock}ms] ${JSON.stringify(args)}`)
    return orig(...args)
  }
}

app.mount()
const captured: string[] = []
const out = createStdoutRenderer(app.terminal, {
  output: { write: (s: string) => { captured.push(s); return true } },
  clear: false, hideCursor: false, altScreen: false, trackResize: false, defaultBg: null,
})
void out
await sleep(150)

if (!app.events.getFocused()) {
  const n = app.events.debugNodes().find((x) => x.focusable && x.visible)
  if (n) app.events.focus(n.id)
}
console.log('=== 按下 / ===')
armed = true
app.events.dispatch({ type: 'keydown', key: '/' })
// 找出状态翻转时刻：每 50ms 采样（武装到底，抓 250ms 之后的静默写者）
for (let i = 0; i < 14; i++) {
  await sleep(50)
  let inner = ''
  for (let y = 32; y <= 38; y++) inner += app.terminal.getRow(y).map((c) => c.ch ?? ' ').join('').slice(3, 14)
  const filled = inner.includes('/help') || inner.includes('/clear')
  const openKept = app.terminal.getRow(38).map((c) => c.ch ?? ' ').join('').includes('/open')
  console.log(`  采样${i} (+${(i + 1) * 50}ms) 32-37有内容=${filled} y38有/open=${openKept}`)
}

// flush 输出（= 真实终端会看到的 ANSI 流）里有没有弹窗内容？
armed = false
clearInterval(tick)
const flushed = captured.join('')
console.log('\nflush 输出含 /help:', flushed.includes('/help'), ' 含 显示这份说明:', flushed.includes('显示这份说明'), ' 含 /open:', flushed.includes('/open'))
console.log('flush 输出总长:', flushed.length)
console.log('\n=== 最终 31-39 行（getRow） ===')
for (let y = Y0; y <= Y1; y++) {
  console.log(' ', y, JSON.stringify(app.terminal.getRow(y).map((c) => c.ch ?? ' ').join('')))
}
process.exit(0)
