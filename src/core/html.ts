/**
 * 把终端 buffer 的行/格子转成带颜色的 HTML（供浏览器打开或 headless 截图）。
 * shot.ts 与 live-check.ts 共用，避免两份实现漂移。
 */
export type CellLike = { ch?: string; style?: Record<string, unknown> }

/** ANSI 颜色名 → hex（core 的 Style 里 fg/bg 允许用 ANSI 名）。 */
export const ANSI_HEX: Record<string, string> = {
  black: '#1c1c22',
  red: '#e06c75',
  green: '#7fc27f',
  yellow: '#e0b25c',
  blue: '#6a9bff',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d7dae0',
  blackBright: '#5c5c66',
  redBright: '#ff7b72',
  greenBright: '#8fd48f',
  yellowBright: '#f0c674',
  blueBright: '#7fb3ff',
  magentaBright: '#d7a6ff',
  cyanBright: '#66d9e8',
  whiteBright: '#ffffff',
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

  const caption = opts.caption ?? `vue-tui demo · ${opts.cols}×${rows.length} cells`
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${opts.title ?? 'vue-tui demo'}</title>
<style>
  html,body{margin:0;background:#0f0f12}
  .frame{padding:18px 22px}
  pre{margin:0;white-space:pre;font:13px/1.35 "Cascadia Mono","Consolas","Noto Sans Mono CJK SC",monospace;color:#e6e6ea}
  .caption{font:12px/1.6 "Segoe UI",system-ui,sans-serif;color:#8b8b93;padding:10px 22px 16px}
</style></head>
<body><div class="frame"><pre>${body}</pre></div>
<div class="caption">${escapeHtml(caption)}</div>
</body></html>`
}
