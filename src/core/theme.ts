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
} as const

export const styles: Record<string, Style> = {
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
