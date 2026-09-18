/**
 * .env 加载器的行为检查（不联网、秒级）：
 *   1. 文件里的键会进 process.env（含引号与空格的处理）
 *   2. 真实环境变量优先——命令行已有的键**不被文件覆盖**
 *   3. 同一轮加载里，`.env.local` 覆盖 `.env`
 *   4. 文件不存在时静默跳过（离线 mock 仍能跑）
 *   5. 坏行只警告、不阻塞启动
 *   6. 返回值只有文件名与键名，**不含键值**
 *
 * 注意：每个阶段用一批互不重叠的键名——同一个进程里"已经有的键"不会被再覆盖，
 * 拿同一批键跑两个阶段会把"层级覆盖"误判成失败（第一版就踩了这个）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadDotEnv } from './env.ts'

const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
const touched = ['VT_MODEL', 'VT_API_KEY', 'VT_QUOTED', 'VT_SPEED', 'VT_SHOT_ROWS', 'VT_AGENT_ROOT']

// ── 阶段 1：基本加载 + 命令行优先 ────────────────────────────────────
const dirA = mkdtempSync(path.join(tmpdir(), 'vt-env-a-'))
writeFileSync(path.join(dirA, '.env'), 'VT_MODEL=from-file\nVT_API_KEY=file-key\nVT_QUOTED="含 空格"\n', 'utf8')
process.env.VT_MODEL = 'from-shell'
const resA = loadDotEnv(dirA)
check('缺文件时静默跳过', loadDotEnv(path.join(dirA, 'nope')).files.length === 0, '不存在的目录不报错')
check('文件里的键进入环境', process.env.VT_QUOTED === '含 空格', `VT_QUOTED=${JSON.stringify(process.env.VT_QUOTED)}`)
check('命令行已有的键不被覆盖', process.env.VT_MODEL === 'from-shell', `VT_MODEL=${process.env.VT_MODEL}`)
check(
  '只回报新增键名',
  resA.keys.includes('VT_API_KEY') && !resA.keys.includes('VT_MODEL'),
  `files=[${resA.files.join(',')}] keys=[${resA.keys.join(',')}]`,
)
check('返回值里不含密钥本体', !JSON.stringify(resA).includes('file-key'), 'files/keys 只有名字')

// ── 阶段 2：.env.local 覆盖 .env（换一批键名，避免踩"已存在不再覆盖"）──
const dirB = mkdtempSync(path.join(tmpdir(), 'vt-env-b-'))
writeFileSync(path.join(dirB, '.env'), 'VT_SPEED=1\nVT_SHOT_ROWS=10\n', 'utf8')
writeFileSync(path.join(dirB, '.env.local'), 'VT_SHOT_ROWS=20\n', 'utf8')
const resB = loadDotEnv(dirB)
check('.env.local 覆盖 .env', process.env.VT_SHOT_ROWS === '20', `VT_SHOT_ROWS=${process.env.VT_SHOT_ROWS}`)
check('.env 里未被覆盖的键保留', process.env.VT_SPEED === '1', `VT_SPEED=${process.env.VT_SPEED}`)
check('两个文件都出现在结果里', resB.files.join(',') === '.env,.env.local', `files=[${resB.files.join(',')}]`)

// ── 阶段 3：坏行降级为警告 ──────────────────────────────────────────
const dirC = mkdtempSync(path.join(tmpdir(), 'vt-env-c-'))
writeFileSync(path.join(dirC, '.env'), 'VT_AGENT_ROOT=./.agent-sandbox\n这一行没有等号\n', 'utf8')
let threw = false
try {
  loadDotEnv(dirC)
} catch {
  threw = true
}
check(
  '坏行只警告不阻塞',
  !threw && process.env.VT_AGENT_ROOT === './.agent-sandbox',
  `正常行仍生效，VT_AGENT_ROOT=${process.env.VT_AGENT_ROOT}`,
)

for (const d of [dirA, dirB, dirC]) rmSync(d, { recursive: true, force: true })
for (const k of touched) delete process.env[k]

for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
const failed = checks.filter((c) => !c.ok).length
console.log(failed ? `\nFAIL: ${failed} 项未通过` : '\nPASS: .env 加载行为全部符合预期')
process.exit(failed ? 1 : 0)
