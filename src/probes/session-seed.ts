/**
 * 探针：往会话目录里塞一条演示会话，用来手工验证 /sessions 与 --list-sessions 的输出。
 *
 *   VT_SESSION_DIR=$LOCALAPPDATA/Temp/vs-demo node src/probes/session-seed.ts
 */
import { saveSession, sessionDir } from '../core/session/index.ts'

const now = new Date().toISOString()
const path = saveSession({
  v: 1,
  id: '20260918-170000-seed',
  title: '演示会话（探针造的）',
  kind: 'mock',
  provider: { host: 'example.invalid', model: 'demo-model' },
  createdAt: now,
  updatedAt: now,
  turns: [
    {
      user: '演示一轮：这条会话是探针写进去的',
      thinking: ['不需要真跑模型，只是为了看列表与重放。'],
      tools: [{ name: 'read_file', arg: 'README.md', params: { path: 'README.md' }, status: 'ok', out: ['1| # Verse'] }],
      answer: ['用 /open 1 可以把这条会话的转写重放出来。'],
    },
  ],
})

console.log('已写入', path)
console.log('会话目录', sessionDir())
