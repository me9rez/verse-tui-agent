/**
 * 三主题并列出图：**同一个 buffer** 在 dark / light / ember 三套 palette 下的真实渲染。
 *
 *   node src/probes/themeshot.ts
 *   → .artifacts/themes-compare.html
 *
 * 与 `cli/shot.ts` 同源：都是「先跑真 buffer，再交给 core/html.ts 转 HTML」。换主题后必须
 * bump + 等重绘再取行 —— 行样式是**渲染时**求值的（transcript/rows.ts），所以 buffer 里的
 * fg 会跟着 palette 变，这正是能在一个进程里出三张图的原因。
 *
 * 每栏各自调用一次 rowsToHtml（在各自主题生效的那一瞬），因此**每份 HTML 的底色、正文色
 * 都取自它自己的主题**；外层用 iframe 并排，避免手写第二套渲染（那会让出图与终端漂移）。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { applyTheme, DEFAULT_THEME, LIGHT_THEME, palette, rendererDefaultStyle, styles, THEME_TOKENS } from '../core/theme.ts'
import { rowsToHtml, type CellLike } from '../core/html.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const COLS = 112
const ROWS = 34
const PROMPT = '这个 demo 的流式输出是怎么实现的？'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** ember 用仓库里的示例文件 —— 顺带证明「自定义主题 JSON → 渲染」这条路是通的。 */
function readCustomTheme(path: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { colors?: Record<string, string> }
  const colors: Record<string, string> = {}
  for (const token of THEME_TOKENS) {
    const value = raw.colors?.[token]
    if (typeof value === 'string') colors[token] = value
  }
  return colors
}

const THEMES: Array<{ label: string; note: string; base: string; colors: Record<string, string> }> = [
  {
    label: 'dark',
    note: '内置默认 · Kimi Code dark',
    base: 'dark',
    colors: { ...DEFAULT_THEME },
  },
  {
    label: 'light',
    note: '内置 · Kimi Code light',
    base: 'light',
    colors: { ...LIGHT_THEME },
  },
  {
    label: 'ember',
    note: '自定义 · docs/theme.example.json',
    base: 'dark',
    colors: readCustomTheme(join(root, 'docs', 'theme.example.json')),
  },
]

const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'mock',
    speed: 0.05,
    onReady(next: AppApi) {
      holder.api = next
    },
  },
  defaultStyle: rendererDefaultStyle,
})
app.mount()
const out = createStdoutRenderer(app.terminal, {
  output: { write: () => {}, isTTY: false },
  clear: false,
  hideCursor: false,
  altScreen: false,
  trackResize: false,
  defaultBg: null,
})
void out

await sleep(60)
if (!holder.api) {
  console.error('App 未就绪')
  process.exit(1)
}
const api: AppApi = holder.api

// 先跑一轮，让 buffer 里有真内容（mock 剧本，离线）
api.submit(PROMPT)
const deadline = Date.now() + 30_000
while (!api.state().streaming && Date.now() < deadline) await sleep(5)
while (api.state().streaming && Date.now() < deadline) await sleep(20)
await api.whenIdle()
await sleep(80)

const panes: Array<{ label: string; note: string; uri: string; bg: string; fg: string; primary: string }> = []
const problems: string[] = []

/**
 * 库自绘元素的「启动快照色」。`createTerminalApp({ defaultStyle })` 会被库**拷一份**（实测：
 * 传可变对象、换主题时就地改字段，库不跟），于是库自己画的那些内容 —— transcript 行的折叠标记
 * `▸`/`▾`、行尾空白填充 —— 永远停在启动时那套颜色。这是库的限制，不是数据源的错，所以把它
 * 单列允许；**其他**任何非本主题颜色仍然是跨主题残留，必须为零。
 */
const BOOT_SNAPSHOT = DEFAULT_THEME.text.toUpperCase()

/**
 * 该主题允许出现的颜色（palette 的全部值）。**这条断言是必需的**：库靠 `getRowVersion` 决定
 * 要不要重取行，换主题不改行内容 —— 一旦忘了让所有行失效，只有部分行会变色，肉眼容易忽略，
 * 但「上一套主题的颜色出现在这一栏」是可判定的（2026-09-27 就是这样抓到的）。
 */
function strayColors(rows: CellLike[][]): string[] {
  const allowed = new Set(Object.values(palette).map((v) => String(v).toUpperCase()))
  const seen = new Set<string>()
  for (const row of rows) {
    for (const cell of row) {
      // 只查**有字形**的格子：空白格的 fg 不可见（终端不画空格的前景）
      if (!cell?.ch || !cell.ch.trim()) continue
      const style = cell.style as Record<string, unknown> | undefined
      for (const key of ['fg', 'bg'] as const) {
        const value = style?.[key]
        if (typeof value === 'string' && value.startsWith('#')) seen.add(value.toUpperCase())
      }
    }
  }
  return [...seen].filter((c) => !allowed.has(c) && c !== BOOT_SNAPSHOT)
}

for (const theme of THEMES) {
  applyTheme(theme.colors, theme.base)
  api.store.repaintAll() // 换色必须让所有行失效：只 bump 的话库会认为行没变（见 store.themeEpoch）
  await sleep(180)
  const rows: CellLike[][] = []
  for (let y = 0; y < ROWS; y++) rows.push(app.terminal.getRow(y) as unknown as CellLike[])
  const stray = strayColors(rows)
  if (stray.length) problems.push(`${theme.label}: 混入了非本主题颜色 ${stray.join(' ')}`)
  const html = rowsToHtml(rows, {
    cols: COLS,
    caption: `${theme.label} · ${theme.note} · ${COLS}×${ROWS} cells（行内容三栏完全一致，只有 palette 不同）`,
    title: `theme-${theme.label}`,
  })
  panes.push({
    label: theme.label,
    note: theme.note,
    uri: `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`,
    bg: palette.background,
    fg: palette.foreground,
    primary: palette.accent,
  })
  console.log(
    `${theme.label}: bg=${palette.background} fg=${palette.text} primary=${palette.accent}` +
      (stray.length ? `  ✗ 越界色 ${stray.length} 种` : '  ✓ 用色全部来自本主题'),
  )
}

const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>Verse TUI · 三主题并列</title>
<style>
  html,body{margin:0;background:#0b0b0d;color:#c9c9d0;font:13px/1.5 "Segoe UI",system-ui,sans-serif}
  .wrap{padding:16px 18px 22px}
  h1{font-size:15px;font-weight:600;margin:0 0 6px;color:#e8e8ee}
  .sub{color:#8a8a95;font-size:12px;margin:0 0 14px;max-width:1100px}
  .sub code{color:#b9b9c4}
  /* 三栏并排 ≈ 336 列：整块缩一次，让大多数屏幕一眼看全（zoom 会正确重排布局，比 transform 稳） */
  .row{display:flex;gap:14px;align-items:flex-start;overflow-x:auto;padding-bottom:14px;zoom:0.62}
  .pane{flex:0 0 auto;border:1px solid #2a2a32;background:#111116}
  .pane h2{font:12px/1 ui-monospace,Consolas,monospace;font-weight:400;margin:0;padding:9px 11px;
           background:#16161c;border-bottom:1px solid #2a2a32;color:#c9c9d0}
  .pane h2 b{color:#ffffff;font-weight:600}
  .pane h2 span{color:#7f7f8a}
  .swatch{display:inline-block;width:9px;height:9px;margin-left:8px;vertical-align:-1px;border:1px solid #2a2a32}
  iframe{border:0;display:block;width:${COLS}ch;height:${Math.round(ROWS * 17.6) + 6}px;background:transparent}
</style></head>
<body><div class="wrap">
<h1>Verse TUI · 同一个 buffer，三套主题</h1>
<p class="sub">三栏的行内容<b>完全一致</b>（同一进程、同一轮 mock 剧本跑完的 ${ROWS} 行 buffer），
只有 palette 不同 —— 颜色是渲染时从 palette 取的，所以换主题 + 重绘就换了色。
<code>dark</code> / <code>light</code> 是内置基准（值取自 Kimi Code 文档），
<code>ember</code> 是 <code>docs/theme.example.json</code> 这份自定义主题文件解析出来的。</p>
<div class="row">
${panes
  .map(
    (p) => `  <div class="pane">
    <h2><b>${p.label}</b> <span>${p.note}</span>
      <i class="swatch" style="background:${p.bg}"></i><i class="swatch" style="background:${p.fg}"></i><i class="swatch" style="background:${p.primary}"></i>
    </h2>
    <iframe src="${p.uri}" sandbox="" title="${p.label}"></iframe>
  </div>`,
  )
  .join('\n')}
</div>
</div></body></html>`

mkdirSync('.artifacts', { recursive: true })
writeFileSync('.artifacts/themes-compare.html', PAGE, 'utf8')
console.log(`\n写出 .artifacts/themes-compare.html（${panes.length} 主题 × ${COLS}×${ROWS} cells）`)
out.dispose()
app.dispose()
if (problems.length) {
  console.error(`\n✗ 主题隔离被破坏：\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('✓ 三栏各自的用色全部来自本主题（无跨主题残留）')
