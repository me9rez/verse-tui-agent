/**
 * 交互式入口：真终端 + alternate screen。
 *
 *   pnpm dev                  # 本地剧本（离线，默认）
 *   pnpm dev -- --rpc          # 唯一 agent 后端（先 pnpm backend 起服务）
 *
 * 启动 flag（每次运行覆盖 tui.toml；pnpm 会吞 flag，必须写 `--` 分隔）：
 *   --rpc / --mock   会话类型        --speed <n>   流式节奏倍数（1 默认，0.3 更快）
 *   --url <ws://…>   gateway 地址（默认 ws://127.0.0.1:8765）
 *   --continue/-c · --session <id|last> · --list-sessions · --debug-input
 * 配置唯一来源 = gateway 的 config/get（连不上用内置默认）；文件见 ~/.verse/tui.toml。
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
import { DEFAULT_RPC_URL, effectiveConfig, fetchBoot, setBoot } from '../core/config.ts'
import { listSessions, sessionDir, setSessionDir } from '../session/persist/index.ts'
import { formatStamp } from '../core/text.ts'

// ── 启动参数 ──────────────────────────────────────────────────────────────
// 只有 --list-sessions 不需要 TTY（列完就退出），其余参数交给组件层。
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const wantList = argv.includes('--list-sessions')
// pnpm 会吞掉 flag，一律用 `pnpm dev -- <flag>` 形式传入。
const wantContinue = argv.includes('--continue') || argv.includes('-c')
const sessionArg = flag('--session') ?? flag('-s')
const rpcUrl = flag('--url') ?? DEFAULT_RPC_URL

// 配置唯一来源是 gateway 的 config/get；连不上（离线 mock）就用内置默认，不报错。
// 必须在 --list-sessions 之前：列表用的会话目录来自 tui 配置。
const boot = await fetchBoot(rpcUrl)
setBoot(boot)
const cfg = effectiveConfig()
if (cfg.tui.session_dir) setSessionDir(cfg.tui.session_dir)

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
const useRpc = argv.includes('--rpc') || (!argv.includes('--mock') && cfg.tui.agent === 'rpc')
const speed = Number(flag('--speed') ?? cfg.tui.speed) || 1
const debugInput = argv.includes('--debug-input') || cfg.tui.debug_input

let exiting = false

const app = createTerminalApp({
  cols,
  rows,
  component: App,
  props: {
    sessionId: sessionArg ?? (wantContinue ? 'last' : undefined),
    sessionKind: useRpc ? 'rpc' : 'mock',
    speed,
    persist: cfg.tui.persist,
    debugInput,
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
