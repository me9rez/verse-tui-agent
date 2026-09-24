/**
 * 持久会话的数据模型（磁盘格式 v1）。
 *
 * 只存「能重放转写」的最小结构：每轮的用户输入、思考行、工具事件、正文行。
 * 不存流式增量——重放等价的单位是「行」（见 README 的实测表）。
 * 不存任何密钥：provider 只记 host 与 model 名。
 */
export const SESSION_SCHEMA_V = 1 as const

export type StoredTool = {
  name: string
  arg: string
  params?: Record<string, unknown>
  status: 'running' | 'ok' | 'error'
  /** 工具输出的完整行（不含 params 块） */
  out: string[]
}

export type StoredTurn = {
  user: string
  /** 思考的完整行 */
  thinking: string[]
  tools: StoredTool[]
  /** 正文的完整行 */
  answer: string[]
  /** 这一轮被 Esc 中断 */
  aborted?: boolean
  /** AgentSession.snapshot() 的结果（仅 ai 路有内容） */
  agentState?: unknown
}

export type SessionKind = 'mock' | 'live' | 'ai' | 'rpc'

export type StoredSession = {
  v: typeof SESSION_SCHEMA_V
  id: string
  title: string
  kind: SessionKind
  /** 只用于展示，不含密钥 */
  provider?: { host?: string; model?: string }
  createdAt: string
  updatedAt: string
  turns: StoredTurn[]
}

/** 会话 id：时间戳 + 4 位随机。天然按时间排序，人也能一眼看出是哪天哪会儿。 */
export function newSessionId(now: Date = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(
    now.getMinutes(),
  )}${p(now.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/** 会话标题：取首条用户输入，压平空白 + 去控制字符，最多 40 字（超出用 … 收尾） */
export function titleFromPrompt(prompt: string, max = 40): string {
  const flat = prompt.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!flat) return '(空会话)'
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function isStoredTurn(value: unknown): value is StoredTurn {
  if (!value || typeof value !== 'object') return false
  const t = value as Partial<StoredTurn>
  return (
    typeof t.user === 'string' && Array.isArray(t.thinking) && Array.isArray(t.answer) && Array.isArray(t.tools)
  )
}

/**
 * 校验磁盘上的对象能不能认。坏文件返回 null —— 调用方跳过并警告，
 * 绝不让一个写坏的文件把整个列表/启动搞崩。
 */
export function asStoredSession(value: unknown): StoredSession | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Partial<StoredSession>
  if (s.v !== SESSION_SCHEMA_V) return null
  if (typeof s.id !== 'string' || !s.id) return null
  if (typeof s.title !== 'string') return null
  if (s.kind !== 'mock' && s.kind !== 'live' && s.kind !== 'ai' && s.kind !== 'rpc') return null
  if (!Array.isArray(s.turns)) return null
  const epoch = new Date(0).toISOString()
  return {
    v: SESSION_SCHEMA_V,
    id: s.id,
    title: s.title,
    kind: s.kind,
    provider: s.provider,
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : epoch,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : epoch,
    turns: s.turns.filter(isStoredTurn),
  }
}
