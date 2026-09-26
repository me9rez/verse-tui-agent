/**
 * 输入域：输入框内容与实例 key、提交时的清洗与分流。
 *
 * 分流规则（与原实现逐字一致）：
 *   - 先去掉控制字符（终端注入的键序列可能带 bracketed-paste / 残余 CR 标记）
 *   - `--debug-input` 时把原始文本按 JSON 记进 .artifacts/input-debug.log（排查输入层问题）
 *   - '/' 开头交给命令路由；其余走一轮对话，并带上待发图片（命令不携带图片）
 */
import { appendFileSync } from 'node:fs'
import { ref, type Ref } from 'vue'
import { NL, stripControlChars } from '../texts.ts'
import type { ImageAttachment } from './useImageAttachment.ts'
import type { TurnRuntime } from './useTurnRuntime.ts'
import type { SlashRouter } from './useSlashCommands.ts'

export type Composer = Readonly<{
  input: Ref<string>
  /** 每次提交后自增，用来换掉输入框实例（清空它的内部文本） */
  composerKey: Ref<number>
  submit(raw: string): void
}>

export function useComposer(deps: {
  turn: TurnRuntime
  image: ImageAttachment
  commands: SlashRouter
  debugInput: boolean
}): Composer {
  const { turn, image, commands, debugInput } = deps

  const input = ref('')
  const composerKey = ref(0)

  function submit(raw: string): void {
    const cleaned = stripControlChars(raw)
    if (debugInput) {
      // 排查输入层问题时用：把原始文本按 JSON 记下来（含不可见字符）
      try {
        appendFileSync('.artifacts/input-debug.log', JSON.stringify({ raw, cleaned }) + NL, 'utf8')
      } catch {
        /* 调试用，失败无所谓 */
      }
    }
    const text = cleaned.trim()
    if (!text) return
    if (text.startsWith('/')) {
      // 命令路由自己负责收尾重绘（/long 例外：它起一轮，由轮次域重绘）
      commands.tryHandle(raw, text)
      return
    }
    // 待发图片只跟普通消息走：`/` 命令不携带；消息发出即清空指示条（take 里一并清）
    void turn.runTurn(text, image.take())
  }

  return { input, composerKey, submit }
}
