/**
 * 一次性探针：验证 Alt+V 在合成按键注入下的交付形态（key / combo / altKey）。
 *
 * 背景：TUI 的 Alt+V 贴图挂在根节点 onKeydownCapture（捕获阶段，先于 TInput）。
 * 本探针用 events.dispatch 注入三种形态（'v'+altKey / 'V'+altKey / combo 'alt+v'），
 * 打印 onKey 收到的原始事件，确认分支判定用 `altKey && key∈{v,V}` 是否够用。
 * 结论（2026-09-26）：注入即达，TInput 不消费 alt 组合——分支够用，无需 combo 兜底。
 * 探针不是门禁，挂了不用当回事。
 */
import { createStdoutRenderer, createTerminalApp } from '@simon_he/vue-tui/cli'
import type { TerminalKeyboardEvent } from '@simon_he/vue-tui/runtime'
import { App, type AppApi } from '../ui/App.ts'
import { styles } from '../core/theme.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const holder: { api: AppApi | null } = { api: null }
const app = createTerminalApp({
  cols: 100,
  rows: 30,
  component: App,
  props: {
    sessionKind: 'mock',
    speed: 0,
    persist: false,
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

const seen: Array<Record<string, unknown>> = []

test()

async function test(): Promise<void> {
  await sleep(150)
  if (!holder.api) throw new Error('App 未就绪')
  const api: AppApi = holder.api
  // 守卫 note 会进转写：把屏幕打出来佐证 Alt+V 分支真的被路由到
  const before = api.screenText().join('\n')
  for (const ev of [
    { type: 'keydown', key: 'v', code: 'KeyV', combo: 'alt+v', altKey: true },
    { type: 'keydown', key: 'V', code: 'KeyV', combo: 'alt+V', altKey: true, shiftKey: true },
    { type: 'keydown', key: 'v', code: 'KeyV', combo: 'v' }, // 无 alt：应被 TInput 消费，不触发分支
  ] as unknown as never[]) {
    const delivered = app.events.dispatch(ev)
    await sleep(80)
    seen.push({ combo: (ev as { combo?: string }).combo, delivered })
  }
  const after = api.screenText().join('\n')
  console.log('--- dispatch 结果 ---')
  for (const s of seen) console.log(JSON.stringify(s))
  console.log('--- mock 守卫 note 出现次数:', (after.match(/mock 剧本，贴不了图/g) ?? []).length)
  console.log('--- 屏幕变化:', before !== after)
  out.dispose()
  app.dispose()
  process.exit(0)
}
