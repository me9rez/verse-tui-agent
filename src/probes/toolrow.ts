/**
 * 探针：vue-tui 的 tool-call row 到底能不能承载「多行 body」并折叠？
 * 两种写法各渲染一次，直接把终端 buffer 打出来看。
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import { TTranscriptView } from '@simon_he/vue-tui/agent'
import { defineComponent, h } from 'vue'
import type { TTranscriptDataSource, TTranscriptRow } from '@simon_he/vue-tui/agent'

const COLS = 60
const ROWS = 14

const bodyText = ['params', '  command: dir /b *.txt', 'out', '  a.txt', '  b.txt'].join('\n')

function makeSource(collapsed: boolean): TTranscriptDataSource {
  const rows: TTranscriptRow[] = [
    { kind: 'message', key: 'probe-title', role: 'system', segments: [{ text: `--- collapsed=${collapsed} ---` }] },
    {
      kind: 'tool-call',
      key: 'tool-1',
      title: '● bash  dir /b *.txt',
      collapsed,
      summary: [{ text: '  params: command=dir /b *.txt\n', style: { fg: '#8b8b93' } }],
      body: [{ text: bodyText, style: { fg: '#c9d1f2', bg: '#22242c' } }],
    },
    { kind: 'message', key: 'after', role: 'assistant', segments: [{ text: '（工具后的正文）' }] },
  ]
  return {
    rowCount: () => rows.length,
    getRow: (i: number) => rows[i]!,
    getRowKey: (i: number) => rows[i]!.key,
    getRowVersion: () => 1,
  }
}

async function dump(collapsed: boolean): Promise<void> {
  const App = defineComponent({
    setup: () =>
      () =>
        h(TTranscriptView as never, {
          x: 0,
          y: 0,
          w: COLS,
          h: ROWS,
          source: makeSource(collapsed),
          version: 1,
          autoStickToBottom: true,
          wrap: true,
        } as never),
  })
  const app = createTerminalApp({ cols: COLS, rows: ROWS, component: App })
  app.mount()
  const out = createStdoutRenderer(app.terminal, {
    output: { write: () => {}, isTTY: false },
    clear: false,
    hideCursor: false,
    altScreen: false,
    trackResize: false,
  })
  void out
  await new Promise((r) => setTimeout(r, 120))
  const lines: string[] = []
  for (let y = 0; y < ROWS; y++) {
    lines.push(
      app.terminal
        .getRow(y)
        .map((c: { ch?: string }) => c.ch ?? ' ')
        .join('')
        .trimEnd(),
    )
  }
  console.log(`\n===== collapsed=${collapsed} =====`)
  console.log(lines.filter((l) => l.length).join('\n') || '(空)')
  out.dispose()
  app.dispose()
}

await dump(false)
await dump(true)
