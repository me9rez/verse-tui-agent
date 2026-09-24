/**
 * 交互式入口：真终端 + alternate screen。
 *
 *   pnpm dev                             # 本地剧本（离线）
 *   VT_AGENT=rpc pnpm dev   # 唯一 agent 后端（先 pnpm backend 起服务）
 *
 * 环境变量：
 *   VT_SPEED=2   流式节奏倍数（1 默认，0.3 更快）
 */
import {
  createStdinDriver,
  createStdoutRenderer,
  createTerminalApp,
  installTerminalCleanup,
  type TerminalCleanupHandle,
} from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { rendererPalette, styles } from '../core/theme.ts'
import { loadDotEnv } from '../core/env.ts'
import { listSessions, sessionDir } from '../session/persist/index.ts'
import { formatStamp } from '../core/text.ts'

// .env / .env.local 先于业务逻辑加载（真实环境变量优先，文件不覆盖已存在的键）
loadDotEnv()

// ── 启动参数 ──────────────────────────────────────────────────────────────
// 只有 --list-sessions 不需要 TTY（列完就退出），其余参数交给组件层。
const argv = process.argv.slice(2)
const wantList = argv.includes('--list-sessions')
// 两种入口都支持：命令行 flag（node src/cli/terminal.ts --continue）与 VT_* 环境变量。
// 环境变量这条是给 `pnpm dev` 用的——`pnpm dev --continue` 会被 pnpm 自己吞掉，传不进脚本。
const wantContinue = argv.includes('--continue') || argv.includes('-c') || process.env.VT_CONTINUE === '1'
const sessionArg = (() => {
  const i = argv.findIndex((a) => a === '--session' || a === '-s')
  return (i >= 0 ? argv[i + 1] : undefined) ?? process.env.VT_SESSION
})()

if (wantList) {
  const all = listSessions()
  if (!all.length) console.log(`还没有落盘的会话（目录：${sessionDir()}）。`)
  for (const [i, one] of all.entries()) {
    console.log(`${String(i + 1).padStart(2)}. ${formatStamp(one.updatedAt)}  ${one.kind.padEnd(4)}  ${one.turns.length} 轮  ${one.title}`)
    console.log(`    id: ${one.id}    （继续：pnpm dev --session ${one.id}）`)
  }
  process.exit(0)
}



const MIN_COLS = 60
const MIN_ROWS = 18

// 无 TTY 直接拒绝启动：stdin driver 要进 raw mode 并捕获鼠标，管道下起不来，
// 早退比抛 ERR_TTY_INIT_FAILED 好（跟 Hermes 那条「非 TTY 一律不进 TUI」的教训同理）。
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    '需要真实终端（TTY）才能跑交互式 TUI。\n' +
      '  无头验证：pnpm smoke\n' +
      '  出图快照：pnpm shot\n' +
      '  接了管道的话，去掉管道或在真终端里重跑。',
  )
  process.exit(1)
}

const cols = Math.max(MIN_COLS, process.stdout.columns || 100)
const rows = Math.max(MIN_ROWS, process.stdout.rows || 30)
const requested = (process.env.VT_AGENT ?? '').toLowerCase()
const useRpc = requested === 'rpc'
const speed = Number(process.env.VT_SPEED ?? '1') || 1

let exiting = false

const app = createTerminalApp({
  cols,
  rows,
  component: App,
  props: {
    sessionId: sessionArg ?? (wantContinue ? 'last' : undefined),
    sessionKind: useRpc ? 'rpc' : 'mock',
    speed,
    onReady(_api: AppApi) {
      /* 交互模式下不需要句柄 */
    },
    onExit() {
      exit(0)
    },
  },
  defaultStyle: styles.text,
})

app.mount()

const out = createStdoutRenderer(app.terminal, {
  output: process.stdout,
  hideCursor: true,
  altScreen: true,
  colorMode: 'auto',
  palette: rendererPalette,
  defaultBg: null,
  trackResize: true,
  getImeAnchor: () => app.getImeAnchor(),
})

/** 每次提交后把终端光标放到输入框的 IME 锚点，中文输入法候选窗口才会跟手。 */
const offCommitCursor = app.terminal.on('commit', () => {
  const anchor = app.getImeAnchor()
  if (!anchor) return
  out.setCursor(anchor.cellX, anchor.cellY)
  out.showCursor(false)
})

let driver: ReturnType<typeof createStdinDriver> | null = null
let cleanupHandle: TerminalCleanupHandle | null = null

function cleanup(): void {
  if (exiting) return
  exiting = true
  cleanupHandle?.uninstall()
  cleanupHandle = null
  driver?.dispose()
  offCommitCursor()
  out.dispose()
  app.dispose()
}

function exit(code = 0): void {
  cleanup()
  process.exit(code)
}

driver = createStdinDriver({
  dispatch: (event) => app.events.dispatch(event),
  enableMouse: true,
  enableMouseMotion: true,
  onExit: () => exit(0),
  autoCleanup: false,
})

cleanupHandle = installTerminalCleanup(cleanup)
