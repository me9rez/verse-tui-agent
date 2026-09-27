/**
 * 把终端 buffer 的行/格子转成带颜色的 HTML（供浏览器打开或 headless 截图）。
 * shot.ts 与 checks 共用，避免多份实现漂移。
 *
 * 颜色一律取自 `theme.ts` 的 palette —— 出图必须和终端里的观感同源。
 * 早先这里写死过一套 hex（底色 #0f0f12、正文 #e6e6ea、说明 #8b8b93），
 * 换色板时出图就和 TUI 对不上了；现在没有第二份色值。
 */
import { APP_ID, HEADER_LABEL } from './brand.ts'
import { palette } from './theme.ts'

export type CellLike = { ch?: string; style?: Record<string, unknown> }

/** ANSI 颜色名 → hex（core 的 Style 里 fg/bg 允许用 ANSI 名）。 */
export const ANSI_HEX: Record<string, string> = {
  black: palette.background,
  red: palette.err,
  green: palette.ok,
  yellow: palette.warn,
  blue: palette.accent,
  magenta: palette.purple,
  cyan: palette.link,
  white: palette.mutedFg,
  blackBright: palette.ring,
  redBright: palette.err,
  greenBright: palette.ok,
  yellowBright: palette.warn,
  blueBright: palette.link,
  magentaBright: palette.purple,
  cyanBright: palette.link,
  whiteBright: palette.foreground,
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const colorOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('#')) return value
  return ANSI_HEX[value] ?? null
}

export function rowsToHtml(
  rows: CellLike[][],
  opts: { cols: number; caption?: string; title?: string },
): string {
  const body = rows
    .map((row) => {
      let html = ''
      let runStyle: Record<string, unknown> | null = null
      let run = ''
      const flush = () => {
        if (!run) return
        const fg = colorOf(runStyle?.fg)
        const bg = colorOf(runStyle?.bg)
        const css = [
          fg ? `color:${fg}` : '',
          bg ? `background:${bg}` : '',
          runStyle?.bold ? 'font-weight:700' : '',
          runStyle?.dim ? 'opacity:.72' : '',
          runStyle?.italic ? 'font-style:italic' : '',
          runStyle?.underline ? 'text-decoration:underline' : '',
        ]
          .filter(Boolean)
          .join(';')
        html += css ? `<span style="${css}">${escapeHtml(run)}</span>` : escapeHtml(run)
        run = ''
      }
      for (const cell of row) {
        const style = (cell?.style ?? null) as Record<string, unknown> | null
        const same = runStyle === style || JSON.stringify(runStyle) === JSON.stringify(style)
        if (!same) {
          flush()
          runStyle = style
        }
        run += cell?.ch ?? ' '
      }
      flush()
      return html.replace(/ +$/, '')
    })
    .join('\n')

  const caption = opts.caption ?? `${HEADER_LABEL} · ${opts.cols}×${rows.length} cells`
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${opts.title ?? APP_ID}</title>
<style>
  html,body{margin:0;background:${palette.background}}
  .frame{padding:18px 22px}
  pre{margin:0;white-space:pre;font:13px/1.35 "Cascadia Mono","Consolas","Noto Sans Mono CJK SC",monospace;color:${palette.foreground}}
  .caption{font:12px/1.6 "Segoe UI",system-ui,sans-serif;color:${palette.mutedFg};padding:10px 22px 16px}
</style></head>
<body><div class="frame"><pre>${body}</pre></div>
<div class="caption">${escapeHtml(caption)}</div>
</body></html>`
}
