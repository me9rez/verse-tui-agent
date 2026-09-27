/**
 * 配色与样式 token —— **Kimi Code 同款调色板 + Lyra 形状语言**（仓库的色值单源）。
 *
 * 颜色：19 个 token 的名字与语义**照抄 Kimi Code**（`primary` / `textDim` / `diffGutter` …），
 * 值取它文档 dark 一列的真值 → `DEFAULT_THEME`。这样用户从 Kimi 抄来的主题 JSON 可以原样
 * 放进 `<VERSE_HOME>/themes/` 就用（后端读、`theme/list` 下发，见 backend/theme.py）。
 *
 * 形状：仍是 shadcn「Lyra」（零圆角 / 直角线 / 细描边）—— Kimi 只定义颜色，不定义形状。
 *
 * 三条改色时别踩的判据：
 *   1. `primary` 是**前景**语义（链接、选中、聚焦、徽章）。`styles.selected` 的填充底也用它，
 *      但配 `primaryFg`（近黑 SURFACE）—— 亮蓝底压白字读不了。
 *   2. `palette` / `DEFAULT_THEME` / backend/theme.py 的 `DARK` / DESIGN.md 的 front matter
 *      必须四方同值：`node src/probes/theme-tokens.ts` 守着。
 *   3. 语法高亮没有 Kimi token，按它的色系派生（fn=primary、string=success、number=warning、
 *      keyword=shellMode、type=accent、literal=error、comment=textMuted）—— 别引入体系外的色。
 *
 * **响应式**：`palette` 是 reactive，`styles` / `syntax` 的每个键都是**惰性 getter** ——
 * 切主题时 `applyTheme()` 写进 palette，读取点（`styles.header` 这种写法）一字不用改就拿到新色。
 * 行样式是**渲染时**求值的（见 transcript/rows.ts），所以换主题后让视图重绘即全量生效。
 *
 * vue-tui 的 Style 只认 ANSI 名或 hex（渲染器负责降级到 ansi256/ansi16），所以统一用 hex。
 */
import { reactive } from 'vue'
import type { Style } from '@simon_he/vue-tui/core'

/** 可被主题覆盖的 token（Kimi Code 的 19 个；顺序与它的文档一致）。 */
export const THEME_TOKENS = [
  'primary', 'accent', 'text', 'textStrong', 'textDim', 'textMuted', 'border', 'borderFocus',
  'success', 'warning', 'error',
  'diffAdded', 'diffRemoved', 'diffAddedStrong', 'diffRemovedStrong', 'diffGutter', 'diffMeta',
  'roleUser', 'shellMode',
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]

/**
 * 内置默认主题 = Kimi Code 的 **dark**。值与 backend/theme.py 的 `DARK`、DESIGN.md 的 front matter
 * 逐项同值（探针守着）。light 基准同样在后端内置，自定义主题用 `"base": "light"` 取用。
 */
export const DEFAULT_THEME: Readonly<Record<ThemeToken, string>> = {
  primary: '#4FA8FF',
  accent: '#5BC0BE',
  text: '#E0E0E0',
  textStrong: '#F5F5F5',
  textDim: '#888888',
  textMuted: '#6B6B6B',
  border: '#5A5A5A',
  borderFocus: '#E8A838',
  success: '#4EC87E',
  warning: '#E8A838',
  error: '#E85454',
  diffAdded: '#4EC87E',
  diffRemoved: '#E85454',
  diffAddedStrong: '#7AD99B',
  diffRemovedStrong: '#F08585',
  diffGutter: '#6B6B6B',
  diffMeta: '#888888',
  roleUser: '#FFCB6B',
  shellMode: '#BD93F9',
}

/** 内置 **light** 基准（Kimi 同款值）。自定义主题写 `"base": "light"` 时以它打底。 */
export const LIGHT_THEME: Readonly<Record<ThemeToken, string>> = {
  primary: '#1565C0',
  accent: '#00838F',
  text: '#1A1A1A',
  textStrong: '#1A1A1A',
  textDim: '#454545',
  textMuted: '#5F5F5F',
  border: '#737373',
  borderFocus: '#92660A',
  success: '#0E7A38',
  warning: '#92660A',
  error: '#B91C1C',
  diffAdded: '#0E7A38',
  diffRemoved: '#B91C1C',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#B91C1C',
  diffGutter: '#737373',
  diffMeta: '#5F5F5F',
  roleUser: '#9A4A00',
  shellMode: '#7C3AED',
}

/**
 * 内置主题表：mock / 未握手时前端自己就能列出并切换（值与 backend/theme.py 的 BASES 同源，
 * 探针守着）。rpc 连上后以 `theme/list` 的结果为准（它还会带上自定义主题）。
 */
export const BUILTIN_THEMES: Readonly<Record<string, Readonly<Record<ThemeToken, string>>>> = {
  dark: DEFAULT_THEME,
  light: LIGHT_THEME,
}

/**
 * 自有的、Kimi 没定义的底色（它认为终端底色归终端管）：`surface` 只用于「压在亮色上的深字」
 * 与文档的对比度计算，`raised` 是代码块 / 卡片底。**按主题的 base 取** —— 浅色主题必须配浅底，
 * 否则 primaryFg（压在亮色上的字）会变成黑压黑。
 */
const SURFACES: Readonly<Record<string, { surface: string; raised: string }>> = {
  dark: { surface: '#0A0A0A', raised: '#1A1A1A' },
  light: { surface: '#FFFFFF', raised: '#F0F0F0' },
}

/**
 * 19 个主题 token → 我们的 palette（按**层级**命名的那套）。
 *
 * 映射原则：语义对齐，不为凑名字硬塞 —— `primary`（最常用色）落到 `accent` / `link`，
 * `accent`（次级强调）落到 `accentDim`，`shellMode` 落到品牌紫（我们没有 shell 模式），
 * `roleUser` 落到用户标记色，`borderFocus` 落到 `focus`（聚焦边框 / 注意提示，正好给 plan 模式）。
 */
function derive(colors: Record<string, string>, base = 'dark'): Record<string, string> {
  const c = (key: ThemeToken): string => colors[key] ?? DEFAULT_THEME[key]
  const s = SURFACES[base] ?? SURFACES.dark!
  // 用局部名，免得改十几处引用（浅色主题要的是浅底深字）
  const SURFACE = s.surface
  const SURFACE_RAISED = s.raised
  return {
    // ── 主色系（Kimi primary / accent / roleUser / shellMode）──
    primary: c('primary'),
    primaryFg: SURFACE,
    accent: c('primary'),
    accentDim: c('accent'),
    link: c('primary'),
    purple: c('shellMode'),
    roleUser: c('roleUser'),

    // ── 骨架（Kimi text / textStrong / textDim / textMuted / border / borderFocus）──
    background: SURFACE,
    foreground: c('text'),
    textStrong: c('textStrong'),
    card: SURFACE_RAISED,
    muted: SURFACE_RAISED,
    mutedFg: c('textDim'),
    ring: c('textMuted'),
    border: c('border'),
    input: c('border'),
    focus: c('borderFocus'),

    // ── 语义（Kimi success / warning / error）──
    ok: c('success'),
    warn: c('warning'),
    err: c('error'),

    // ── diff（Kimi 六个 diff token；行内改动的 Strong 两档留给未来的 diff 视图）──
    diffAdded: c('diffAdded'),
    diffRemoved: c('diffRemoved'),
    diffAddedStrong: c('diffAddedStrong'),
    diffRemovedStrong: c('diffRemovedStrong'),
    diffGutter: c('diffGutter'),
    diffMeta: c('diffMeta'),

    // ── 兼容别名：既有引用不改名、只换值 ──
    text: c('text'),
    dim: c('textDim'),
    faint: c('textMuted'),
    codeFg: c('textStrong'),
    codeBg: SURFACE_RAISED,

    // ── 语法高亮（Kimi 无 token，按它的色系派生）──
    synComment: c('textMuted'),
    synKeyword: c('shellMode'),
    synString: c('success'),
    synNumber: c('warning'),
    synFn: c('primary'),
    synType: c('accent'),
    synLiteral: c('error'),
  }
}

/** 按层级命名的调色板。reactive：`applyTheme()` 写进去后，所有读取点自动重算。 */
export const palette = reactive(derive(DEFAULT_THEME))

/**
 * ANSI 降级映射（`src/cli/terminal.ts` 传给渲染器）：终端只有 16 / 256 色时灰阶会糊成一团，
 * 所以层次不能只靠灰阶深浅、还要靠 bold / 反白承载（见 DESIGN.md 的 Do's and Don'ts）。
 * 做成 reactive 并在 `applyTheme()` 里同步 —— 渲染器按属性读取，换主题后降级映射跟着换。
 */
const RENDERER_KEYS = ['black', 'white', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const
const rendererSource = (): Record<string, string> => ({
  black: palette.background,
  white: palette.foreground,
  red: palette.err,
  green: palette.ok,
  yellow: palette.warn,
  blue: palette.accent,
  magenta: palette.purple,
  cyan: palette.link,
})
export const rendererPalette = reactive(rendererSource()) as Record<
  (typeof RENDERER_KEYS)[number],
  string
>

/**
 * 应用一套主题色（来自后端 `theme/list` / `theme/set` 的 `colors`）。
 * 缺失的 token 回退默认值、未识别的键直接忽略 —— 调用方不必先校验（后端已过滤过一遍）。
 */
export function applyTheme(
  colors: Record<string, string> | null | undefined,
  base = 'dark',
): void {
  Object.assign(palette, derive({ ...DEFAULT_THEME, ...(colors ?? {}) }, base))
  const next = rendererSource()
  for (const key of RENDERER_KEYS) rendererPalette[key] = next[key]
}

/**
 * 样式表。**每个键都是 getter**：值在读取那一刻从 palette 现算，
 * 所以 `styles.header` 这种既有写法在换主题后自动拿到新色，调用点无需改动。
 */
/**
 * 把「函数表」包成**访问器对象**：`styles.header` 每读一次现算一次（换主题自动跟）。
 * 为什么不用字面量 `get x()`：40 个键 × 3 行太吵；Proxy 保证 `styles.x` 的写法一字不变，
 * 既有调用点（几十处）零改动 —— 这是「换主题不用改读取点」的实现基础。
 */
function live<T extends Record<string, () => Style>>(
  table: T,
): { readonly [K in keyof T]: Style } {
  return new Proxy(table, {
    get: (t, key) =>
      typeof (t as Record<string, unknown>)[key as string] === 'function'
        ? (t as Record<string, () => Style>)[key as string]!()
        : undefined,
  }) as { readonly [K in keyof T]: Style }
}

const stylesTable = {
  header: (): Style => ({ fg: palette.accent, bold: true }),
  headerMeta: (): Style => ({ fg: palette.faint }),
  status: (): Style => ({ fg: palette.dim }),
  /** 活跃段：靠「亮 + bold」而不是色块 → 主色 + 字重 */
  statusActive: (): Style => ({ fg: palette.accent, bold: true }),
  statusOk: (): Style => ({ fg: palette.ok }),
  statusErr: (): Style => ({ fg: palette.err }),
  /**
   * 「填充面」= 选中项 / 当前项。终端没有圆角按钮，用主色底 + 近黑字表达
   * （Kimi 的 primary 是亮蓝，压白字读不了，所以字色取 SURFACE）。
   */
  selected: (): Style => ({ fg: palette.primaryFg, bg: palette.primary }),
  hint: (): Style => ({ fg: palette.faint }),
  faint: (): Style => ({ fg: palette.faint }),
  user: (): Style => ({ fg: palette.text, bold: true }),
  userMark: (): Style => ({ fg: palette.roleUser, bold: true }),
  thinking: (): Style => ({ fg: palette.dim, italic: true }),
  thinkingMark: (): Style => ({ fg: palette.accentDim, italic: true }),
  toolMark: (): Style => ({ fg: palette.accent, bold: true }),
  toolMarkErr: (): Style => ({ fg: palette.err, bold: true }),
  toolTitle: (): Style => ({ fg: palette.textStrong, bold: true }),
  toolSummary: (): Style => ({ fg: palette.dim }),
  toolIn: (): Style => ({ fg: palette.codeFg, bg: palette.codeBg }),
  toolOut: (): Style => ({ fg: palette.dim }),
  text: (): Style => ({ fg: palette.text }),
  heading: (): Style => ({ fg: palette.accent, bold: true }),
  bullet: (): Style => ({ fg: palette.accentDim }),
  quote: (): Style => ({ fg: palette.dim, italic: true }),
  code: (): Style => ({ fg: palette.codeFg, bg: palette.codeBg }),
  inlineCode: (): Style => ({ fg: palette.codeFg, bg: palette.codeBg }),
  bold: (): Style => ({ fg: palette.textStrong, bold: true }),
  italic: (): Style => ({ fg: palette.text, italic: true }),
  link: (): Style => ({ fg: palette.link, underline: true }),
  note: (): Style => ({ fg: palette.warn }),
  // —— 下面这几个此前被 rows.ts 引用却没定义（style 为 undefined → 静默不上色）。
  // 现在每个键都显式声明，拼错会被 tsc 直接拦下，不用靠人眼。
  userPrompt: (): Style => ({ fg: palette.roleUser, bold: true }),
  thinkingHeader: (): Style => ({ fg: palette.dim, italic: true }),
  dim: (): Style => ({ fg: palette.dim }),
  paramKey: (): Style => ({ fg: palette.faint }),
  paramVal: (): Style => ({ fg: palette.codeFg }),
  // —— 欢迎块 / 无边框输入行（step 风格）——
  logo: (): Style => ({ fg: palette.purple }),
  infoLabel: (): Style => ({ fg: palette.dim }),
  infoValue: (): Style => ({ fg: palette.link }),
  tipCmd: (): Style => ({ fg: palette.accent, bold: true }),
  tipDesc: (): Style => ({ fg: palette.dim }),
  divider: (): Style => ({ fg: palette.border }),
  prefix: (): Style => ({ fg: palette.accent, bold: true }),
  placeholder: (): Style => ({ fg: palette.faint }),
} satisfies Record<string, () => Style>

/** 样式表：`styles.header` 是 accessor，值现算（见上方 live()）。 */
export const styles = live(stylesTable)

/**
 * 语法高亮 token。用的时候要和 `styles.code` 合并（保住代码块背景）——
 * syntax.ts 里的 seg() 已经这么做了。
 */
const syntaxTable = {
  comment: (): Style => ({ fg: palette.synComment, italic: true }),
  keyword: (): Style => ({ fg: palette.synKeyword }),
  string: (): Style => ({ fg: palette.synString }),
  number: (): Style => ({ fg: palette.synNumber }),
  fn: (): Style => ({ fg: palette.synFn }),
  type: (): Style => ({ fg: palette.synType }),
  literal: (): Style => ({ fg: palette.synLiteral }),
  diffAdd: (): Style => ({ fg: palette.diffAdded }),
  diffDel: (): Style => ({ fg: palette.diffRemoved }),
  diffMeta: (): Style => ({ fg: palette.diffMeta }),
} satisfies Record<string, () => Style>

/** 语法高亮 token：同样是 accessor（换主题自动跟）。 */
export const syntax = live(syntaxTable)

/**
 * 工具名 → 头部颜色。六色各占调色板一档（蓝 / 青 / 绿 / 黄 / 紫 / 红），
 * 扫一眼就知道这行在干什么；认不出来的工具退回 accent，不会没颜色。
 * 表在函数里现取 —— 换主题后自动跟。
 */
function toolColors(): Record<string, string> {
  return {
    read: palette.link,
    write: palette.ok,
    edit: palette.warn,
    bash: palette.accent,
    ls: palette.purple,
    grep: palette.synLiteral,
    search: palette.synLiteral,
  }
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
  return { fg: toolColors()[key] ?? palette.accent, bold: true }
}
