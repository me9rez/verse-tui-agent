/**
 * 配置的唯一来源是 gateway 的 config/get（JSON-RPC 2.0 over WebSocket）。
 * 前端不读任何配置文件、不读任何业务环境变量；连不上就用与后端 DEFAULTS 同值的
 * BUILTIN 兜底（保住离线 mock demo）。gateway 地址固定默认 + --url flag（客户端读不了文件）。
 */
export type VerseBoot = Readonly<{
  config: {
    default_model: string
    default_mode: string
    gateway: { host: string; port: number; workspace: string; history: string; log_level: string }
    providers: Array<{ name: string; type: string; base_url: string; api_key: string }>
    models: Array<{ alias: string; provider: string; model: string; max_context_size: number; display_name: string }>
    tui: {
      agent: 'mock' | 'rpc'
      speed: number
      persist: boolean
      session_dir: string
      debug_input: boolean
      shot: { cols: number; rows: number; mid_tool: boolean; prompt: string }
      check: { timeout_ms: number; prompt: string }
    }
  }
  sources: readonly string[]
}>

/**
 * 与 backend/config.py 的 DEFAULTS/DEFAULT_TUI 同值——改动必须两边同步；
 * /env 的「配置文件」行能发现漂移（有 sources 才说明读到了真配置）。
 */
export const BUILTIN_CONFIG: VerseBoot['config'] = {
  default_model: 'wb2api/cn:hy3',
  default_mode: 'plan',
  gateway: { host: '127.0.0.1', port: 8765, workspace: '', history: '', log_level: 'INFO' },
  providers: [],
  models: [],
  tui: {
    agent: 'mock',
    speed: 1,
    persist: true,
    session_dir: '',
    debug_input: false,
    shot: { cols: 110, rows: 32, mid_tool: false, prompt: '这个 demo 的流式输出是怎么实现的？' },
    check: { timeout_ms: 150000, prompt: '' },
  },
}

export const DEFAULT_RPC_URL = 'ws://127.0.0.1:8765'

// 必须是响应式 ref：computed（如 modelItems）靠它失效重算。曾经是普通 let——
// 模块级首帧渲染在 setBoot 之前求值过一次空数组后就永久缓存，/model 选择器
// 会误判「[models] 为空」（2026-09-24 实测踩坑）。
import { ref } from 'vue'
const boot = ref<VerseBoot | null>(null)

/** 开机 fetchBoot / rpc 握手 config/get 后调用；null = gateway 不可达（读 BUILTIN）。 */
export function setBoot(b: VerseBoot | null): void {
  boot.value = b
}

export function getBoot(): VerseBoot | null {
  return boot.value
}

/** /env 与启动逻辑读这份：boot 有值给真配置，没有给 BUILTIN。 */
export function effectiveConfig(): VerseBoot['config'] {
  return boot.value?.config ?? BUILTIN_CONFIG
}

/** 连一次 gateway 调 config/get 再断开；失败/超时返回 null（离线不报错）。 */
export function fetchBoot(url: string = DEFAULT_RPC_URL, timeoutMs = 800): Promise<VerseBoot | null> {
  return new Promise((resolve) => {
    let done = false
    let ws: WebSocket | undefined
    const finish = (v: VerseBoot | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        /* 已关 */
      }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      ws = new WebSocket(url)
    } catch {
      finish(null)
      return
    }
    ws.onopen = () => ws?.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'config/get' }))
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { id?: number; result?: VerseBoot }
        finish(msg.id === 1 && msg.result ? msg.result : null)
      } catch {
        finish(null)
      }
    }
    ws.onerror = () => finish(null)
    ws.onclose = () => finish(null)
  })
}
