/**
 * 转写数据源：Claude Code 风格的「一行一行」模型 + 可折叠分组。
 *
 * 三个实测结论决定了现在的写法（都用 src/probe-toolrow.ts 探过）：
 *   1. TTranscriptView 把一行里的 segments 当**同一段落**排版，段内换行不会断行
 *      ——所以正文按物理行拆 row，一行一个 row，流式增量只改当前行。
 *   2. `kind: 'tool-call'` 的行会自己画 ▸/▾ 折叠标记，也有点击/键盘热区
 *      ——标记白拿。
 *   3. 但它的 `body` 同样是段落式，装不下「参数 + 多行输出」
 *      ——所以真正的显隐由本文件自己过滤：分组折叠时，隐藏该组除头部以外的所有行。
 *        头部行的 `collapsed` 只用来让库画对 ▸/▾。
 *
 * 分组（Group）就是把「思考」「一次工具调用」各自的头部行 + 内容行绑在一起，
 * 点击头部（或 Ctrl+O / Ctrl+T）切换 collapsed，过滤规则随之生效。
 */
import { ref } from 'vue'
import type { Style } from '@simon_he/vue-tui/core'
import type { TTranscriptDataSource, TTranscriptRow, TTranscriptSegment } from '@simon_he/vue-tui/agent'
import { styles } from './theme.ts'

export type Role = 'user' | 'assistant' | 'system' | 'tool'
export type Preset = 'plain' | 'code' | 'heading' | 'bullet' | 'quote' | 'dim' | 'note'
export type GroupKind = 'thinking' | 'tool'
export type ToolStatus = 'running' | 'ok' | 'error'

export type Group = {
  id: string
  kind: GroupKind
  collapsed: boolean
  /** 组内内容行数（不含头部），用于折叠后的「N 行」提示 */
  lines: number
  /** tool 组的状态（头部行状态由它同步） */
  status?: ToolStatus
}

export type LineEntry = {
  kind: 'line'
  key: string
  role: Role
  text: string
  preset: Preset
  /** 属于哪个分组 */
  group?: string
  /** 分组头部行 */
  head?: boolean
  rev: number
}

export type ToolEntry = {
  kind: 'tool'
  key: string
  title: string
  status: ToolStatus
  group: string
  head: true
  rev: number
}

export type Entry = LineEntry | ToolEntry

let seq = 0
const nextKey = (prefix: string) => `${prefix}-${++seq}`

/** 行内 markdown：`code` / **bold** / *italic* / [text](url) */
function inlineSegments(text: string, base: Style, codeStyle: Style): TTranscriptSegment[] {
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

function presetBase(preset: Preset, role: Role): Style {
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
export class LineStream {
  private store: TranscriptStore
  private role: Role
  private pending = ''
  private current: LineEntry | null = null
  private inFence = false
  private head: string | undefined
  private indent: string
  private group: string | undefined

  // 注意：Node 的 strip-only TS 不支持构造函数参数属性（constructor(private x)），
  // 所以字段先声明、在构造函数里赋值，否则直接跑会报 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  constructor(store: TranscriptStore, role: Role, opts: { head?: string; indent?: number; group?: string } = {}) {
    this.store = store
    this.role = role
    this.head = opts.head
    this.indent = ' '.repeat(opts.indent ?? 0)
    this.group = opts.group
  }

  private openLine(preset: Preset): LineEntry {
    const head = this.head
    this.head = undefined
    const entry: LineEntry = {
      kind: 'line',
      key: nextKey('ln'),
      role: this.role,
      text: '',
      preset,
      group: this.group,
      rev: 0,
    }
    if (head) {
      entry.head = true
      entry.text = head
    }
    this.store.pushEntry(entry)
    this.current = entry
    return entry
  }

  /** 行级样式判定：围栏 / 标题 / 列表 / 引用 */
  private classOf(raw: string): { preset: Preset; text: string } | null {
    const trimmed = raw.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      this.inFence = !this.inFence
      return null // 围栏标记本身不占一行
    }
    if (this.inFence) return { preset: 'code', text: `${this.indent}  ${raw}` }
    const h = /^#{1,6}\s+(.*)$/.exec(trimmed)
    if (h) return { preset: 'heading', text: `${this.indent}${h[1]}` }
    const b = /^[-*]\s+(.*)$/.exec(trimmed)
    if (b) return { preset: 'bullet', text: `${this.indent}• ${b[1]}` }
    const o = /^(\d+)\.\s+(.*)$/.exec(trimmed)
    if (o) return { preset: 'bullet', text: `${this.indent}${o[1]}. ${o[2]}` }
    if (/^>\s?/.test(trimmed)) return { preset: 'quote', text: `${this.indent}${trimmed.replace(/^>\s?/, '')}` }
    return { preset: 'plain', text: `${this.indent}${raw}` }
  }

  private apply(cls: { preset: Preset; text: string }): void {
    const entry = this.current ?? this.openLine(cls.preset)
    entry.preset = cls.preset
    entry.text = cls.text
    entry.rev++
    this.store.bump()
  }

  /** 封行：写完当前行后不再复用它（classOf 对围栏行有副作用，每行只判一次） */
  private commit(raw: string): void {
    const cls = this.classOf(raw)
    if (cls) this.apply(cls)
    this.current = null
  }

  push(delta: string): void {
    this.pending += delta
    let idx: number
    while ((idx = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, idx)
      this.pending = this.pending.slice(idx + 1)
      this.commit(line)
    }
    if (this.pending) {
      const cls = this.classOf(this.pending)
      if (cls) this.apply(cls)
    }
  }

  end(): void {
    if (this.pending) {
      this.commit(this.pending)
      this.pending = ''
    }
    this.current = null
  }
}

export class TranscriptStore implements TTranscriptDataSource {
  entries: Entry[] = []
  groups = new Map<string, Group>()
  version = ref(0)
  stats = ref({ turns: 0, tools: 0 })

  // 可见行缓存：视图会对每一行调 getRow，逐次过滤就是 O(n²)
  private cache: Entry[] = []
  private cacheVersion = -1

  bump(): void {
    this.version.value++
  }

  /** 入表统一走这里：加进 entries 并自增版本（分组行数由 group 自己数） */
  pushEntry(entry: Entry): void {
    this.entries.push(entry)
    if (entry.group) {
      const g = this.groups.get(entry.group)
      if (g && !entry.head) g.lines++
    }
    this.bump()
  }

  // ── 分组 ──────────────────────────────────────────────────────────

  startThinkingGroup(header = '✻ Thinking'): Group {
    this.blank()
    const id = nextKey('grp')
    const group: Group = { id, kind: 'thinking', collapsed: false, lines: 0 }
    this.groups.set(id, group)
    this.pushEntry({
      kind: 'line',
      key: nextKey('th'),
      role: 'system',
      text: header,
      preset: 'dim',
      group: id,
      head: true,
      rev: 0,
    })
    return group
  }

  /** 工具组：头部是 tool-call 行（拿到库的 ▸/▾ 与点击热区），参数作为组内首批内容行 */
  startToolGroup(opts: { name: string; arg: string; params?: Record<string, unknown> }): { group: Group; head: ToolEntry } {
    this.blank()
    const id = nextKey('grp')
    const group: Group = { id, kind: 'tool', collapsed: false, lines: 0, status: 'running' }
    this.groups.set(id, group)
    const head: ToolEntry = {
      kind: 'tool',
      key: nextKey('tool'),
      title: opts.arg ? `${opts.name}(${opts.arg})` : opts.name,
      status: 'running',
      group: id,
      head: true,
      rev: 0,
    }
    this.entries.push(head)
    this.stats.value = { ...this.stats.value, tools: this.stats.value.tools + 1 }
    this.bump()
    const paramLines = formatParams(opts.params)
    if (paramLines.length) this.appendGroupBlock(id, 'params', paramLines)
    return { group, head }
  }

  appendGroupLine(groupId: string, text: string, preset: Preset = 'dim', role: Role = 'tool'): void {
    this.pushEntry({ kind: 'line', key: nextKey('ln'), role, text, preset, group: groupId, rev: 0 })
  }

  /** 组内 section 标题（params / out），缩进由这里统一 */
  groupSection(groupId: string, name: string): void {
    this.appendGroupLine(groupId, name, 'note', 'tool')
  }

  /** 组内正文行（缩进 2，和参数值对齐） */
  groupBody(groupId: string, text: string): void {
    this.appendGroupLine(groupId, `  ${text}`, 'dim', 'tool')
  }

  /**
   * 块间留白：只在「上一行不是空行」时插一行空行。
   * 终端排版的可读性一大半来自这个节奏，别省。
   */
  blank(): void {
    const last = this.entries[this.entries.length - 1]
    if (!last) return
    const text = last.kind === 'line' ? last.text : last.title
    if (text.trim() === '') return
    this.pushEntry({ kind: 'line', key: nextKey('ln'), role: 'system', text: '', preset: 'plain', rev: 0 })
  }

  /** 组内追加一段带 section 标题的多行文本（工具输出 / 参数块用） */
  appendGroupBlock(groupId: string, section: string, lines: readonly string[]): void {
    if (!lines.length) return
    this.appendGroupLine(groupId, section, 'note', 'tool')
    for (const line of lines) this.appendGroupLine(groupId, `  ${line}`, 'dim', 'tool')
  }

  setGroupCollapsed(groupId: string, collapsed: boolean): boolean {
    const g = this.groups.get(groupId)
    if (!g || g.collapsed === collapsed) return g?.collapsed ?? false
    g.collapsed = collapsed
    this.bump()
    return collapsed
  }

  toggleGroup(groupId: string): boolean {
    const g = this.groups.get(groupId)
    if (!g) return false
    return this.setGroupCollapsed(groupId, !g.collapsed)
  }

  /** 全部折叠 / 全部展开：返回切换后的状态（true = 现已全部折叠） */
  toggleAllGroups(): boolean {
    const groups = [...this.groups.values()]
    if (!groups.length) return false
    const next = !groups.every((g) => g.collapsed)
    for (const g of groups) g.collapsed = next
    this.bump()
    return next
  }

  /** 折叠/展开最近一个分组，返回它的 id */
  toggleLastGroup(): string | null {
    const last = [...this.groups.values()].at(-1)
    if (!last) return null
    this.toggleGroup(last.id)
    return last.id
  }

  setToolStatus(head: ToolEntry, status: ToolStatus): void {
    head.status = status
    head.rev++
    const g = this.groups.get(head.group)
    if (g) g.status = status
    this.bump()
  }

  groupById(id: string): Group | undefined {
    return this.groups.get(id)
  }

  /** 供测试/命令：分组摘要（不含内容） */
  groupSummary(): Array<{ id: string; kind: GroupKind; collapsed: boolean; lines: number; status?: ToolStatus }> {
    void this.version.value
    return [...this.groups.values()].map((g) => ({
      id: g.id,
      kind: g.kind,
      collapsed: g.collapsed,
      lines: g.lines,
      status: g.status,
    }))
  }

  // ── 其它写入 ──────────────────────────────────────────────────────

  addNote(text: string): LineEntry {
    this.blank()
    const entry: LineEntry = { kind: 'line', key: nextKey('note'), role: 'system', text, preset: 'note', rev: 0 }
    this.pushEntry(entry)
    return entry
  }

  addUser(text: string): void {
    this.blank()
    for (const line of text.split('\n')) {
      this.pushEntry({ kind: 'line', key: nextKey('usr'), role: 'user', text: line, preset: 'plain', rev: 0 })
    }
    this.stats.value = { ...this.stats.value, turns: this.stats.value.turns + 1 }
    this.bump()
  }

  stream(role: Role, opts?: { head?: string; indent?: number; group?: string }): LineStream {
    return new LineStream(this, role, opts)
  }

  /** 粗估 token（字符数 / 4）：读 version 保证 computed 能跟着增量更新。 */
  estimateTokens(): number {
    void this.version.value
    let chars = 0
    for (const e of this.entries) chars += e.kind === 'line' ? e.text.length : e.title.length
    return Math.round(chars / 4)
  }

  clear(): void {
    this.entries = []
    this.groups.clear()
    this.stats.value = { turns: 0, tools: 0 }
    this.bump()
  }

  // ── TTranscriptDataSource ─────────────────────────────────────────

  /** 折叠的组只留头部行 */
  visibleEntries(): Entry[] {
    if (this.cacheVersion === this.version.value) return this.cache
    const out: Entry[] = []
    for (const entry of this.entries) {
      if (entry.group && !entry.head) {
        const g = this.groups.get(entry.group)
        if (g?.collapsed) continue
      }
      out.push(entry)
    }
    this.cache = out
    this.cacheVersion = this.version.value
    return out
  }

  rowCount(): number {
    return this.visibleEntries().length
  }

  getRow(index: number): TTranscriptRow {
    const entry = this.visibleEntries()[index]
    if (!entry) {
      return { kind: 'message', key: `empty-${index}`, segments: [{ text: '', style: styles.dim }] }
    }
    const group = entry.group ? this.groups.get(entry.group) : undefined
    if (entry.kind === 'tool') return toToolRow(entry, group)
    return toLineRow(entry, group)
  }

  getRowKey(index: number): string | number {
    return this.visibleEntries()[index]?.key ?? index
  }

  getRowVersion(index: number): number {
    const entry = this.visibleEntries()[index]
    if (!entry) return 0
    const g = entry.group ? this.groups.get(entry.group) : undefined
    // 折叠状态变化时，头部行必须被判定为「变了」，否则视图不会重画 ▸/▾
    return entry.rev + (g?.collapsed ? 1_000_000 : 0)
  }

  firstRowIndex(): number {
    return 0
  }

  /** 可见行是否属于某个分组（点击处理用） */
  entryAt(index: number): Entry | undefined {
    return this.visibleEntries()[index]
  }
}

function toLineRow(entry: LineEntry, group: Group | undefined): TTranscriptRow {
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

function toToolRow(entry: ToolEntry, group: Group | undefined): TTranscriptRow {
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

export function createTranscriptStore(): TranscriptStore {
  return new TranscriptStore()
}

export type { Style }
