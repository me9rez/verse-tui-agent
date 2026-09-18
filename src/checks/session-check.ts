/**
 * 无头会话持久化检查：不碰真实终端、不碰真端点，只在临时目录里读写。
 *
 *   node src/checks/session-check.ts
 *
 * 用 VT_SESSION_DIR 把会话目录指到临时目录——绝不污染仓库自己的 .verse-sessions/。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTranscriptStore } from '../core/transcript/index.ts'
import {
  SESSION_SCHEMA_V,
  asStoredSession,
  newSessionId,
  titleFromPrompt,
  type StoredSession,
} from '../core/session/index.ts'

// ── 断言小工具（与 smoke.ts 同样的形状：名字 + 事实 + 细节）─────────────────
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

// ── 每组断言写成一个函数，最后统一跑 ──────────────────────────────────────
const groups: Array<[string, () => Promise<void> | void]> = []

function section(title: string, fn: () => Promise<void> | void): void {
  groups.push([title, fn])
}

// 独立的临时会话目录 + 造一个合法会话的工厂
const dir = mkdtempSync(join(tmpdir(), 'verse-sessions-'))
process.env.VT_SESSION_DIR = dir

function makeSession(id: string, over: Partial<StoredSession> = {}): StoredSession {
  const now = new Date().toISOString()
  return {
    v: SESSION_SCHEMA_V,
    id,
    title: `会话 ${id}`,
    kind: 'mock',
    createdAt: now,
    updatedAt: now,
    turns: [],
    ...over,
  }
}

// ── 第 1 组：模型层 ───────────────────────────────────────────────────────
section('模型层', () => {
  const id1 = newSessionId(new Date(2026, 8, 18, 16, 57, 38))
  const id2 = newSessionId(new Date(2026, 8, 18, 16, 57, 38))
  check('会话 id 形状可读且唯一', /^\d{8}-\d{6}-[a-z0-9]{4}$/.test(id1) && id1 !== id2, `${id1} / ${id2}`)

  const long = 'x'.repeat(80)
  check(
    '标题压平空白并截断到 40 字',
    titleFromPrompt('  第一行\n第二行\t  第三行 ') === '第一行 第二行 第三行' &&
      titleFromPrompt(long).length === 40 &&
      titleFromPrompt(long).endsWith('…'),
    `${titleFromPrompt('  第一行\n第二行\t  第三行 ')} | ${titleFromPrompt(long).length} 字`,
  )
  check('空输入有兜底标题', titleFromPrompt('   ') === '(空会话)', titleFromPrompt('   '))

  check(
    '坏数据被校验挡掉（版本 / kind / turns）',
    asStoredSession(null) === null &&
      asStoredSession({ ...makeSession('a'), v: 99 }) === null &&
      asStoredSession({ ...makeSession('a'), kind: 'nope' }) === null &&
      asStoredSession({ ...makeSession('a'), turns: 'x' }) === null,
    '四种坏输入都返回 null',
  )
  check('合法数据能穿过校验', asStoredSession(makeSession('ok'))?.id === 'ok', 'id 原样保留')
})

// ── 第 2 组：读写（T4 追加）───────────────────────────────────────────────
// ── 第 3 组：重放（T6 追加）───────────────────────────────────────────────
// ── 第 4 组：记录器（T8 追加）─────────────────────────────────────────────

// ── 跑 ────────────────────────────────────────────────────────────────────
for (const [title, fn] of groups) {
  await fn()
  console.log(`· ${title}`)
}

const failures = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
rmSync(dir, { recursive: true, force: true })
console.log(`\n会话检查：${checks.length - failures.length}/${checks.length} 通过`)
process.exit(failures.length ? 1 : 0)
