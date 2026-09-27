---
version: alpha
name: Verse Lyra
description: shadcn「Lyra」风格 + blue 主色的终端界面规范——零圆角、方正细描边、等宽字体、灰阶骨架配单一蓝色强调。
colors:
  background: "#0a0a0a"
  foreground: "#fafafa"
  card: "#171717"
  muted: "#262626"
  muted-foreground: "#a1a1a1"
  primary: "#193cb8"
  primary-foreground: "#eff6ff"
  accent: "#2b7fff"
  accent-dim: "#155dfc"
  link: "#8ec5ff"
  purple: "#ad46ff"
  ring: "#737373"
  border: "#222222"
  input: "#2f2f2f"
  destructive: "#ff6467"
  ok: "#00bc7d"
  warn: "#fe9a00"
  syn-comment: "#525252"
  syn-keyword: "#ad46ff"
  syn-string: "#00bc7d"
  syn-number: "#fe9a00"
  syn-fn: "#2b7fff"
  syn-type: "#8ec5ff"
  syn-literal: "#ff2056"
typography:
  body:
    fontFamily: ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace
    fontSize: 1rem
    lineHeight: 1
  label:
    fontFamily: ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace
    fontSize: 1rem
    fontWeight: 700
    lineHeight: 1
  caption:
    fontFamily: ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace
    fontSize: 1rem
    lineHeight: 1
rounded:
  none: 0px
spacing:
  cell: 1x
  block-gap: 1x
components:
  status-bar:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  status-bar-active:
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  tips-column:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  tips-column-mode:
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  divider:
    textColor: "{colors.border}"
    height: 1x
    rounded: "{rounded.none}"
  composer:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  completion-popup:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  picker-item-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  welcome-block:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  tool-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-block:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    padding: "{spacing.cell}"
    rounded: "{rounded.none}"
  code-keyword:
    textColor: "{colors.syn-keyword}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-function:
    textColor: "{colors.syn-fn}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-type:
    textColor: "{colors.syn-type}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-string:
    textColor: "{colors.syn-string}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-number:
    textColor: "{colors.syn-number}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-literal:
    textColor: "{colors.syn-literal}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-comment:
    textColor: "{colors.syn-comment}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  diff-add:
    textColor: "{colors.ok}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  diff-del:
    textColor: "{colors.destructive}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  note-callout:
    textColor: "{colors.warn}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  hyperlink:
    textColor: "{colors.link}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  muted-panel:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  focus-ring:
    textColor: "{colors.ring}"
    rounded: "{rounded.none}"
  input-outline:
    backgroundColor: "{colors.input}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  brand-mark:
    textColor: "{colors.purple}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
---

# Verse Lyra

## Overview

Verse 是一个**终端**里的流式 agent 界面。它的视觉语言直接取自 shadcn/create 的 **Lyra** 风格：
零圆角（`rounded-none`）、方正而锐利（*boxy and sharp*）、为等宽字体而生。shadcn 官方对 Lyra 的定位就是
「developer tools, terminals, and technical interfaces」—— 终端界面本来就是它的主场，不需要改造，
只需要把它的规则翻译成终端能表达的形式。

配色是 shadcn 的 **neutral 骨架 + blue 主题**。所有色值都不是挑出来的，而是 registry 真值经
oklch→sRGB（Oklab 公式）换算得到的十六进制；对比度按 WCAG 逐条核过（见 Colors）。

三条不可协商的规则：

1. **圆角恒为 0**。终端里的框线只有直角：`┌ ┐ └ ┘ ─ │`。禁止圆角字符（`╭ ╮ ╰ ╯`）与双线框（`╔ ═ ║`）。
2. **层次靠明度 + 字重 + 描边，不靠色相**。颜色是语义信号（强调 / 成功 / 警告 / 错误 / 语法类型），不是装饰。
3. **颜色永远是 token**。任何组件里写裸 hex 都算违规——token 的唯一来源是 `src/core/theme.ts` 的 `palette`，
   与本文档 front matter 逐项同值，由 `src/probes/lyra-tokens.ts` 断言守着。

## Colors

色板分四类，用的时候别串门。

**骨架（中性）**——承载 95% 的像素。正文 `{colors.foreground}`，次要文字 `{colors.muted-foreground}`，
最弱信息 `{colors.ring}`，填充面 `{colors.card}` 与 `{colors.muted}`，描边 `{colors.border}`，
可交互控件的描边 `{colors.input}`。

**主色（blue）**——只有一个蓝，分三档明度，用途严格区分：

| token | 值 | 对底对比度 | 用途 |
|---|---|---|---|
| `{colors.primary}` | `#193cb8` | **2.24:1** | **只做填充底**：选中项、强调面 |
| `{colors.primary-foreground}` | `#eff6ff` | 对 primary 8.11:1 | 压在 primary 上的字 |
| `{colors.accent}` | `#2b7fff` | **5.26:1** | 强调**前景**：命令名、模型名、标题、工具头 |
| `{colors.accent-dim}` | `#155dfc` | 3.77:1 | 次级前景：用户标记、列表点 |
| `{colors.link}` | `#8ec5ff` | 10.92:1 | 链接、键值里的值 |

> **这张表里最容易踩的一条**：shadcn 的 `primary` 是「按钮填充色」的语义，暗色主题下它是**深蓝**
> （L=0.424），对暗底只有 2.24:1 —— 低于 AA 正文(4.5:1)，甚至低于 AA 大字号(3:1)。
> 所以在终端里 **它永远不做文字色**，只做底；强调文字一律交给 `{colors.accent}`（亮蓝，5.26:1）。
> 这两条互为约束：改了其中一个的明度，另一个的用途就要重新审。

**语义与语法**——取自 shadcn 默认 chart 调色板（dark）：成功 `{colors.ok}`、警告 `{colors.warn}`、
错误 `{colors.destructive}`；语法高亮 `{colors.syn-keyword}`（关键字）、`{colors.syn-fn}`（函数名）、
`{colors.syn-type}`（类型名）、`{colors.syn-string}`（字符串）、`{colors.syn-number}`（数字）、
`{colors.syn-literal}`（字面量）、`{colors.syn-comment}`（注释，刻意压到 2:1，靠 italic 与正文区分）。

**对比度底线**：正文 ≥ 7:1，次要文字 ≥ 4.5:1，装饰性/非文本（注释、描边）≥ 2:1。文档里的每个值都经此校验，
改色前先算，别凭眼睛。

## Typography

终端只有一种字体宽度（等宽）与三种字形（normal / bold / italic / underline），**没有字号**。
所以层级不能靠"大小"，只能靠**字重 + 明度**：

- 正文 —— `{typography.body}`：常规字重，`{colors.foreground}`。
- 标签 —— `{typography.label}`：bold，配 `{colors.accent}` 或 `{colors.foreground}`。用于命令名、模型名、工具名、活跃状态。
- 弱化 —— `{typography.caption}`：常规字重，`{colors.muted-foreground}`。用于元信息、说明、路径。
- 强调弱化 —— italic + `{colors.muted-foreground}`：思考过程、引用。

等宽是 Lyra 的强制项（官方："pairs well with mono fonts"），在终端里天然满足；
但它带来一条义务：**该对齐的必须对齐**。列头、键值、工具行参数、diff 标记都按固定列位排，
不用空格凑。数值（token 数、耗时）右对齐到固定列。

## Layout

- **两列**：终端宽 ≥ 90 列时开右列（固定 34 列宽：模式区 + Tips + 快捷键），左列放会话转写；
  窄于 90 列自动收起，转写占满整宽。列宽是唯一来源（`src/ui/layout.ts`），组件里不许再写数字。
- **行高恒为 1 cell**，没有 margin / padding 概念；块与块之间的呼吸靠**一个空行**，不靠缩进。
- **全宽元素**不参与分栏：输入行、两条分割线、状态栏。
- **状态栏**分左右两段，左 = 模型 + 后端行为态，右 = 连接 + 用量。窄终端按优先级丢段
  （cwd → cache → 耗时 → ctx → in/out → 模型名 → tools → 思考强度 → harness → 会话名），
  运行相位段**永不丢**。

## Elevation & Depth

终端没有阴影、模糊、透明度。表达层次只有三种手段，按优先级使用：

1. **明度**（首选）：`{colors.foreground}` > `{colors.muted-foreground}` > `{colors.ring}`。
2. **描边**：1 cell 细线。结构性区域用 `{colors.border}`，可交互控件用 `{colors.input}`（略亮 = 略"近"）。
3. **填充**：`{colors.card}`（代码块、内嵌块）、`{colors.muted}`（次级面）、`{colors.primary}`（选中/激活面）。

弹窗**不抬高**（没有 drop shadow 可借），用描边 + 同底色表达；选中项用**填充**而不是亮色文字——
这是 Lyra 的"方"：状态变化靠色块位移，不靠发光。

## Shapes

- 圆角：一律 `{rounded.none}`（0px）。终端里即"只用直角线"。
- 描边：1 cell。不加粗、不双线、不斜角、不加装饰性边饰。
- 角：框的四角用 `┌ ┐ └ ┘`。T 形接口用 `├ ┤ ┬ ┴`，交叉用 `┼`。
- 选中/激活：整块填 `{colors.primary}` + 字色 `{colors.primary-foreground}`；**不加**下划线或边框装饰。
  （对应 shadcn 的 `bg-primary text-primary-foreground`；`active:translate-y-px` 那种位移在终端里没有等价物，忽略。）
- 焦点：用 `{colors.input}` 描边，而不是发光环。（shadcn Lyra 的 `focus-visible:ring-1` 是细环，不是粗环。）

## Components

| 组件 | 底 | 字 | 排版 | 备注 |
|---|---|---|---|---|
| `status-bar` | `{colors.background}` | `{colors.muted-foreground}` | `{typography.caption}` | 全宽，相位段 `{colors.accent}` + bold |
| `status-bar-active` | — | `{colors.accent}` | `{typography.label}` | 活跃相位、模式标签 |
| `tips-column` | `{colors.background}` | `{colors.muted-foreground}` | `{typography.caption}` | 右列，竖线用 `{colors.border}` |
| `tips-column-mode` | — | `{colors.accent}` | `{typography.label}` | 当前 harness 模式 + 一行说明 |
| `divider` | `{colors.border}` | — | — | 1 行高 `─`，输入行上下各一条 |
| `composer` | `{colors.background}` | `{colors.foreground}` | `{typography.body}` | 无边框，提示符 `{colors.accent}` + bold |
| `completion-popup` | `{colors.background}` | `{colors.foreground}` | `{typography.caption}` | 选中项 `picker-item-selected` |
| `picker-item-selected` | `{colors.primary}` | `{colors.primary-foreground}` | `{typography.body}` | 唯一的填充式选中态 |
| `welcome-block` | `{colors.background}` | `{colors.muted-foreground}` | `{typography.body}` | 框线 `{colors.border}`，logo 用 `{colors.purple}` |
| `tool-row` | `{colors.background}` | `{colors.foreground}` | `{typography.body}` | 头部按工具取色（见下） |
| `code-block` | `{colors.card}` | `{colors.foreground}` | `{typography.body}` | padding 1 cell，语法色见 Colors |
| `diff` | `{colors.card}` | — | `{typography.caption}` | 增 `{colors.ok}`、删 `{colors.destructive}`、meta `{colors.accent}` |

工具头六色各占一档，便于扫视辨识：`bash` = `{colors.accent}`（最常用 → 最醒目）、
`read` = `{colors.link}`、`write` = `{colors.ok}`、`edit` = `{colors.warn}`、`ls` = `{colors.purple}`、
`grep` = `{colors.syn-literal}`。认不出的工具退回 `{colors.accent}`，不会出现无色行。

## Do's and Don'ts

**Do**

- 用 `{colors.accent}` 做强调**前景**，用 `{colors.primary}` 做**填充底**；配 `{colors.primary-foreground}` 读选中态。
- 层次不足时，先加 **bold** 或拉开**明度**，最后才考虑引入新颜色。
- 代码块用 `{colors.card}` 填充 + 无描边；结构性分隔用 `{colors.border}` 细线。
- 新增颜色前，先在 shadcn registry（`colors/*.json`、`themes.ts`）里找现成 token 换算，别自己调色。

**Don't**

- **别把 `{colors.primary}` 当文字色**（2.24:1，看不清）。这是本规范最容易犯的错。
- 别引入 token 之外的色相。`{colors.purple}` 只给欢迎块 logo，语法高亮只用 `syn-*` 那一组。
- 别用圆角字符（`╭ ╮ ╰ ╯`）、双线框（`╔ ═ ║`）或任何装饰性边饰——它们是 Lyra 的反面。
- 别用"浅灰 vs 深灰"在 16 色终端里表达层级：灰阶在低色终端会糊成一团，必须同时用 bold 或反白承载。
- 别在组件里写裸 hex；也别让 `src/core/theme.ts` 和本文档的 front matter 漂移（探针会红）。

## Appendix: light 变体（非 normative）

未来若支持浅色终端，按 shadcn neutral + blue 的 **light** 真值换骨架即可，形状与排版规则不变：

| token | light 值 | 来源 |
|---|---|---|
| background | `#ffffff` | `oklch(1 0 0)` |
| foreground | `#0a0a0a` | `oklch(.145 0 0)` |
| card | `#ffffff` | `oklch(1 0 0)` |
| muted | `#f5f5f5` | `oklch(.97 0 0)` |
| muted-foreground | `#737373` | `oklch(.556 0 0)` |
| border | `#e5e5e5` | `oklch(.922 0 0)` |
| primary | `#155dfc` | blue light `oklch(.488 .243 264.376)` |
| primary-foreground | `#eff6ff` | `oklch(.97 .014 254.604)` |

注意 light 下 `primary` 是**亮蓝**、对比度反而够用 —— 判据（见 Colors）是相对暗底得出的，换底必须重算。
