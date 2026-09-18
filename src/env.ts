/**
 * .env 加载：所有入口先调 loadDotEnv()，之后正常读 process.env 即可。
 *
 * 规则（刻意选的，别改乱）：
 *   1. 顺序：`.env` → `.env.local`（后者覆盖前者）。
 *   2. **真实环境变量永远优先**：命令行/系统里已经有的键不会被文件覆盖
 *      （Node 的 process.loadEnvFile 就是这语义，实测确认过）。
 *   3. 只回报「键名」，从不打印键值——密钥不能进日志、进终端、进聊天记录。
 *   4. 文件不存在不算错误：没 .env 时一切照旧，mock 剧本仍可离线跑。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type DotEnvResult = Readonly<{
  /** 实际读到的文件（相对 root 的文件名） */
  files: readonly string[]
  /** 由文件带入、且此前环境中不存在的键名 */
  keys: readonly string[]
}>

const CANDIDATES = ['.env', '.env.local'] as const

/** 换行符常量：源码里不写转义，免得被多层转义搞坏。 */
const NL = String.fromCharCode(10)

/** 本 demo 认识的环境变量（只用于 /env 命令展示，不参与加载逻辑）。 */
export const KNOWN_KEYS = [
  'VT_AGENT',
  'VT_AGENT_ROOT',
  'VT_BASE_URL',
  'VT_MODEL',
  'VT_API_KEY',
  'VT_LIVE',
  'VT_SPEED',
  'VT_SHOT_ROWS',
  'VT_SHOT_PROMPT',
  'VT_CHECK_TIMEOUT_MS',
] as const

/** 极简 KEY=VALUE 解析：忽略空行与 # 注释，去掉一层成对引号，坏行计数。 */
function parseEnvFile(text: string): { entries: Array<[string, string]>; badLines: number } {
  const entries: Array<[string, string]> = []
  let badLines = 0
  for (const raw of text.split(NL)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) {
      badLines++
      continue
    }
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      badLines++
      continue
    }
    let value = line.slice(eq + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    if (quoted) value = value.slice(1, -1)
    entries.push([key, value])
  }
  return { entries, badLines }
}

let cached: DotEnvResult = { files: [], keys: [] }

/** 最近一次 loadDotEnv 的结果（供 /env 命令展示，只有文件名与键名）。 */
export function dotEnvResult(): DotEnvResult {
  return cached
}

export function loadDotEnv(root: string = process.cwd()): DotEnvResult {
  const files: string[] = []
  const keys = new Set<string>()
  const original = new Set(Object.keys(process.env)) // 加载前的真实环境：永不被覆盖
  for (const name of CANDIDATES) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (err) {
      console.error(`[env] ${name} 读取失败，已忽略：${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    const { entries, badLines } = parseEnvFile(text)
    if (badLines) console.warn(`[env] ${name}：忽略 ${badLines} 行无法解析的内容`)
    for (const [key, value] of entries) {
      if (original.has(key)) continue // 命令行/系统变量优先
      process.env[key] = value // 后面的文件覆盖前面的文件
      keys.add(key)
    }
    files.push(name)
  }
  cached = { files, keys: [...keys] }
  return cached
}

/** 供界面展示：脱敏后的配置概览（永远不出现密钥本体）。 */
export function describeProvider(env: NodeJS.ProcessEnv = process.env): {
  baseUrl: string
  model: string
  hasKey: boolean
  agentRoot: string
  rawRoot: string
} {
  const baseUrl = env.VT_BASE_URL ?? ''
  let host = ''
  try {
    host = baseUrl ? new URL(baseUrl).host : ''
  } catch {
    host = baseUrl
  }
  // 工作区展示成绝对路径：.env 里通常写相对路径，光看 ./xxx 不知道 agent 到底会动哪个目录
  const rawRoot = env.VT_AGENT_ROOT || process.cwd()
  const absRoot = path.resolve(rawRoot)
  return {
    baseUrl: host || '(未设置)',
    model: env.VT_MODEL || '(未设置)',
    hasKey: Boolean(env.VT_API_KEY),
    agentRoot: `${absRoot}${existsSync(absRoot) ? '' : '（不存在，跑工具时会报错）'}`,
    rawRoot,
  }
}
