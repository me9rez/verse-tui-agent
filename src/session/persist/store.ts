/**
 * 会话持久化：一个会话一个 JSON 文件，默认目录 <repo>/.verse-sessions/。
 *
 * 没有索引文件：列表直接扫目录、读每个文件（会话都很小），
 * 少一个需要维护同步的冗余结构，就少一类「索引与内容不一致」的 bug。
 * setSessionDir 可覆盖目录——TUI 按 tui.toml 注入，测试必须指到临时目录别污染仓库。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { asStoredSession, type StoredSession } from './model.ts'

const DEFAULT_DIR = '.verse-sessions'
const EXT = '.json'

let dirOverride = ''

/** 注入会话目录（TUI 启动按 tui 配置、测试指到临时目录；接替旧的会话目录环境变量）。 */
export function setSessionDir(dir: string): void {
  dirOverride = dir
}

export function sessionDir(): string {
  return resolve(dirOverride || DEFAULT_DIR)
}

export function sessionPath(id: string): string {
  return join(sessionDir(), `${id}${EXT}`)
}

/** 原子写：先写 .tmp 再 rename。崩在写一半也不会毁掉上一份好数据。 */
export function saveSession(session: StoredSession): string {
  mkdirSync(sessionDir(), { recursive: true })
  const path = sessionPath(session.id)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

export function loadSession(id: string): StoredSession | null {
  const path = sessionPath(id)
  if (!existsSync(path)) return null
  try {
    return asStoredSession(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    console.warn(`[session] 跳过读不动的会话文件 ${path}：${(err as Error).message}`)
    return null
  }
}

/** 列表：按 updatedAt 倒序（最近更新的在前），坏文件跳过 */
export function listSessions(): StoredSession[] {
  const where = sessionDir()
  if (!existsSync(where)) return []
  const out: StoredSession[] = []
  for (const file of readdirSync(where)) {
    if (!file.endsWith(EXT)) continue
    const one = loadSession(file.slice(0, -EXT.length))
    if (one) out.push(one)
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function deleteSession(id: string): boolean {
  const path = sessionPath(id)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/** 最近更新过的会话（--continue 用） */
export function latestSession(): StoredSession | null {
  return listSessions()[0] ?? null
}
