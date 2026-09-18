/**
 * 配色与样式 token。
 *
 * vue-tui 的 Style 只认 ANSI 名或 hex（渲染器负责降级到 ansi256/ansi16），
 * 所以这里统一用 hex：真彩终端下观感最接近预期，降到 ansi256 也不糊。
 */
import type { Style } from '@simon_he/vue-tui/core'

export const palette = {
  accent: '#d97757',
  accentDim: '#a9664c',
  text: '#e6e6ea',
  dim: '#8b8b93',
  faint: '#5a5a63',
  ok: '#8fbf7f',
  warn: '#e0b25c',
  err: '#e06c75',
  link: '#7fb3ff',
  codeFg: '#c9d1f2',
  codeBg: '#23252e',
  border: '#3a3a42',
  // 语法高亮（都在 codeBg 上取值，保证对比度）
  synComment: '#6f7480',
  synKeyword: '#c678dd',
  synString: '#8fbf7f',
  synNumber: '#e0b25c',
  synFn: '#7fb3ff',
  synType: '#56b6c2',
  synLiteral: '#d19a66',
} as const

export const styles = {
  header: { fg: palette.accent, bold: true },
  headerMeta: { fg: palette.faint },
  status: { fg: palette.dim },
  statusActive: { fg: palette.accent, bold: true },
  statusOk: { fg: palette.ok },
  statusErr: { fg: palette.err },
  hint: { fg: palette.faint },
  faint: { fg: palette.faint },
  user: { fg: palette.text, bold: true },
  userMark: { fg: palette.accentDim, bold: true },
  thinking: { fg: palette.dim, italic: true },
  thinkingMark: { fg: palette.accentDim, italic: true },
  toolMark: { fg: palette.accent, bold: true },
  toolMarkErr: { fg: palette.err, bold: true },
  toolTitle: { fg: palette.text, bold: true },
  toolSummary: { fg: palette.dim },
  toolIn: { fg: palette.codeFg, bg: palette.codeBg },
  toolOut: { fg: palette.dim },
  text: { fg: palette.text },
  heading: { fg: palette.accent, bold: true },
  bullet: { fg: palette.accentDim },
  quote: { fg: palette.dim, italic: true },
  code: { fg: palette.codeFg, bg: palette.codeBg },
  inlineCode: { fg: palette.codeFg, bg: palette.codeBg },
  bold: { fg: palette.text, bold: true },
  italic: { fg: palette.text, italic: true },
  link: { fg: palette.link, underline: true },
  note: { fg: palette.warn },
  // —— 下面这几个此前被 rows.ts 引用却没定义（style 为 undefined → 静默不上色）。
  // 改成强类型 const 后这类拼写错误会被 tsc 直接拦下，不用靠人眼。
  userPrompt: { fg: palette.accentDim, bold: true },
  thinkingHeader: { fg: palette.dim, italic: true },
  dim: { fg: palette.dim },
  paramKey: { fg: palette.faint },
  paramVal: { fg: palette.codeFg },
}

/**
 * 语法高亮 token。用的时候要和 `styles.code` 合并（保住代码块背景）——
 * syntax.ts 里的 seg() 已经这么做了。
 */
export const syntax = {
  comment: { fg: palette.synComment, italic: true },
  keyword: { fg: palette.synKeyword },
  string: { fg: palette.synString },
  number: { fg: palette.synNumber },
  fn: { fg: palette.synFn },
  type: { fg: palette.synType },
  literal: { fg: palette.synLiteral },
  diffAdd: { fg: palette.ok },
  diffDel: { fg: palette.err },
  diffMeta: { fg: palette.accent },
}

/**
 * 工具名 → 头部颜色。同一个 accent 色系里拉开区别，扫一眼就知道这行在干什么。
 * 认不出来的工具退回 accent，不会没颜色。
 */
const TOOL_COLOR: Record<string, string> = {
  read: palette.synFn,
  write: palette.ok,
  edit: palette.synLiteral,
  bash: palette.accent,
  ls: palette.synType,
  grep: palette.synKeyword,
  search: palette.synKeyword,
}

export function toolHeaderStyle(title: string): Style {
  // 名字两种来源都要认：mock 剧本写 `Read(...)` / `Bash(...)`，
  // AI SDK 工具是 `read_file` / `bash` / `edit_file`。统一压成小写字母再取前缀。
  const raw = (title.trim().split(/[\s(]/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const key = raw.startsWith('read')
    ? 'read'
    : raw.startsWith('write')
      ? 'write'
      : raw.startsWith('edit')
        ? 'edit'
        : raw.startsWith('bash') || raw === 'codeshell'
          ? 'bash'
          : raw.startsWith('ls') || raw.startsWith('list')
            ? 'ls'
            : raw.startsWith('grep') || raw.startsWith('search')
              ? 'grep'
              : raw
  return { fg: TOOL_COLOR[key] ?? palette.accent, bold: true }
}

export const rendererPalette = {
  black: '#1b1b1f',
  white: '#e6e6ea',
  red: palette.err,
  green: palette.ok,
  yellow: palette.warn,
  blue: palette.link,
  magenta: '#c678dd',
  cyan: '#56b6c2',
} as const
