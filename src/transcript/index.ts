/**
 * 转写模块出口：外部只从这里 import。
 *
 * 目录分层（三层实测结论见 README「思考 / 工具调用的折叠与参数」）：
 *   types.ts     类型（叶子）
 *   markdown.ts  行级 markdown + 参数格式化（纯函数）
 *   rows.ts      entry → TTranscriptRow（缩进 / 折叠标记在这里）
 *   store.ts     LineStream + TranscriptStore（分组、可见行过滤、版本号）
 */
export { createTranscriptStore, LineStream, TranscriptStore } from './store.ts'
export { formatParams } from './markdown.ts'
export type { Entry, Group, GroupKind, LineEntry, Preset, Role, ToolEntry, ToolStatus } from './types.ts'
export type { Style } from '@simon_he/vue-tui/core'
