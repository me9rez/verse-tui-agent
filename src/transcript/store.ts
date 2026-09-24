/**
 * 转写存储与行级流。
 *
 *   LineStream      —— 流式增量按行累积：遇换行封行开新行，增量只改「当前行」
 *   TranscriptStore —— 行集合、可折叠分组、可见行过滤、版本号（决定重绘范围）
 *
 * 折叠的显隐由 visibleEntries() 过滤实现；头部行的 collapsed 只用于让库画对 ▸/▾。
 */
import { ref } from 'vue'
import type { Style } from '@simon_he/vue-tui/core'
import type { TTranscriptDataSource, TTranscriptRow } from '@simon_he/vue-tui/agent'
import { styles } from '../core/theme.ts'
import { formatParams } from './markdown.ts'
import { langOf, type Lang } from '../core/syntax.ts'
import { toLineRow, toToolRow } from './rows.ts'
import type { Entry, Group, GroupKind, LineEntry, Preset, Role, ToolEntry, ToolStatus } from './types.ts'

let seq = 0
const nextKey = (prefix: string) => `${prefix}-${++seq}`

/** 行内 markdown：`code` / **bold** / *italic* / [text](url) */

export class LineStream {
  private store: TranscriptStore
  private role: Role
  private pending = ''
  private current: LineEntry | null = null
  private inFence = false
  /** 当前围栏的语言：开栏时记下来，栏内每一行都带上（决定用哪张关键字表上色） */
  private fenceLang: Lang = 'plain'
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

  /** 行级样式判定：围栏内 / 标题 / 列表 / 引用（纯函数，不再改围栏状态——那是 commit 的事） */
  private classOf(raw: string): { preset: Preset; text: string; lang?: Lang } | null {
    const trimmed = raw.trim()
    if (this.inFence) return { preset: 'code', text: `${this.indent}  ${raw}`, lang: this.fenceLang }
    const h = /^#{1,6}\s+(.*)$/.exec(trimmed)
    if (h) return { preset: 'heading', text: `${this.indent}${h[1]}` }
    const b = /^[-*]\s+(.*)$/.exec(trimmed)
    if (b) return { preset: 'bullet', text: `${this.indent}• ${b[1]}` }
    const o = /^(\d+)\.\s+(.*)$/.exec(trimmed)
    if (o) return { preset: 'bullet', text: `${this.indent}${o[1]}. ${o[2]}` }
    if (/^>\s?/.test(trimmed)) return { preset: 'quote', text: `${this.indent}${trimmed.replace(/^>\s?/, '')}` }
    return { preset: 'plain', text: `${this.indent}${raw}` }
  }

  private apply(cls: { preset: Preset; text: string; lang?: Lang }): void {
    const entry = this.current ?? this.openLine(cls.preset)
    entry.preset = cls.preset
    entry.text = cls.text
    // 语言只在 code 行上有意义；换行复用 entry 时要清掉，否则上一行的 lang 会串到纯文本行
    if (cls.lang) entry.lang = cls.lang
    else delete entry.lang
    entry.rev++
    this.store.bump()
  }

  /** 封行：写完当前行后不再复用它 */
  private commit(raw: string): void {
    const trimmed = raw.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      // 围栏标记只在这里翻转一次状态，且自己不占一行。
      // （此前这段逻辑放在 classOf 里，而 classOf 会被未完成行的每个增量调用一次，
      //   于是同一个 ``` 被翻转奇偶次 —— 围栏状态时对时错，靠运气。）
      this.inFence = !this.inFence
      this.fenceLang = this.inFence ? langOf(trimmed) : 'plain'
      this.current = null
      return
    }
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
      const t = this.pending.trim()
      // 未完成的行前缀是 ` 或 ~ 时先不渲染：它可能是围栏标记，是否开栏要等封行才知道
      if (t.startsWith('`') || t.startsWith('~')) return
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

  /**
   * 手风琴：只留 keepId 这个组展开，其余全部收起（不传 keepId 则全收起）。
   *
   * 一轮进行中由 session/sink 调用，实现「正在写的那块展开、前面的一律收起」；
   * 一轮结束（或正文开始流式输出时）也用同一入口把全部收起。
   */
  soloExpand(keepId?: string): void {
    let changed = false
    for (const g of this.groups.values()) {
      const shouldCollapse = keepId === undefined || g.id !== keepId
      if (g.collapsed !== shouldCollapse) {
        g.collapsed = shouldCollapse
        changed = true
      }
    }
    if (changed) this.bump()
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

export function createTranscriptStore(): TranscriptStore {
  return new TranscriptStore()
}

export type { Style }
