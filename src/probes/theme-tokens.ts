/**
 * 主题 token 的漂移守卫（探针，不是测试套件）：断言**四方同值**
 *
 *   1. `src/core/theme.ts` 的 `DEFAULT_THEME` / `LIGHT_THEME`（前端默认 + mock 兜底）
 *   2. `backend/theme.py` 的 `DARK` / `LIGHT`（主题解析的基准，`theme/list` 下发的值）
 *   3. `DESIGN.md` front matter 的 19 个 token（文档）
 *   4. `palette` 的派生映射（由 19 个 token 算出的、组件真正读的那套键）
 *
 * 为什么要有它：颜色单源靠人肉纪律守不住 —— 这个仓库就漂过一次（`core/html.ts` 曾写死过另一套 hex，
 * 换色板后出图与终端对不上）。所以让「改一处忘一处」变成一条能红的断言。
 *
 * 跑：`node src/probes/theme-tokens.ts`
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTIN_THEMES, DEFAULT_THEME, LIGHT_THEME, palette, THEME_TOKENS } from '../core/theme.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let failed = 0
let checked = 0

function check(label: string, actual: unknown, expected: unknown): void {
  checked++
  if (actual === expected) return
  failed++
  console.log(`  ✗ ${label}\n      实际 ${String(actual)}\n      期望 ${String(expected)}`)
}

// ── 1. backend/theme.py 的 DARK / LIGHT ────────────────────────────────────
const py = readFileSync(join(root, 'backend', 'theme.py'), 'utf-8')

function pyTable(name: string): Record<string, string> {
  const block = py.match(new RegExp(`${name}: dict\\[str, str\\] = \\{([\\s\\S]*?)\\n\\}`))
  const out: Record<string, string> = {}
  for (const line of (block?.[1] ?? '').split('\n')) {
    const m = line.match(/"([A-Za-z]+)":\s*"(#[0-9A-Fa-f]{6})"/)
    if (m?.[1] && m[2]) out[m[1]] = m[2]
  }
  return out
}

const pyDark = pyTable('DARK')
const pyLight = pyTable('LIGHT')
console.log(`backend/theme.py：DARK ${Object.keys(pyDark).length} 项、LIGHT ${Object.keys(pyLight).length} 项`)
check('theme.py 的 DARK 项数', Object.keys(pyDark).length, 19)
check('theme.py 的 LIGHT 项数', Object.keys(pyLight).length, 19)

// ── 2. DESIGN.md front matter 的 colors ────────────────────────────────────
const md = readFileSync(join(root, 'DESIGN.md'), 'utf-8')
const fm = md.match(/^---\n([\s\S]*?)\n---/)
const mdColors: Record<string, string> = {}
for (const line of (fm?.[1] ?? '').split('\n')) {
  const m = line.match(/^\s{2}([A-Za-z]+):\s*"(#[0-9A-Fa-f]{6})"\s*$/)
  if (m?.[1] && m[2]) mdColors[m[1]] = m[2]
}
console.log(`DESIGN.md front matter：${Object.keys(mdColors).length} 个 color token`)

// ── 3. 四方逐项比对（19 个主题 token）───────────────────────────────────────
for (const token of THEME_TOKENS) {
  check(`DEFAULT_THEME.${token} ↔ theme.py DARK`, DEFAULT_THEME[token], pyDark[token])
  check(`DEFAULT_THEME.${token} ↔ DESIGN.md`, DEFAULT_THEME[token], mdColors[token])
  check(`LIGHT_THEME.${token} ↔ theme.py LIGHT`, LIGHT_THEME[token], pyLight[token])
}

// ── 4. palette 的派生映射（组件真正读的键）─────────────────────────────────
check('palette.accent === primary', palette.accent, DEFAULT_THEME.primary)
check('palette.link === primary', palette.link, DEFAULT_THEME.primary)
check('palette.accentDim === accent', palette.accentDim, DEFAULT_THEME.accent)
check('palette.purple === shellMode', palette.purple, DEFAULT_THEME.shellMode)
check('palette.roleUser === roleUser', palette.roleUser, DEFAULT_THEME.roleUser)
check('palette.text === text', palette.text, DEFAULT_THEME.text)
check('palette.dim === textDim', palette.dim, DEFAULT_THEME.textDim)
check('palette.faint === textMuted', palette.faint, DEFAULT_THEME.textMuted)
check('palette.border === border', palette.border, DEFAULT_THEME.border)
check('palette.focus === borderFocus', palette.focus, DEFAULT_THEME.borderFocus)
check('palette.ok === success', palette.ok, DEFAULT_THEME.success)
check('palette.warn === warning', palette.warn, DEFAULT_THEME.warning)
check('palette.err === error', palette.err, DEFAULT_THEME.error)
check('palette.codeFg === textStrong', palette.codeFg, DEFAULT_THEME.textStrong)
check('palette.synComment === textMuted', palette.synComment, DEFAULT_THEME.textMuted)
check('palette.synKeyword === shellMode', palette.synKeyword, DEFAULT_THEME.shellMode)
check('palette.synString === success', palette.synString, DEFAULT_THEME.success)
check('palette.synNumber === warning', palette.synNumber, DEFAULT_THEME.warning)
check('palette.synFn === primary', palette.synFn, DEFAULT_THEME.primary)
check('palette.synType === accent', palette.synType, DEFAULT_THEME.accent)
check('palette.synLiteral === error', palette.synLiteral, DEFAULT_THEME.error)

// DESIGN.md 里被引用的派生 token 也必须与 palette 同值（否则文档写的是另一套色）
for (const [mdKey, paletteValue] of [
  ['primaryFg', palette.primaryFg],
  ['background', palette.background],
  ['surface', palette.codeBg],
  ['synComment', palette.synComment],
  ['synKeyword', palette.synKeyword],
  ['synString', palette.synString],
  ['synNumber', palette.synNumber],
  ['synFn', palette.synFn],
  ['synType', palette.synType],
  ['synLiteral', palette.synLiteral],
] as const) {
  check(`DESIGN.md.${mdKey} ↔ palette`, mdColors[mdKey], paletteValue)
}

// ── 5. 内置表与 DEFAULT_THEME 是同一对象（mock 兜底不会走偏）───────────────
check('BUILTIN_THEMES.dark === DEFAULT_THEME', BUILTIN_THEMES.dark, DEFAULT_THEME)
check('BUILTIN_THEMES.light === LIGHT_THEME', BUILTIN_THEMES.light, LIGHT_THEME)

console.log(`\n${failed ? '✗' : '✓'} ${checked - failed}/${checked} 项通过`)
process.exit(failed ? 1 : 0)
