/**
 * theme/list · theme/set 的**真实链路**探针（一次性，需要后端在跑）。
 *
 *   pnpm backend            # 另一个终端
 *   node src/probes/rpctheme.ts
 *
 * 为什么单独跑一遍：pytest 覆盖的是 theme.py 的纯函数，这里验的是**协议往返**
 * （方法在 dispatch 真注册了、返回体形状与 docstring 一致、-32602 真的回错误码）。
 * 自定义主题目录那一面在 backend/tests/test_theme.py 用临时目录断言，不在这里碰用户的 <VERSE_HOME>。
 */
const url = process.argv[2] ?? 'ws://127.0.0.1:8765'

let nextId = 1
const pending = new Map<number, (msg: Record<string, unknown>) => void>()

const ws = new WebSocket(url)
const opened = new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve()
  ws.onerror = () => reject(new Error(`连不上 ${url}（先在另一个终端跑 pnpm backend）`))
})
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data)) as { id?: number }
  const waiter = msg.id !== undefined ? pending.get(msg.id) : undefined
  if (!waiter || msg.id === undefined) return
  pending.delete(msg.id)
  waiter(msg as unknown as Record<string, unknown>)
}

function call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }))
  })
}

let failed = 0
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label} — ${detail}`)
}

await opened
await call('initialize')

const list = (await call('theme/list')).result as {
  current: string
  requested: string
  base: string
  colors: Record<string, string>
  themes: Array<{ name: string; source: string }>
}
check('theme/list 有 current/base/colors/themes', !!list?.current && !!list?.base && !!list?.colors && Array.isArray(list?.themes), JSON.stringify(Object.keys(list ?? {})))
check('theme/list 的 colors 是完整的 19 个 token', Object.keys(list?.colors ?? {}).length === 19, `实际 ${Object.keys(list?.colors ?? {}).length} 项`)
check('内置 dark/light 恒在', ['dark', 'light'].every((n) => list.themes.some((t) => t.name === n)), list.themes.map((t) => `${t.name}(${t.source})`).join(' '))
console.log(`  current=${list.current} requested=${JSON.stringify(list.requested)} base=${list.base}`)
console.log(`  primary=${list.colors.primary} text=${list.colors.text} border=${list.colors.border}`)

const light = (await call('theme/set', { name: 'light' })).result as { name: string; base: string; colors: Record<string, string> }
check('theme/set light 生效并回 base', light?.name === 'light' && light?.base === 'light', `${light?.name}/${light?.base}`)
check('light 的 text 是深色', light?.colors?.text === '#1A1A1A', String(light?.colors?.text))

const back = (await call('theme/set', { name: 'dark' })).result as { name: string; base: string }
check('theme/set dark 切回', back?.name === 'dark' && back?.base === 'dark', `${back?.name}/${back?.base}`)

const bad = await call('theme/set', { name: 'no-such-theme' })
const err = bad.error as { code?: number; message?: string } | undefined
check('未知主题名回 -32602', err?.code === -32602, `code=${err?.code} message=${err?.message}`)

console.log(`\n${failed ? '✗' : '✓'} ${failed ? `${failed} 项失败` : '全部通过'}`)
ws.close()
process.exit(failed ? 1 : 0)
