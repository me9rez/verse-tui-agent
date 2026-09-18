/**
 * 极小的语法高亮：够终端用就行，不追求语法正确。
 *
 * 为什么不引 shiki / highlight.js：那些库产出 HTML 或主题 JSON，几百 KB 起步，
 * 还得再映射回 ANSI 样式；终端里给几行代码上色，一张关键字表就够。
 * 失败模式是「某行没上色」而不是「画错」——所有 token 最终都退回 code 基础样式。
 *
 * 已知取舍：
 *   - 跨行块注释（`/*` 开、`*` 续）按「行首是 * 就当注释」处理，不做状态机；
 *   - 不做语法树，`/` 只在明确位置当正则起始，其余当运算符；
 *   - diff 只认 `@@` / `+` / `-` 三种前缀，够看。
 */
import type { Style } from '@simon_he/vue-tui/core'
import type { TTranscriptSegment } from '@simon_he/vue-tui/agent'
import { styles, syntax } from './theme.ts'

export type Lang = 'ts' | 'js' | 'json' | 'bash' | 'diff' | 'yaml' | 'md' | 'plain'

/** ```ts / ```bash 之类 → Lang；认不出来就 plain（不上色，但仍然有 code 背景） */
export function langOf(info: string): Lang {
  const v = info.trim().toLowerCase().replace(/^```|^~~~/, '')
  if (!v) return 'plain'
  if (v.startsWith('ts') || v.startsWith('js') || v === 'javascript' || v === 'typescript') return 'ts'
  if (v.startsWith('json')) return 'json'
  if (v.startsWith('bash') || v.startsWith('sh') || v === 'shell' || v === 'console' || v === 'cmd') return 'bash'
  if (v.startsWith('diff') || v.startsWith('patch')) return 'diff'
  if (v.startsWith('yaml') || v.startsWith('yml')) return 'yaml'
  if (v.startsWith('md') || v.startsWith('markdown')) return 'md'
  return 'plain'
}

const KEYWORDS: Record<string, readonly string[]> = {
  ts: [
    'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return', 'if', 'else',
    'for', 'of', 'in', 'while', 'await', 'async', 'class', 'extends', 'implements', 'interface', 'type',
    'new', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof', 'this', 'super', 'void', 'as',
    'satisfies', 'enum', 'readonly', 'public', 'private', 'protected', 'static', 'yield', 'delete',
    'switch', 'case', 'break', 'continue', 'do', 'declare', 'namespace', 'abstract',
  ],
  json: ['true', 'false', 'null'],
  bash: [
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function',
    'return', 'export', 'local', 'set', 'source', 'exit', 'echo', 'printf', 'read', 'cd', 'test',
    'pnpm', 'npm', 'npx', 'node', 'git', 'curl', 'jq', 'rg', 'grep', 'sed', 'awk', 'head', 'tail',
    'cat', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'dir', 'type', 'find', 'taskkill', 'where', 'rem', 'call',
    'setlocal', 'endlocal', 'timeout', 'start',
  ],
  yaml: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
  md: [],
  diff: [],
  plain: [],
}

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

/** 行首是 * 且不在字符串里 —— JSDoc 续行，按注释上色 */
const BLOCK_COMMENT_CONT = /^\s*\*(\s|$)/

function seg(text: string, style: Style): TTranscriptSegment {
  return { text, style: { ...styles.code, ...style } }
}

/** 单段落返回。别写成 `[seg(...)]`：数组字面量遇到库里的 Readonly 联合类型时，
 *  TS 会报一个自相矛盾的「Property 'text' is missing」——先建数组再 push 就没事。 */
function one(text: string, style: Style): TTranscriptSegment[] {
  const out: TTranscriptSegment[] = []
  out.push(seg(text, style))
  return out
}

export function highlightLine(text: string, lang: Lang, prev?: { blockComment?: boolean }): TTranscriptSegment[] {
  if (!text) return one('', styles.code)
  if (lang === 'plain' || lang === 'md') return one(text, styles.code)
  if (lang === 'diff') return diffLine(text)

  const hashComment = lang === 'bash' || lang === 'yaml'
  const slashComment = lang === 'ts' || lang === 'json'
  const kw = KEYWORDS[lang] ?? []

  // 上一行开了块注释还没关：整行按注释处理，直到遇到 */
  if (prev?.blockComment && slashComment) {
    const end = text.indexOf('*/')
    if (end === -1) return one(text, syntax.comment)
    return [seg(text.slice(0, end + 2), syntax.comment), ...scan(text.slice(end + 2), { slashComment, hashComment, kw, inBlock: false })]
  }
  if (BLOCK_COMMENT_CONT.test(text) && slashComment) return one(text, syntax.comment)

  return scan(text, { slashComment, hashComment, kw, inBlock: false })
}

type ScanOpts = { slashComment: boolean; hashComment: boolean; kw: readonly string[]; inBlock: boolean }

/** 逐字符扫描，比一坨正则更好读也更好改 */
function scan(input: string, opts: ScanOpts): TTranscriptSegment[] {
  const out: TTranscriptSegment[] = []
  let buf = ''
  let i = 0
  const flush = (style: Style) => {
    if (buf) {
      out.push(seg(buf, style))
      buf = ''
    }
  }
  while (i < input.length) {
    const c = input[i]!
    const rest = input.slice(i)

    // 块注释
    if (opts.slashComment && rest.startsWith('/*')) {
      flush(styles.code)
      const end = input.indexOf('*/', i + 2)
      const chunk = end === -1 ? input.slice(i) : input.slice(i, end + 2)
      out.push(seg(chunk, syntax.comment))
      i += chunk.length
      continue
    }
    // 行注释：// 与 #（bash/yaml）
    if (opts.slashComment && rest.startsWith('//')) {
      flush(styles.code)
      out.push(seg(rest, syntax.comment))
      i = input.length
      continue
    }
    if (opts.hashComment && c === '#' && !/[A-Za-z0-9_$]/.test(input[i - 1] ?? '')) {
      flush(styles.code)
      out.push(seg(rest, syntax.comment))
      i = input.length
      continue
    }
    // 字符串（含模板串），带转义
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < input.length && input[j] !== c) {
        if (input[j] === '\\') j++
        j++
      }
      const closed = j < input.length
      flush(styles.code)
      out.push(seg(input.slice(i, closed ? j + 1 : j), syntax.string))
      i = closed ? j + 1 : j
      continue
    }
    // 数字
    if (/[0-9]/.test(c) && !/[A-Za-z0-9_$]/.test(input[i - 1] ?? '')) {
      const m = /^[0-9][0-9_]*(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?/i.exec(rest)!
      flush(styles.code)
      out.push(seg(m[0], syntax.number))
      i += m[0].length
      continue
    }
    // 标识符 → 关键字 / 字面量 / 函数调用 / 类型
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(rest)!
      const word = m[0]
      flush(styles.code)
      if (opts.kw.includes(word)) out.push(seg(word, syntax.keyword))
      else if (LITERALS.has(word)) out.push(seg(word, syntax.literal))
      else if (/^\s*\(/.test(input.slice(i + word.length))) out.push(seg(word, syntax.fn))
      else if (/^[A-Z]/.test(word)) out.push(seg(word, syntax.type))
      else buf += word
      i += word.length
      continue
    }
    buf += c
    i++
  }
  flush(styles.code)
  if (!out.length) out.push(seg(input, styles.code))
  return out
}

function diffLine(text: string): TTranscriptSegment[] {
  // 先归一成 Style 再包 segment：直接写数组字面量时，TS 会在联合类型上要求
  // 「所有成员都有的属性」，报一个看不懂的 Property 'text' is missing。
  let style: Style = styles.code
  if (/^\s*@@/.test(text)) style = syntax.diffMeta
  else if (/^\s*\+/.test(text)) style = syntax.diffAdd
  else if (/^\s*-/.test(text)) style = syntax.diffDel
  return one(text, style)
}

/** 供 rows.ts 用：一行是不是「key: value」形式（工具参数值行） */
export function paramParts(text: string): [string, string] | null {
  const m = /^(\s*)([A-Za-z_][\w.$-]*):\s(.*)$/.exec(text)
  if (!m) return null
  return [`${m[1]}${m[2]}: `, m[3]!]
}
