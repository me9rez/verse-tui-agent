/**
 * 行级 markdown 与工具参数格式化。
 *
 * 为什么是「行级」：vue-tui 的 transcript 行是段落式排版，段内换行不断行，
 * 所以 markdown 的解析发生在「一行」的粒度上（围栏状态由 LineStream 跨行维护）。
 * 这两个函数都是纯函数，不碰 store。
 */
import type { Style } from '@simon_he/vue-tui/core'
import type { TTranscriptSegment } from '@simon_he/vue-tui/agent'
import { styles } from '../core/theme.ts'
import type { Preset, Role } from './types.ts'

export function inlineSegments(text: string, base: Style, codeStyle: Style): TTranscriptSegment[] {
  const out: TTranscriptSegment[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), style: base })
    const token = m[0]!
    if (token.startsWith('`')) {
      out.push({ text: token.slice(1, -1), style: codeStyle })
    } else if (token.startsWith('**')) {
      out.push({ text: token.slice(2, -2), style: { ...base, bold: true } })
    } else if (token.startsWith('[')) {
      const close = token.indexOf('](')
      out.push({ text: token.slice(1, close), style: base, href: token.slice(close + 2, -1) })
    } else {
      out.push({ text: token.slice(1, -1), style: { ...base, italic: true } })
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last), style: base })
  if (!out.length) out.push({ text: '', style: base })
  return out
}

export function presetBase(preset: Preset, role: Role): Style {
  if (preset === 'code') return styles.code
  if (preset === 'heading') return styles.heading
  if (preset === 'bullet') return styles.text
  if (preset === 'quote') return styles.quote
  if (preset === 'dim' || preset === 'note') return styles.dim
  if (role === 'user') return styles.user
  if (role === 'assistant') return styles.text
  if (role === 'tool') return styles.toolOut
  return styles.dim
}

/**
 * 工具参数 → 组内「值行」（不含 section 标题；由 appendGroupBlock 统一加缩进）。
 * 全空就返回空数组——没参数的调用不该硬打一个空块出来。
 */
export function formatParams(params: Record<string, unknown> | undefined, limit = 8): string[] {
  if (!params) return []
  const out: string[] = []
  let shown = 0
  for (const [key, value] of Object.entries(params)) {
    if (shown >= limit) {
      out.push('…（参数过多，其余略）')
      break
    }
    if (value === undefined || value === null) continue
    let text: string
    if (typeof value === 'string') {
      if (!value) continue
      text = value.length > 80 ? `(${value.length} 字符，已省略)` : value.replace(/\s+/g, ' ').trim()
    } else {
      text = JSON.stringify(value)
    }
    if (text.length > 120) text = `${text.slice(0, 117)}…`
    out.push(`${key}: ${text}`)
    shown++
  }
  return out
}

/**
 * 一次流式输出 = 一个 LineStream：内部维护「当前行」，遇到换行就封行开新行。
 * 给 group 时，产出的行都挂在那个分组下（折叠时会被整体隐藏）。
 */
