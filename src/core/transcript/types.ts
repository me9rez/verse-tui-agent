/**
 * 转写数据模型的类型。
 *
 * 叶子模块：不 import store / rows，避免循环依赖——store 依赖 rows，rows 依赖 markdown，
 * markdown 与本文件只依赖 theme 和库类型。
 */
import type { Lang } from '../syntax.ts'

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
  /** code 行的围栏语言（`ts` / `bash` / `diff` …），决定用哪张关键字表上色 */
  lang?: Lang
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

