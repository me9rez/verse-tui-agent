/**
 * RPC 会话：WebSocket + JSON-RPC 2.0 连远端 harness agent 后端（rpc_server.py）。
 *
 * 这是 AgentSession 接缝的 agent 后端实现（唯一）：
 *   mockSession  —— 本地剧本（离线测试夹具，非 agent 后端）
 *   rpcSession   —— 把整轮对话交给远端 harness（本文件），工具/计划/历史都在服务端。
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
import type { AgentSession, ToolStep, TurnContext } from './session.ts'

export type RpcOptions = {
  /** 后端地址，默认 ws://127.0.0.1:8765（也可用 VT_RPC_URL） */
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
  const url = opts.url ?? process.env.VT_RPC_URL ?? 'ws://127.0.0.1:8765'
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
      if (typeof sid === 'string' && sid) serverSid = sid
    },

    async respond(prompt: string, ctx: TurnContext): Promise<void> {
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
      sock.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'agent/chat', params: { session: serverSid, prompt } }))

      // Esc → agent/cancel（服务端把该轮以 -32001 收尾，respond 正常返回）
      let cancelSent = false
      const watchdog = setInterval(() => {
        if (ctx.aborted() && !cancelSent) {
          cancelSent = true
          send({ jsonrpc: '2.0', method: 'agent/cancel', params: { session: serverSid } })
        }
      }, 80)

      try {
        await done
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
  }
}
