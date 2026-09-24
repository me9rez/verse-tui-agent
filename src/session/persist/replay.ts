/**
 * 把磁盘上的会话重放回转写 store。
 *
 * 复用的是同一套 store API（session/sink 实时跑的也是这些），所以「实时看到的」
 * 与「重开看到的」是同一条渲染路径，不会出现两套排版逻辑慢慢漂移。
 *
 * 按「完整行」推送即可与逐字流式等价：store 的封行与围栏判定都发生在行粒度
 * （见 README 的坑：带副作用的状态判定只在 commit() 里做一次）。
 */
import type { TranscriptStore } from '../../transcript/index.ts'
import type { StoredSession } from './model.ts'

export function replaySession(session: StoredSession, store: TranscriptStore): void {
  store.clear()
  for (const turn of session.turns) {
    store.addUser(turn.user)

    if (turn.thinking.length) {
      const g = store.startThinkingGroup()
      const stream = store.stream('system', { group: g.id })
      for (const line of turn.thinking) stream.push(`${line}\n`)
      stream.end()
    }

    for (const tool of turn.tools) {
      const { group, head } = store.startToolGroup({ name: tool.name, arg: tool.arg, params: tool.params })
      if (tool.out.length) {
        store.groupSection(group.id, 'out')
        for (const line of tool.out) store.groupBody(group.id, line)
      }
      store.setToolStatus(head, tool.status === 'running' ? 'ok' : tool.status)
    }

    if (turn.answer.length) {
      store.blank()
      const stream = store.stream('assistant')
      for (const line of turn.answer) stream.push(`${line}\n`)
      stream.end()
    }
    if (turn.aborted) store.addNote('⎿ 已中断 · 本轮输出到此为止')
  }
  // 与实时路径的收尾对齐：回合结束（含中断）后分组全部收起（手风琴规则，见 session/sink.ts）
  store.soloExpand()
}
