/**
 * 键盘域：全局按键表。挂在 TView 的 onKeydownCapture（捕获阶段，先于 TInput），
 * 组合键不会被输入框当作可打印字符消费。
 *
 * 覆盖面与优先级（与原实现逐字一致）：
 *   Alt+V 贴图 / Alt+M 切下一个模型 / Alt+E 切下一档思考强度 → Esc 中断 → Shift+Tab 切 harness 模式
 *   → Ctrl+End 贴底 → Ctrl+O 全折叠 → Ctrl+T 折叠最近一组 → Ctrl+C 退出
 */
import type { TerminalKeyboardEvent } from '@simon_he/vue-tui/runtime'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { EffortControl } from './useEffortControl.ts'
import type { HarnessMode } from './useHarnessMode.ts'
import type { ImageAttachment } from './useImageAttachment.ts'
import type { ModelControl } from './useModelControl.ts'
import type { TurnUi } from './useTurnRuntime.ts'

export type KeyboardDeps = Readonly<{
  store: TranscriptStore
  ui: TurnUi
  model: ModelControl
  effort: EffortControl
  harness: HarnessMode
  image: ImageAttachment
  invalidate(): void
  /** Ctrl+End：把转写贴到底（TTranscriptView 的 scrollToBottom） */
  scrollToBottom(): void
  onExit?(): void
}>

export function useKeyboardControls(deps: KeyboardDeps): (event: TerminalKeyboardEvent) => void {
  const { store, ui, model, effort, harness, image, invalidate } = deps

  return function onKey(event: TerminalKeyboardEvent): void {
    // Alt+V 贴图：挂在根节点 onKeydownCapture（捕获阶段，先于 TInput），
    // 组合键不会被输入框当作可打印字符消费
    if (event.altKey && (event.key === 'v' || event.key === 'V')) {
      event.preventDefault()
      void image.paste()
      return
    }
    // Alt+M 切下一个模型 / Alt+E 切下一档思考强度：顺序循环直切，不弹窗
    //（弹窗走 /model、/effort 无参；守卫与文案在 cycle* 内）
    if (event.altKey && (event.key === 'm' || event.key === 'M')) {
      event.preventDefault()
      void model.cycle()
      return
    }
    if (event.altKey && (event.key === 'e' || event.key === 'E')) {
      event.preventDefault()
      void effort.cycle()
      return
    }
    if (event.key === 'Escape' && ui.streaming) {
      event.preventDefault()
      ui.aborted = true
      return
    }
    // Shift+Tab：切 harness 的 plan/execute 模式（终端把 \x1b[Z 报成 BackTab；
    // 合成事件可能给 Tab+shiftKey，两种都接）。放在输入框 Tab(采用补全)之前没冲突：
    // 补全弹窗打开时 Tab 带 shift 同样视为切模式。
    if (
      event.key === 'BackTab' ||
      event.key === 'ISO_Left_Tab' ||
      ((event.key === 'Tab' || event.key === '\t') && event.shiftKey)
    ) {
      event.preventDefault()
      void harness.toggle()
      return
    }
    if (event.key === 'End' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      deps.scrollToBottom()
      return
    }
    if (event.ctrlKey && !event.shiftKey && (event.key === 'o' || event.key === 'O')) {
      event.preventDefault()
      store.toggleAllGroups()
      invalidate()
      return
    }
    if (event.ctrlKey && !event.shiftKey && (event.key === 't' || event.key === 'T')) {
      event.preventDefault()
      store.toggleLastGroup()
      invalidate()
      return
    }
    if (event.ctrlKey && !event.shiftKey && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault()
      deps.onExit?.()
    }
  }
}
