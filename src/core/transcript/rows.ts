/**
 * entry → TTranscriptRow：视图只认 row，这一层把「普通行」和「分组头部」拼成 segments。
 * 缩进与折叠标记都在这里决定（库不给默认缩进，实测三种 role 都是 0）。
 */
import type { TTranscriptRow, TTranscriptSegment } from '@simon_he/vue-tui/agent'
import { styles } from '../theme.ts'
import { inlineSegments, presetBase } from './markdown.ts'
import type { Group, LineEntry, ToolEntry } from './types.ts'

export function toLineRow(entry: LineEntry, group: Group | undefined): TTranscriptRow {
  const base = presetBase(entry.preset, entry.role)
  const segments: TTranscriptSegment[] = []
  if (entry.head && group) {
    // 分组头部：自己画折叠标记（库的段落式排版塞不下多行 body，所以显隐由数据源过滤）
    segments.push({ text: `${group.collapsed ? '▸' : '▾'} ${entry.text}`, style: styles.thinkingHeader })
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
  segments.push(...inlineSegments(entry.text, base, styles.inlineCode))
  return { kind: 'message', key: entry.key, role: entry.role, segments, selectableText: entry.text }
}

export function toToolRow(entry: ToolEntry, group: Group | undefined): TTranscriptRow {
  const collapsed = group?.collapsed ?? false
  const dot = entry.status === 'error' ? '✗' : '●'
  const suffix = entry.status === 'running' ? '  …' : entry.status === 'ok' ? '  · ok' : '  · error'
  const hidden = collapsed && group && group.lines > 0 ? `  · ${group.lines} 行已折叠` : ''
  return {
    kind: 'tool-call',
    key: entry.key,
    title: `${dot} ${entry.title}${suffix}${hidden}`,
    // 只用于让库画对 ▸/▾；真正的显隐由 visibleEntries() 过滤
    collapsed,
    summary: [],
    body: [],
    selectableText: entry.title,
  }
}
