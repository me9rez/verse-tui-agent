/**
 * 界面文案与小工具：命令帮助、提示栏、输入清洗、状态行对齐。
 * 放在这里是为了让 App.ts 只留「装配」，文案改动不必翻组件代码。
 */
import { cellWidth, padTo } from '../core/text.ts'

export const HELP = [
  '可用命令：',
  '  /help    显示这份说明',
  '  /clear   清空转写',
  '  /long    跑一段长回答（演示滚动与自动贴底）',
  '  /live    切到真实模型流（需要 VT_BASE_URL / VT_MODEL）',
  '  /ai      切到 AI SDK 工具 agent（read/write/edit/bash/ls）',
  '  /env     看当前 provider 配置（不回显密钥）',
  '  /sessions        列出落盘的会话（▶ = 当前）',
  '  /open <序号|id>   切换会话（恢复转写与模型上下文）',
  '  /new [标题]       新建一个空会话',
  '  /rename <标题>    给当前会话改名',
  '  /delete <序号|id> 删除某个会话（不能删当前）',
  '  /mock    切回本地剧本',
  '  /fold    折叠/展开全部（同一个 Ctrl+O）',
  '  /exit    退出',
].join('\n')

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

export const HINT = 'Enter 发送 · Esc 中断 · 点标题或 Ctrl+T 折叠最近一组 · Ctrl+O 全部折叠/展开 · /help · Ctrl+C 退出'

/** 左文 + 右文，按列宽对齐（右文贴右边，左文不够长就补空格）。 */
export function fitLine(cols: number, left: string, right: string): string {
  return padTo(left, Math.max(1, cols - 2 - cellWidth(right))) + right
}
