/**
 * 配色与样式 token —— **shadcn「Lyra」风格 + blue 主色**（仓库的色值单源）。
 *
 * 风格：shadcn/create 的 **Lyra**（零圆角 / 方而锐利 / 配等宽字体）。官方定位就是
 * 「developer tools, terminals, and technical interfaces」——这个 TUI 的天然风格。
 *
 * 色值全部取自 shadcn registry 真值，hex 由 oklch→sRGB（Oklab 公式）算出，不是估的：
 *   · 中性骨架 = `colors/neutral.json` 的 dark（background oklch(.145 0 0) → #0a0a0a …）
 *   · 主色     = `registry/themes.ts` 的 **blue · dark**（primary oklch(.424 .199 265.638) → #193cb8）
 *   · 语义色   = shadcn 默认 chart 调色板 · dark（绿 #00bc7d / 黄 #fe9a00 / 紫 #ad46ff / 红 #ff2056）
 *
 * 两条改色时别踩的判据：
 *   1. blue 的 primary #193cb8 对暗底只有 **2.24:1** —— 只能当**填充底**（选中项/强调面，配 primaryFg）。
 *      要当强调前景得用同主题的亮蓝 #2b7fff（chart-2，5.26:1）。拿深蓝当正文字色会看不清。
 *   2. 这份 palette 与仓库根 `DESIGN.md` 的 front matter 必须同值：`node src/probes/lyra-tokens.ts` 守着。
 *
 * vue-tui 的 Style 只认 ANSI 名或 hex（渲染器负责降级到 ansi256/ansi16），所以统一用 hex。
 */
import type { Style } from '@simon_he/vue-tui/core'

export const palette = {
  // ── blue 主色（shadcn blue · dark）──
  /** 填充色：选中项底 / 强调面（对底 2.24:1，**只做底，不当字色**） */
  primary: '#193cb8',
  /** 压在 primary 上的字（对 primary 8.11:1） */
  primaryFg: '#eff6ff',
  /** 强调前景：命令名 / 模型名 / 标题 / 工具头（blue chart-2，对底 5.26:1） */
  accent: '#2b7fff',
  /** 次级强调（blue chart-3 = 蓝 600） */
  accentDim: '#155dfc',
  /** 链接与次要蓝（blue chart-1 浅蓝，对底 10.92:1） */
  link: '#8ec5ff',
  /** 品牌紫（shadcn 默认 chart-4）—— 欢迎块像素 logo */
  purple: '#ad46ff',

  // ── 中性骨架（shadcn neutral · dark）──
  /** 终端底色假设（仅用于合成值与文档；TUI 自己不画背景） */
  background: '#0a0a0a',
  /** 正文（对底 18.97:1） */
  foreground: '#fafafa',
  /** 卡片 / 代码块底（oklch(.205 0 0)） */
  card: '#171717',
  /** 次级填充（oklch(.269 0 0)） */
  muted: '#262626',
  /** 次要文字（对底 7.66:1） */
  mutedFg: '#a1a1a1',
  /** 聚焦 / 最弱文字（对底 4.18:1） */
  ring: '#737373',
  /** 描边 = 白 10% 叠底（Lyra 的细描边） */
  border: '#222222',
  /** 输入 / 弹窗描边 = 白 15% 叠底 */
  input: '#2f2f2f',

  // ── 语义色（shadcn 默认 chart · dark）──
  ok: '#00bc7d',
  warn: '#fe9a00',
  err: '#ff6467',

  // ── 兼容别名：既有引用不改名、只换值（改名会牵动 8 个文件，收益为零）──
  text: '#fafafa',
  dim: '#a1a1a1',
  faint: '#737373',
  codeFg: '#e5e5e5',
  codeBg: '#171717',

  // ── 语法高亮（都在 codeBg 上取值，全部来自 shadcn 色板）──
  synComment: '#525252',
  synKeyword: '#ad46ff',
  synString: '#00bc7d',
  synNumber: '#fe9a00',
  synFn: '#2b7fff',
  synType: '#8ec5ff',
  synLiteral: '#ff2056',
} as const

export const styles = {
  header: { fg: palette.accent, bold: true },
  headerMeta: { fg: palette.faint },
  status: { fg: palette.dim },
  /** 活跃段：Lyra 靠「亮 + 细」而不是色块 → 亮蓝 + bold（原来靠橙，现在靠蓝 + 字重） */
  statusActive: { fg: palette.accent, bold: true },
  statusOk: { fg: palette.ok },
  statusErr: { fg: palette.err },
  /**
   * Lyra 的「填充面」语义 = 选中项 / 当前项。终端没有圆角按钮，用 primary 底 + primaryFg 字表达
   * （对应 shadcn 的 `bg-primary text-primary-foreground`）。需要整行反白时用这个。
   */
  selected: { fg: palette.primaryFg, bg: palette.primary },
  hint: { fg: palette.faint },
  faint: { fg: palette.faint },
  user: { fg: palette.text, bold: true },
  userMark: { fg: palette.accentDim, bold: true },
  thinking: { fg: palette.dim, italic: true },
  thinkingMark: { fg: palette.accentDim, italic: true },
  toolMark: { fg: palette.accent, bold: true },
  toolMarkErr: { fg: palette.err, bold: true },
  toolTitle: { fg: palette.text, bold: true },
  toolSummary: { fg: palette.dim },
  toolIn: { fg: palette.codeFg, bg: palette.codeBg },
  toolOut: { fg: palette.dim },
  text: { fg: palette.text },
  heading: { fg: palette.accent, bold: true },
  bullet: { fg: palette.accentDim },
  quote: { fg: palette.dim, italic: true },
  code: { fg: palette.codeFg, bg: palette.codeBg },
  inlineCode: { fg: palette.codeFg, bg: palette.codeBg },
  bold: { fg: palette.text, bold: true },
  italic: { fg: palette.text, italic: true },
  link: { fg: palette.link, underline: true },
  note: { fg: palette.warn },
  // —— 下面这几个此前被 rows.ts 引用却没定义（style 为 undefined → 静默不上色）。
  // 改成强类型 const 后这类拼写错误会被 tsc 直接拦下，不用靠人眼。
  userPrompt: { fg: palette.accentDim, bold: true },
  thinkingHeader: { fg: palette.dim, italic: true },
  dim: { fg: palette.dim },
  paramKey: { fg: palette.faint },
  paramVal: { fg: palette.codeFg },
  // —— 欢迎块 / 无边框输入行（step 风格）——
  logo: { fg: palette.purple },
  infoLabel: { fg: palette.dim },
  infoValue: { fg: palette.link },
  tipCmd: { fg: palette.accent, bold: true },
  tipDesc: { fg: palette.dim },
  divider: { fg: palette.border },
  prefix: { fg: palette.accent, bold: true },
  placeholder: { fg: palette.faint },
}

/**
 * 语法高亮 token。用的时候要和 `styles.code` 合并（保住代码块背景）——
 * syntax.ts 里的 seg() 已经这么做了。
 */
export const syntax = {
  comment: { fg: palette.synComment, italic: true },
  keyword: { fg: palette.synKeyword },
  string: { fg: palette.synString },
  number: { fg: palette.synNumber },
  fn: { fg: palette.synFn },
  type: { fg: palette.synType },
  literal: { fg: palette.synLiteral },
  diffAdd: { fg: palette.ok },
  diffDel: { fg: palette.err },
  diffMeta: { fg: palette.accent },
}

/**
 * 工具名 → 头部颜色。六色各占 shadcn 色板的一档（蓝/浅蓝/绿/黄/紫/红），
 * 扫一眼就知道这行在干什么；认不出来的工具退回 accent，不会没颜色。
 */
const TOOL_COLOR: Record<string, string> = {
  read: palette.link, // 浅蓝 #8ec5ff
  write: palette.ok, // 绿 #00bc7d
  edit: palette.warn, // 黄 #fe9a00
  bash: palette.accent, // 蓝 #2b7fff（最常用 → 最醒目那档）
  ls: palette.purple, // 紫 #ad46ff
  grep: palette.synLiteral, // 红 #ff2056
  search: palette.synLiteral,
}

export function toolHeaderStyle(title: string): Style {
  // 名字两种来源都要认：mock 剧本写 `Read(...)` / `Bash(...)`，
  // AI SDK 工具是 `read_file` / `bash` / `edit_file`。统一压成小写字母再取前缀。
  const raw = (title.trim().split(/[\s(]/)[0] ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const key = raw.startsWith('read')
    ? 'read'
    : raw.startsWith('write')
      ? 'write'
      : raw.startsWith('edit')
        ? 'edit'
        : raw.startsWith('bash') || raw === 'codeshell'
          ? 'bash'
          : raw.startsWith('ls') || raw.startsWith('list')
            ? 'ls'
            : raw.startsWith('grep') || raw.startsWith('search')
              ? 'grep'
              : raw
  return { fg: TOOL_COLOR[key] ?? palette.accent, bold: true }
}

/**
 * ANSI 降级映射（`src/cli/terminal.ts` 传给渲染器）：终端只有 16/256 色时灰阶会糊成一团，
 * 所以层次不能只靠灰阶深浅、还要靠 bold/反白承载（见 DESIGN.md 的 Do's and Don'ts）。
 */
export const rendererPalette = {
  black: '#0a0a0a',
  white: '#fafafa',
  red: palette.err,
  green: palette.ok,
  yellow: palette.warn,
  blue: palette.accent,
  magenta: palette.purple,
  cyan: palette.link,
} as const
