/**
 * 无头会话持久化检查：不碰真实终端、不碰真端点，只在临时目录里读写。
 *
 *   node src/checks/session-check.ts
 *
 * 用 VT_SESSION_DIR 把会话目录指到临时目录——绝不污染仓库自己的 .verse-sessions/。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTranscriptStore } from '../core/transcript/index.ts'
import {
  SESSION_SCHEMA_V,
  asStoredSession,
  createTurnRecorder,
  deleteSession,
  listSessions,
  loadSession,
  newSessionId,
  replaySession,
  saveSession,
  titleFromPrompt,
  type StoredSession,
} from '../core/session/index.ts'

// ── 断言小工具（与 smoke.ts 同样的形状：名字 + 事实 + 细节）─────────────────
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

// ── 每组断言写成一个函数，最后统一跑 ──────────────────────────────────────
const groups: Array<[string, () => Promise<void> | void]> = []

function section(title: string, fn: () => Promise<void> | void): void {
  groups.push([title, fn])
}

// 独立的临时会话目录 + 造一个合法会话的工厂
const NL = String.fromCharCode(10)
const dir = mkdtempSync(join(tmpdir(), 'verse-sessions-'))
process.env.VT_SESSION_DIR = dir

function makeSession(id: string, over: Partial<StoredSession> = {}): StoredSession {
  const now = new Date().toISOString()
  return {
    v: SESSION_SCHEMA_V,
    id,
    title: `会话 ${id}`,
    kind: 'mock',
    createdAt: now,
    updatedAt: now,
    turns: [],
    ...over,
  }
}

// ── 第 1 组：模型层 ───────────────────────────────────────────────────────
section('模型层', () => {
  const id1 = newSessionId(new Date(2026, 8, 18, 16, 57, 38))
  const id2 = newSessionId(new Date(2026, 8, 18, 16, 57, 38))
  check('会话 id 形状可读且唯一', /^\d{8}-\d{6}-[a-z0-9]{4}$/.test(id1) && id1 !== id2, `${id1} / ${id2}`)

  const long = 'x'.repeat(80)
  check(
    '标题压平空白并截断到 40 字',
    titleFromPrompt('  第一行\n第二行\t  第三行 ') === '第一行 第二行 第三行' &&
      titleFromPrompt(long).length === 40 &&
      titleFromPrompt(long).endsWith('…'),
    `${titleFromPrompt('  第一行\n第二行\t  第三行 ')} | ${titleFromPrompt(long).length} 字`,
  )
  check('空输入有兜底标题', titleFromPrompt('   ') === '(空会话)', titleFromPrompt('   '))

  check(
    '坏数据被校验挡掉（版本 / kind / turns）',
    asStoredSession(null) === null &&
      asStoredSession({ ...makeSession('a'), v: 99 }) === null &&
      asStoredSession({ ...makeSession('a'), kind: 'nope' }) === null &&
      asStoredSession({ ...makeSession('a'), turns: 'x' }) === null,
    '四种坏输入都返回 null',
  )
  check('合法数据能穿过校验', asStoredSession(makeSession('ok'))?.id === 'ok', 'id 原样保留')
})

// ── 第 2 组：读写 ─────────────────────────────────────────────────────────
section('读写', () => {
  const one = makeSession('20260918-120000-aaaa', {
    title: '第一轮',
    turns: [
      {
        user: 'q1',
        thinking: ['想一下'],
        tools: [
          { name: 'read_file', arg: 'a.ts', params: { path: 'a.ts', offset: 1 }, status: 'ok', out: ['1| const a = 1'] },
        ],
        answer: ['答案一'],
      },
    ],
  })
  const saved = saveSession(one)
  check('落盘路径在会话目录内', saved.startsWith(dir) && saved.endsWith('20260918-120000-aaaa.json'), saved)
  check('目录里没有 .tmp 残留（原子写）', !readdirSync(dir).some((f) => f.endsWith('.tmp')), readdirSync(dir).join(' '))

  const back = loadSession('20260918-120000-aaaa')
  check(
    '读回来与写进去一致（含嵌套 params 与工具输出）',
    JSON.stringify(back) === JSON.stringify(one),
    back ? `turns=${back.turns.length} tools=${back.turns[0]?.tools.length}` : '读回 null',
  )

  // 再写一个更新的会话 + 一个坏文件，验证排序与容错
  saveSession(makeSession('20260918-130000-bbbb', { title: '第二轮', updatedAt: '2099-01-01T00:00:00.000Z' }))
  writeFileSync(join(dir, '20260918-140000-cccc.json'), '{ 这不是 JSON', 'utf8')
  const all = listSessions()
  check(
    '列表按 updatedAt 倒序且跳过坏文件',
    all.length === 2 && all[0]?.id === '20260918-130000-bbbb' && all.every((s) => s.id !== '20260918-140000-cccc'),
    all.map((s) => s.id).join(' '),
  )
  check('坏文件读出来是 null 而不是抛错', loadSession('20260918-140000-cccc') === null, 'loadSession 返回 null')

  check(
    '删除返回 true 并真的删掉',
    deleteSession('20260918-120000-aaaa') && !existsSync(join(dir, '20260918-120000-aaaa.json')),
    '文件已消失',
  )
  check('重复删除返回 false', deleteSession('20260918-120000-aaaa') === false, '第二次 false')
})

// ── 第 3 组：重放 ─────────────────────────────────────────────────────────
section('重放', () => {
  const turns = [
    {
      user: '这个 demo 的流式输出是怎么实现的？',
      thinking: ['先看 LineStream 的 push。', '再看 store 怎么过滤可见行。'],
      tools: [
        {
          name: 'read_file',
          arg: 'src/core/transcript/store.ts',
          params: { path: 'src/core/transcript/store.ts', offset: 96 },
          status: 'ok' as const,
          out: ['102|       this.commit(line)', '103|     }'],
        },
        {
          name: 'bash',
          arg: 'node -e "统计行数"',
          params: { command: 'node -e "…"' },
          status: 'ok' as const,
          out: ['96  src/agent/rpcSession.ts'],
        },
      ],
      answer: [
        '关键就三步：',
        '1. 会话层产出增量，按 2~3 字符一块吐。',
        '```ts',
        'push(delta: string) {',
        '  this.pending += delta',
        '}',
        '```',
      ],
    },
    { user: '那折叠呢？', thinking: ['手风琴规则在 turn-sink。'], tools: [], answer: ['一轮里只有当前组展开。'], aborted: true },
  ]
  const session = makeSession('20260918-150000-dddd', { turns })

  const store = createTranscriptStore()
  replaySession(session, store)
  // 内容断言看**全量** entries：重放收尾会把分组全部收起（与实时路径一致），
  // 折叠组里的思考/工具输出在 visibleEntries() 里本来就不该出现（那是另一条断言）。
  const text = store.entries.map((e) => (e.kind === 'line' ? e.text : e.title)).join(NL)

  check(
    '重放出两条用户消息',
    store.entries.filter((e) => e.kind === 'line' && e.role === 'user').length === 2,
    '2 条',
  )
  check(
    '正文与思考都回来了',
    text.includes('关键就三步') && text.includes('先看 LineStream 的 push'),
    '含正文首句与思考首句',
  )
  check('代码块仍被判为 code（围栏重放正确）', store.visibleEntries().some((e) => e.kind === 'line' && e.preset === 'code'), '存在 preset=code 的行')
  check('工具输出与参数都回来了', text.includes('this.commit(line)') && text.includes('params'), '含工具输出与 params 段')
  check('中断的那轮带上了提示行', text.includes('已中断'), '含「已中断」')
  check(
    '重放后分组全部收起（与实时路径的收尾一致）',
    store.groupSummary().length > 0 && store.groupSummary().every((g) => g.collapsed),
    `组数 ${store.groupSummary().length}，收起 ${store.groupSummary().filter((g) => g.collapsed).length}`,
  )
})

// ── 第 4 组：记录器（T8 追加）─────────────────────────────────────────────

// ── 第 4 组：记录器 ───────────────────────────────────────────────────────
section('记录器', () => {
  const rec = createTurnRecorder()
  rec.begin('  第一问  ')
  // 思考按 delta 喂进来：跨行要自己拆行（与 LineStream 同样的判据）
  rec.thinkingDelta('先看')
  rec.thinkingDelta('代码。\n再看排版。\n半行没收尾')
  rec.thinkingEnd()
  rec.toolStart({ name: 'read_file', arg: 'a.ts', id: 't1', params: { path: 'a.ts' } })
  rec.toolLine({ name: 'read_file', arg: 'a.ts', id: 't1' }, '1| const a = 1')
  rec.toolEnd({ name: 'read_file', arg: 'a.ts', id: 't1' }, 'ok')
  rec.answerDelta('答案第一行\n答案第二行\n尾部半行')
  const turn = rec.finish(false)

  check('用户输入被压平空白', turn.user === '第一问', JSON.stringify(turn.user))
  check(
    '思考按行切分，未收尾的半行也保留',
    JSON.stringify(turn.thinking) === JSON.stringify(['先看代码。', '再看排版。', '半行没收尾']),
    JSON.stringify(turn.thinking),
  )
  check('工具事件与状态被记录', turn.tools.length === 1 && turn.tools[0]?.status === 'ok', JSON.stringify(turn.tools[0]))
  check(
    '工具输出与 params 分开存',
    turn.tools[0]?.out.length === 1 && turn.tools[0]?.params?.path === 'a.ts',
    `out=${turn.tools[0]?.out.length} params=${JSON.stringify(turn.tools[0]?.params)}`,
  )
  check(
    '正文按行切分',
    JSON.stringify(turn.answer) === JSON.stringify(['答案第一行', '答案第二行', '尾部半行']),
    JSON.stringify(turn.answer),
  )
  check('finish 后记录器可复用（不串上一轮）', rec.finish(false).answer.length === 0, '第二次为空轮')
})

// ── 跑 ────────────────────────────────────────────────────────────────────
for (const [title, fn] of groups) {
  await fn()
  console.log(`· ${title}`)
}

const failures = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`)
rmSync(dir, { recursive: true, force: true })
console.log(`\n会话检查：${checks.length - failures.length}/${checks.length} 通过`)
process.exit(failures.length ? 1 : 0)
