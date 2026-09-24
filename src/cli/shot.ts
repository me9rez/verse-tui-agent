/**
 * 出图快照：把 demo 跑完后的终端 buffer 转成带颜色的 HTML，供截图/归档。
 *
 *   node src/cli/shot.ts                   # 默认 110x32，mock 剧本
 *   VT_SHOT_ROWS=64 node src/cli/shot.ts   # 更高视口，一轮内容全装下
 *   VT_SHOT_PROMPT=/long node src/cli/shot.ts
 *
 * 产物：.artifacts/demo.html + .artifacts/demo-screen.txt
 * 截图：chrome --headless=new --screenshot=demo.png file://.../demo.html
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { App, type AppApi } from '../ui/App.ts'
import { HEADER_LABEL } from '../core/brand.ts'
import { styles } from '../core/theme.ts'
import { rowsToHtml, type CellLike } from '../core/html.ts'
import { loadDotEnv } from '../core/env.ts'

// .env / .env.local 先于业务逻辑加载（真实环境变量优先，文件不覆盖已存在的键）
loadDotEnv()


const COLS = Number(process.env.VT_SHOT_COLS ?? 110)
const ROWS = Number(process.env.VT_SHOT_ROWS ?? 32)
// 多轮：用 ;; 分隔（例：'这个 demo 怎么做的？;;/fold'），每轮等跑完再发下一轮
const PROMPTS = (process.env.VT_SHOT_PROMPT ?? '这个 demo 的流式输出是怎么实现的？')
  .split(';;')
  .map((p) => p.trim())
  .filter(Boolean)
const speed = Number(process.env.VT_SPEED ?? '0.05') || 0.05
// 中途快照：等某个工具组展开（= 一轮正跑到工具阶段）就立刻出图，不等整轮结束。
// 用来拍「流式中只有当前组是展开的」这个状态。
const midTool = process.env.VT_SHOT_MIDTOOL === '1'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** onReady 在回调里赋值：用容器读取，避免 TS 把变量收窄成 null。 */
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: COLS,
  rows: ROWS,
  component: App,
  props: {
    sessionKind: 'mock',
    speed,
    onReady(next: AppApi) {
      holder.api = next
    },
  },
  defaultStyle: styles.text,
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
for (const prompt of PROMPTS) {
  api.submit(prompt)
  // submit 只是启动一轮（异步），先等它真的开跑，再等它跑完——否则立刻查 streaming 会是 false。
  const deadline = Date.now() + 30_000
  while (!api.state().streaming && Date.now() < deadline) await sleep(5)
  if (midTool) {
    // 等到「有工具组正展开」的那一帧就停手：那一刻正是「当前组展开、前面的已收起」。
    // 配合 VT_SPEED 放慢节奏，抓到的就是一个稳定的流式中状态。
    while (Date.now() < deadline) {
      if (api.groups().some((g) => g.kind === 'tool' && !g.collapsed)) break
      await sleep(10)
    }
  } else {
    while (api.state().streaming && Date.now() < deadline) await sleep(20)
    await api.whenIdle()
  }
  await sleep(60)
}

const rows: CellLike[][] = []
for (let y = 0; y < ROWS; y++) rows.push(app.terminal.getRow(y) as unknown as CellLike[])

// 调试用：把首个非空格子的结构打出来，便于对齐不同版本的字段名。
const probe = rows.flat().find((c) => c?.ch && c.ch.trim())
console.log('cell 结构示例:', JSON.stringify(probe))

mkdirSync('.artifacts', { recursive: true })
const caption = `${HEADER_LABEL} · ${COLS}×${ROWS} cells · 流式输出完成后的终端 buffer（行数/颜色取自 core buffer，非模拟）`
writeFileSync('.artifacts/demo.html', rowsToHtml(rows, { cols: COLS, caption }), 'utf8')
writeFileSync(
  '.artifacts/demo-screen.txt',
  `${rows.map((r) => r.map((c) => c?.ch ?? ' ').join('').replace(/ +$/, '')).join('\n')}\n`,
  'utf8',
)
console.log(`写出 .artifacts/demo.html 与 .artifacts/demo-screen.txt（${api.store.rowCount()} 行转写，约 ${api.state().tokens} tok）`)
out.dispose()
app.dispose()
