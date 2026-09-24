/**
 * 界面文案与小工具：命令表、提示栏、输入清洗、状态行对齐。
 * 放在这里是为了让 App.ts 只留「装配」，文案改动不必翻组件代码。
 *
 * COMMANDS 是 slash 命令的**唯一数据源**：/help 的 HELP 文案与输入框的
 * `/` 补全建议（promptSuggestions）都从它派生，加命令只改这一处。
 */
import { cellWidth, padTo } from '../core/text.ts'

export type SlashCommand = Readonly<{
  /** 命令本体，如 '/open' */
  cmd: string
  /** 一句话说明：进 HELP，也进补全弹窗右侧 detail */
  desc: string
  /** 参数占位（含括号，如 '<序号|id>'，可选）：进 HELP 与补全 detail 前缀 */
  usage?: string
}>

export const COMMANDS: readonly SlashCommand[] = [
  { cmd: '/help', desc: '显示这份说明' },
  { cmd: '/clear', desc: '清空转写' },
  { cmd: '/long', desc: '跑一段长回答（演示滚动与自动贴底）' },
  { cmd: '/rpc', desc: '切到唯一 agent 后端（WebSocket JSON-RPC，需先 pnpm backend 起服务）' },
  { cmd: '/env', desc: '看当前后端配置（不回显密钥）' },
  { cmd: '/sessions', desc: '列出落盘的会话（▶ = 当前）' },
  { cmd: '/open', usage: '<序号|id>', desc: '切换会话（恢复转写与模型上下文）' },
  { cmd: '/new', usage: '[标题]', desc: '新建一个空会话' },
  { cmd: '/rename', usage: '<标题>', desc: '给当前会话改名' },
  { cmd: '/delete', usage: '<序号|id>', desc: '删除某个会话（不能删当前）' },
  { cmd: '/mock', desc: '切回本地剧本' },
  { cmd: '/fold', desc: '折叠/展开全部（同一个 Ctrl+O）' },
  { cmd: '/model', usage: '<id>', desc: '查看/切换后端模型（plan/todos 会重置）' },
  { cmd: '/exit', desc: '退出' },
]

/** 命令 + 参数占位的展示列（'/open <序号|id>'），定宽对齐。 */
const token = (c: SlashCommand): string => (c.usage ? `${c.cmd} ${c.usage}` : c.cmd)

export const HELP = ['可用命令：', ...COMMANDS.map((c) => `  ${token(c).padEnd(17)} ${c.desc}`)].join('\n')

export const NL = String.fromCharCode(10)

/** 去掉 C0/C1 控制字符，保留 tab 与换行；终端里注入的键序列常带这些标记。 */
export function stripControlChars(value: string): string {
  return [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
}

export const PLACEHOLDER = '问点什么（/ 补全命令 · Enter 发送 · Esc 中断）'
export const EMPTY_NOTE = '输入第一条消息，开始新会话。'

/** 左文 + 右文，按列宽对齐（右文贴右边，左文不够长就补空格）。 */
export function fitLine(cols: number, left: string, right: string): string {
  return padTo(left, Math.max(1, cols - 2 - cellWidth(right))) + right
}
