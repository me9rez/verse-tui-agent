/**
 * 行级 markdown 的解析断言（纯逻辑，不需要 TUI 实例）。
 *
 *   node src/probes/mdline.ts
 *
 * 覆盖 2026-09-27 新增的三件事 + 既有行为的回归：
 *   · 嵌套列表按深度分档并**保留缩进**（此前前导空白被丢掉，所有 bullet 挤在同一列）
 *   · 任务项 `- [x]` / `- [ ]` → ☑ / ☐
 *   · 裸 URL 自动成链接（href 进库的链接命中区），句末标点不算进 URL
 *   · `~~删除线~~` → dim（终端画不出删除线，不假装画了）
 *   · snake_case 不被 `_斜体_` 规则误吃（这是我们刻意不支持的语法）
 *   · 标题 / 有序列表 / 引用 / 围栏代码的既有行为没被改坏
 */
import { createTranscriptStore, LineStream } from '../transcript/store.ts'
import { inlineSegments } from '../transcript/markdown.ts'
import { styles } from '../core/theme.ts'

let pass = 0
const fails: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++
    console.log(`  ✔ ${name}`)
  } else {
    fails.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 把一段 markdown 喂给 LineStream，取回封行后的行文本 */
function lines(src: string): string[] {
  const store = createTranscriptStore()
  const s = new LineStream(store, 'assistant')
  s.push(src)
  s.end()
  return store.entries.map((e) => (e.kind === 'line' ? e.text : `<tool ${e.title}>`))
}

console.log('== 嵌套列表：分档 + 保留缩进 ==')
const nest = lines('- a\n  - b\n    - c\n')
check('第 1 层 • 不缩进', nest[0] === '• a', JSON.stringify(nest[0]))
check('第 2 层 ◦ 缩进 2 空格', nest[1] === '  ◦ b', JSON.stringify(nest[1]))
check('第 3 层 ▪ 缩进 4 空格', nest[2] === '    ▪ c', JSON.stringify(nest[2]))

console.log('== 任务项 ==')
const tasks = lines('- [x] 已完成\n- [ ] 未完成\n- [X] 大写也算\n')
check('勾选 ☑', tasks[0] === '☑ 已完成', JSON.stringify(tasks[0]))
check('未勾选 ☐', tasks[1] === '☐ 未完成', JSON.stringify(tasks[1]))
check('大写 X 也认', tasks[2] === '☑ 大写也算', JSON.stringify(tasks[2]))

console.log('== 内联：裸 URL / 删除线 / snake_case ==')
const url = inlineSegments('见 https://example.dev/a?b=1。', styles.text, styles.code)
const link = url.find((s) => s.href)
check('裸 URL 拿到 href', link?.href === 'https://example.dev/a?b=1', JSON.stringify(url.map((s) => s.text)))
check('链接带下划线', link?.style?.underline === true)
check('句末标点不吞进 URL', url.some((s) => s.text === '。' && !s.href))
check('尾随英文句点也还回去',
  inlineSegments('见 https://example.dev/a.', styles.text, styles.code).some((s) => s.text === '.' && !s.href))

const del = inlineSegments('~~删掉~~', styles.text, styles.code)
check('删除线降级 dim（不假装画线）', del.length === 1 && del[0]?.text === '删掉' && del[0]?.style?.dim === true,
  JSON.stringify(del))

const snake = inlineSegments('cache_read_input_token_count', styles.text, styles.code)
check('snake_case 不被当强调', snake.length === 1 && snake[0]?.text === 'cache_read_input_token_count',
  JSON.stringify(snake))

console.log('== 回归：既有行为 ==')
const reg = lines('# 标题\n1. 第一\n> 引用\n普通一段\n')
check('标题去 #', reg[0] === '标题', JSON.stringify(reg[0]))
check('有序列表保留序号', reg[1] === '1. 第一', JSON.stringify(reg[1]))
check('引用去 >', reg[2] === '引用', JSON.stringify(reg[2]))
check('普通段落原样', reg[3] === '普通一段', JSON.stringify(reg[3]))

const fence = lines('```ts\nconst a = 1\n```\n')
check('围栏内是 code 行（缩进 2 空格）', fence.length === 1 && fence[0] === '  const a = 1', JSON.stringify(fence))

console.log(`\nmdline: ${pass}/${pass + fails.length} 通过`)
if (fails.length) {
  console.log('失败项：')
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('✔ 行级 markdown 行为符合预期')
