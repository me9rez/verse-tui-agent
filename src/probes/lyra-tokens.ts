/**
 * 断言 `DESIGN.md` 的 front matter 与 `src/core/theme.ts` 的 palette **逐项同值**。
 *
 * 为什么需要它：颜色单源只有靠可执行断言才守得住 —— 改了一边忘了另一边，
 * 文档就成了谎话（此前 `src/core/html.ts` 就漂移过一套写死的 hex）。
 *
 *   node src/probes/lyra-tokens.ts     # 一致 → 退出码 0；漂移 → 1
 *
 * 只比对「有唯一含义」的 token：兼容别名（text/dim/faint/codeFg/codeBg）是历史引用的
 * 别名，值必然与主 token 重复，不要求它们在文档里单独登记。
 */
import { readFileSync } from 'node:fs'
import { palette } from '../core/theme.ts'

const raw = readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8')
const fence = raw.split('---')
if (fence.length < 3) {
  console.error('DESIGN.md 没有 YAML front matter')
  process.exit(1)
}
const frontMatter = fence[1] ?? ''

// 只认 `  key: "#rrggbb"` 这种字形，够用且不引 YAML 依赖。
const declared = new Map<string, string>()
for (const line of frontMatter.split('\n')) {
  const m = /^\s{2}([a-z][a-z-]*):\s*"?(#[0-9a-fA-F]{6})"?\s*$/.exec(line)
  if (m?.[1] && m[2]) declared.set(m[1], m[2].toLowerCase())
}
if (declared.size === 0) {
  console.error('DESIGN.md 的 colors 段没解析出任何 hex —— 格式变了？')
  process.exit(1)
}

/** DESIGN.md 的 token 名 → palette 键。 */
const MAP: ReadonlyArray<readonly [string, keyof typeof palette]> = [
  ['background', 'background'],
  ['foreground', 'foreground'],
  ['card', 'card'],
  ['muted', 'muted'],
  ['muted-foreground', 'mutedFg'],
  ['primary', 'primary'],
  ['primary-foreground', 'primaryFg'],
  ['accent', 'accent'],
  ['accent-dim', 'accentDim'],
  ['link', 'link'],
  ['purple', 'purple'],
  ['ring', 'ring'],
  ['border', 'border'],
  ['input', 'input'],
  ['destructive', 'err'],
  ['ok', 'ok'],
  ['warn', 'warn'],
  ['syn-comment', 'synComment'],
  ['syn-keyword', 'synKeyword'],
  ['syn-string', 'synString'],
  ['syn-number', 'synNumber'],
  ['syn-fn', 'synFn'],
  ['syn-type', 'synType'],
  ['syn-literal', 'synLiteral'],
]

const pool = palette as Record<string, string>
const bad: string[] = []
let same = 0
for (const [docKey, paletteKey] of MAP) {
  const doc = declared.get(docKey)
  const code = pool[paletteKey as string]
  if (!doc) bad.push(`DESIGN.md 未登记 ${docKey}`)
  else if (!code) bad.push(`theme.ts 没有 palette.${String(paletteKey)}`)
  else if (doc !== code) bad.push(`${docKey}: DESIGN.md ${doc} ≠ theme.ts ${code}`)
  else same++
}

console.log(`lyra-tokens: ${same}/${MAP.length} 项同值`)
for (const line of bad) console.log(`  ✗ ${line}`)
if (bad.length) {
  console.log('\n设计文档与 theme.ts 漂移了 —— 两边改到同值再提交。')
  process.exit(1)
}
console.log('✔ DESIGN.md ↔ theme.ts 完全一致（颜色单源成立）')
