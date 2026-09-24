/**
 * entry → TTranscriptRow：视图只认 row，这一层把「普通行」和「分组头部」拼成 segments。
 * 缩进与折叠标记都在这里决定（库不给默认缩进，实测三种 role 都是 0）。
 */
import type { TTranscriptRow, TTranscriptSegment } from '@simon_he/vue-tui/agent'
import { styles, toolHeaderStyle } from '../core/theme.ts'
import { inlineSegments, presetBase } from './markdown.ts'
import { highlightLine, paramParts } from '../core/syntax.ts'
import type { Group, LineEntry, ToolEntry } from './types.ts'

export function toLineRow(entry: LineEntry, group: Group | undefined): TTranscriptRow {
  const base = presetBase(entry.preset, entry.role)
  const segments: TTranscriptSegment[] = []
  if (entry.head && group) {
    // 分组头部：自己画折叠标记（库的段落式排版塞不下多行 body，所以显隐由数据源过滤）。
    // 工具组按工具类型上色，思考组用暗色斜体——扫一眼就能分辨这一行是什么。
    const headStyle = group.kind === 'tool' ? toolHeaderStyle(entry.text) : styles.thinkingHeader
    segments.push({ text: `${group.collapsed ? '▸' : '▾'} ${entry.text}`, style: headStyle })
    if (group.lines > 0) {
      segments.push({
        text: group.collapsed ? `  · ${group.lines} 行已折叠` : `  · ${group.lines} 行`,
        style: styles.faint,
      })
    }
    return { kind: 'message', key: entry.key, role: 'system', segments, selectableText: entry.text }
  }
  // 缩进层级：分组头部 0 → 组内正文 2（正文里的 section 值再由 store 自己 +2）→ 非分组 0
  if (entry.role === 'user') segments.push({ text: '> ', style: styles.userPrompt })
  else if (entry.group) segments.push({ text: '  ', style: base })
  if (entry.preset === 'code') {
    // 代码块：按围栏语言上色（认不出语言就是纯 code 色，只损失颜色不影响可读）
    segments.push(...highlightLine(entry.text, entry.lang ?? 'plain'))
  } else {
    // 工具参数值行「key: value」拆两段上色，找参数时眼睛不用逐字扫
    const kv = entry.role === 'tool' ? paramParts(entry.text) : null
    if (kv) {
      segments.push({ text: kv[0], style: styles.paramKey })
      segments.push({ text: kv[1], style: styles.paramVal })
    } else {
      segments.push(...inlineSegments(entry.text, base, styles.inlineCode))
    }
  }
  return { kind: 'message', key: entry.key, role: entry.role, segments, selectableText: entry.text }
}

export function toToolRow(entry: ToolEntry, group: Group | undefined): TTranscriptRow {
  const collapsed = group?.collapsed ?? false
  const dot = entry.status === 'error' ? '✗' : '●'
  const suffix = entry.status === 'running' ? '…' : entry.status === 'ok' ? 'ok' : 'error'
  const hidden = collapsed && group && group.lines > 0 ? `  · ${group.lines} 行已折叠` : ''
  // 库把 tool-call row 画成 `▾ <title>` + summary 的 segments —— title 本身不带样式，
  // 所以「按工具类型上色」要把彩色部分放进 summary（读源码确认的渲染顺序，见 README 的实测表）。
  // 顺序上先画 title 再画 summary，于是 title 只留那个状态点。
  const summary: TTranscriptSegment[] = [
    { text: entry.title, style: toolHeaderStyle(entry.title) },
    { text: `  · ${suffix}`, style: entry.status === 'error' ? styles.statusErr : styles.faint },
  ]
  if (hidden) summary.push({ text: hidden, style: styles.faint })
  return {
    kind: 'tool-call',
    key: entry.key,
    title: dot,
    // 只用于让库画对 ▸/▾；真正的显隐由 visibleEntries() 过滤
    collapsed,
    summary,
    body: [],
    selectableText: entry.title,
  }
}
