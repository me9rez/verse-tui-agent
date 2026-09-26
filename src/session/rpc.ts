/**
 * RPC 会话：WebSocket + JSON-RPC 2.0 连远端 harness agent 后端（rpc_server.py）。
 *
 * 这是 AgentSession 接缝的 agent 后端实现（唯一）：
 *   mock.ts   —— 本地剧本（离线测试夹具，非 agent 后端）
 *   rpc.ts    —— 把整轮对话交给远端 harness（本文件），工具/计划/历史都在服务端。
 *     原 liveSession / aiSdkSession 已删除：agent 能力统一在 py 后端用 Agent Framework 开发。
 *
 * 协议（与 rpc_server.py 的 docstring 一致）：
 *   请求  {jsonrpc:"2.0", id, method:"agent/chat", params:{session, prompt}}
 *   流中  服务端推 {"jsonrpc":"2.0","method":"agent/event","params":{session,event}}
 *         event.type ∈ answer_delta / thinking_delta / thinking_end /
 *                      tool_start / tool_line / tool_end
 *         —— 事件语义与 TurnSink 一一对应，这里只做透传映射。
 *   结束  同 id 的 result（成功）或 error（失败/取消）收尾，一轮一个终态。
 *
 * 会话历史在服务端 FileHistoryProvider（每 session 一个 JSONL）；
 * snapshot() 只存服务端 session id，恢复时拿它接回同一份磁盘历史。
 */
import type { AgentSession, RawImage, ThinkingInfo, ToolStep, TurnContext } from './seam.ts'
import { setBackendModel } from './model.ts'
import { setBackendMode } from './mode.ts'
import { setBackendUsage } from './usage.ts'
import { DEFAULT_RPC_URL, setBoot, type VerseBoot } from '../core/config.ts'

export type RpcOptions = {
  /** 后端地址，默认 DEFAULT_RPC_URL（客户端不读配置文件，改端口用 --url） */
  url?: string
}

type RpcEvent = {
  type: string
  text?: string
  id?: string
  name?: string
  arg?: string
  params?: Record<string, unknown>
  line?: string
  status?: 'ok' | 'error'
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

const CONNECT_TIMEOUT_MS = 5000

export function createRpcSession(opts: RpcOptions = {}): AgentSession {
  const url = opts.url ?? DEFAULT_RPC_URL
  let label = url
  try {
    label = new URL(url).host
  } catch {
    /* 地址写坏时 label 就原样显示，不拦启动 */
  }

  let ws: WebSocket | null = null
  let connecting: Promise<WebSocket> | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()
  /** 服务端会话 id：首轮生成，恢复时从 snapshot 接回磁盘历史 */
  let serverSid = `vt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  /** 当前轮的 sink：事件只在一轮进行中分发，轮外到达的直接丢弃 */
  let sink: TurnContext['sink'] | null = null
  let steps = new Map<string, ToolStep>()

  function dispatch(ev: RpcEvent): void {
    const s = sink
    if (!s) return
    switch (ev.type) {
      case 'answer_delta':
        if (ev.text) s.answerDelta(ev.text)
        break
      case 'thinking_delta':
        if (ev.text) s.thinkingDelta(ev.text)
        break
      case 'thinking_end':
        s.thinkingEnd()
        break
      case 'tool_start': {
        const id = ev.id ?? `t-${steps.size}`
        const step: ToolStep = { id, name: ev.name ?? 'tool', arg: ev.arg ?? '', params: ev.params }
        steps.set(id, step)
        s.toolStart(step)
        break
      }
      case 'tool_line': {
        const step = ev.id ? steps.get(ev.id) : undefined
        if (step && ev.line !== undefined) s.toolLine(step, ev.line)
        break
      }
      case 'tool_end': {
        const step = ev.id ? steps.get(ev.id) : undefined
        if (step) s.toolEnd(step, ev.status ?? 'ok')
        break
      }
      default:
        break // 服务端新增事件类型时旧客户端忽略即可，不崩
    }
  }

  function handleMessage(raw: string): void {
    let msg: { id?: number; method?: string; params?: { event?: RpcEvent }; result?: unknown; error?: { code?: number; message?: string } }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.method === 'agent/event') {
      const ev = msg.params?.event
      if (ev) dispatch(ev)
      return
    }
    if (msg.id === undefined) return
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    if (msg.error) {
      const err = new Error(msg.error.message ?? 'rpc error') as Error & { code?: number }
      err.code = msg.error.code
      waiter.reject(err)
    } else {
      waiter.resolve(msg.result)
    }
  }

  function ensureSocket(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws)
    if (connecting) return connecting
    connecting = new Promise<WebSocket>((resolve, reject) => {
      let sock: WebSocket
      try {
        sock = new WebSocket(url)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      const timer = setTimeout(() => {
        sock.close()
        reject(new Error(`连接超时（${CONNECT_TIMEOUT_MS}ms）：${url}`))
      }, CONNECT_TIMEOUT_MS)
      sock.onopen = () => {
        clearTimeout(timer)
        ws = sock
        resolve(sock)
        // 握手：回显 server/provider/model；model + harness 模式回填给 UI（欢迎块/状态栏）
        rpcCall(sock, 'initialize')
          .then((r) => {
            const m = (r as { model?: unknown } | null)?.model
            if (typeof m === 'string' && m) setBackendModel(m)
          })
          .catch(() => {})
        // 配置也从后端拿（唯一来源：config/get 的脱敏视图；失败则维持 BUILTIN）
        rpcCall(sock, 'config/get')
          .then((r) => setBoot((r ?? null) as VerseBoot | null))
          .catch(() => {})
        refreshMode(sock)
      }
      sock.onmessage = (msg: MessageEvent) => handleMessage(String(msg.data))
      sock.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`无法连接 ${url}（服务端起了吗？）`))
      }
      sock.onclose = () => {
        clearTimeout(timer)
        if (ws === sock) ws = null
        // 连接断掉时把在等的轮次全部报错，别让 respond() 悬着
        for (const [id, waiter] of pending) {
          pending.delete(id)
          waiter.reject(new Error('RPC 连接已关闭'))
        }
      }
    }).finally(() => {
      connecting = null
    })
    connecting.then(undefined, () => {})
    return connecting
  }

  function send(obj: Record<string, unknown>): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }

  /** 按 id 等一条 JSON-RPC 响应（通知 agent/event 照旧走 handleMessage 分发）。 */
  function rpcCall(sock: WebSocket, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = nextId++
    const p = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }))
    return p
  }

  // 连上就握手一次：initialize.result.model 回填 model，mode/get 回填 plan/execute 模式。
  // 启动即连（懒连接会让欢迎块只看到环境变量兜底）；失败静默，首轮 respond 会再连。
  void ensureSocket().then(undefined, () => {})

  /** mode/get：结果按 session 归属过滤——sid 在 restore() 里可能已换，旧 sid 的应答丢弃。 */
  function refreshMode(sock: WebSocket): void {
    const sidAtCall = serverSid
    rpcCall(sock, 'mode/get', { session: sidAtCall })
      .then((r) => {
        const resp = r as { session?: unknown; mode?: unknown } | null
        if (resp?.session !== sidAtCall || sidAtCall !== serverSid) return
        if (typeof resp.mode === 'string' && resp.mode) setBackendMode(resp.mode)
      })
      .catch(() => {})
  }

  return {
    id: 'rpc',
    kind: 'rpc',
    label: `rpc · ${label}`,
    /** 多轮上下文在服务端（FileHistoryProvider 磁盘 JSONL），客户端只带走服务端 id */
    snapshot(): unknown {
      return { sid: serverSid }
    },
    restore(state: unknown): void {
      const sid = (state as { sid?: unknown } | null)?.sid
      if (typeof sid === 'string' && sid && sid !== serverSid) {
        serverSid = sid
        // 换了会话：模式按 session 隔离，已连接就重问一次（未连接则由 onopen 的握手兜底）
        if (ws && ws.readyState === WebSocket.OPEN) refreshMode(ws)
      }
    },

    async respond(prompt: string, ctx: TurnContext, images?: RawImage[]): Promise<void> {
      sink = ctx.sink
      steps = new Map()
      let sock: WebSocket
      try {
        sock = await ensureSocket()
      } catch (err) {
        ctx.sink.answerDelta(`\n[RPC 错误] ${err instanceof Error ? err.message : String(err)}\n`)
        sink = null
        return
      }

      const id = nextId++
      const done = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      // images 非空 = 多模态输入（后端按 capabilities.image_in 门控，不支持回 -32602）
      const params: Record<string, unknown> = { session: serverSid, prompt }
      if (images?.length) params.images = images
      sock.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'agent/chat', params }))

      // Esc → agent/cancel（服务端把该轮以 -32001 收尾，respond 正常返回）
      let cancelSent = false
      const watchdog = setInterval(() => {
        if (ctx.aborted() && !cancelSent) {
          cancelSent = true
          send({ jsonrpc: '2.0', method: 'agent/cancel', params: { session: serverSid } })
        }
      }, 80)

      try {
        // 终态 result.usage = LLM 返回的真实用量（含缓存命中）→ 状态栏；取消轮 reject 不回填
        const result = (await done) as { usage?: Record<string, number> } | null
        setBackendUsage(result?.usage ?? null)
      } catch (err) {
        const code = (err as { code?: number }).code
        // -32001 = 我们自己发的 cancel，正常中止，不往转写里写错误
        if (code !== -32001 && !ctx.aborted()) {
          ctx.sink.answerDelta(`\n[RPC 错误] ${err instanceof Error ? err.message : String(err)}\n`)
        }
      } finally {
        clearInterval(watchdog)
        sink = null
      }
    },

    /** /model <id>：model/set → 回填信号，返回后端确认的 id */
    async setModel(id: string): Promise<string> {
      const sock = await ensureSocket()
      const r = (await rpcCall(sock, 'model/set', { model: id })) as { model?: unknown } | null
      const next = typeof r?.model === 'string' && r.model ? r.model : id
      setBackendModel(next)
      return next
    },

    /** Shift+Tab：mode/set → 回填模式信号，返回切换后的模式 */
    async setMode(mode: string): Promise<string> {
      const sock = await ensureSocket()
      const r = (await rpcCall(sock, 'mode/set', { session: serverSid, mode })) as { mode?: unknown } | null
      const next = typeof r?.mode === 'string' && r.mode ? r.mode : mode
      setBackendMode(next)
      return next
    },

    /** /effort：thinking/get → 当前档位与模型支持表（选择器数据源） */
    async getThinking(): Promise<ThinkingInfo> {
      const sock = await ensureSocket()
      return (await rpcCall(sock, 'thinking/get')) as ThinkingInfo
    },

    /** /effort <档位>：thinking/set → 返回后端确认的档位 */
    async setThinking(effort: string): Promise<string> {
      const sock = await ensureSocket()
      const r = (await rpcCall(sock, 'thinking/set', { effort })) as { effort?: unknown } | null
      return typeof r?.effort === 'string' && r.effort ? r.effort : effort
    },
  }
}
