---
version: alpha
name: Verse TUI
description: 终端 agent 界面规范——颜色取自 Kimi Code CLI 的 19 个 token（可被自定义主题覆盖），形状取自 shadcn「Lyra」（零圆角、方正细描边、等宽字体）。
colors:
  primary: "#4FA8FF"
  accent: "#5BC0BE"
  text: "#E0E0E0"
  textStrong: "#F5F5F5"
  textDim: "#888888"
  textMuted: "#6B6B6B"
  border: "#5A5A5A"
  borderFocus: "#E8A838"
  success: "#4EC87E"
  warning: "#E8A838"
  error: "#E85454"
  diffAdded: "#4EC87E"
  diffRemoved: "#E85454"
  diffAddedStrong: "#7AD99B"
  diffRemovedStrong: "#F08585"
  diffGutter: "#6B6B6B"
  diffMeta: "#888888"
  roleUser: "#FFCB6B"
  shellMode: "#BD93F9"
  background: "#0A0A0A"
  surface: "#1A1A1A"
  primaryFg: "#0A0A0A"
  synComment: "#6B6B6B"
  synKeyword: "#BD93F9"
  synString: "#4EC87E"
  synNumber: "#E8A838"
  synFn: "#4FA8FF"
  synType: "#5BC0BE"
  synLiteral: "#E85454"
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
    textColor: "{colors.textDim}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  status-bar-active:
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  tips-column:
    backgroundColor: "{colors.background}"
    textColor: "{colors.textDim}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  tips-column-mode:
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  divider:
    textColor: "{colors.border}"
    height: 1x
    rounded: "{rounded.none}"
  composer:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  composer-placeholder:
    backgroundColor: "{colors.background}"
    textColor: "{colors.textMuted}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  completion-popup:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  picker-item-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primaryFg}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  welcome-block:
    backgroundColor: "{colors.background}"
    textColor: "{colors.textDim}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  tool-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-block:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.textStrong}"
    typography: "{typography.body}"
    padding: "{spacing.cell}"
    rounded: "{rounded.none}"
  code-keyword:
    textColor: "{colors.synKeyword}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-function:
    textColor: "{colors.synFn}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-type:
    textColor: "{colors.synType}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-string:
    textColor: "{colors.synString}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-number:
    textColor: "{colors.synNumber}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-literal:
    textColor: "{colors.synLiteral}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  code-comment:
    textColor: "{colors.synComment}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  diff-add:
    textColor: "{colors.diffAdded}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  diff-add-inline:
    textColor: "{colors.diffAddedStrong}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  diff-del:
    textColor: "{colors.diffRemoved}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  diff-del-inline:
    textColor: "{colors.diffRemovedStrong}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  diff-gutter:
    textColor: "{colors.diffGutter}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  diff-meta:
    textColor: "{colors.diffMeta}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  user-message:
    backgroundColor: "{colors.background}"
    textColor: "{colors.roleUser}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  accent-emphasis:
    backgroundColor: "{colors.background}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  note-callout:
    textColor: "{colors.warning}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  success-mark:
    textColor: "{colors.success}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  error-mark:
    textColor: "{colors.error}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
  attention-outline:
    textColor: "{colors.borderFocus}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  hyperlink:
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  shell-prompt:
    textColor: "{colors.shellMode}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  focus-ring:
    textColor: "{colors.border}"
    rounded: "{rounded.none}"
  input-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
  brand-mark:
    textColor: "{colors.shellMode}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
---

# Verse TUI

## Overview

Verse 是一个**终端**里的流式 agent 界面。它的视觉语言由两半拼成：

- **颜色**取自 **Kimi Code CLI**：19 个按用途命名的 token（`primary` 是链接与选中、`roleUser` 是用户消息、
  `diffGutter` 是 diff 行号槽……）。这套名字还有个额外好处：**主题文件互通** —— 从 Kimi 抄来的
  `~/.kimi-code/themes/*.json` 可以直接放进 `<VERSE_HOME>/themes/` 用（见 Theming）。
- **形状**取自 shadcn/create 的 **Lyra**：零圆角、方正而锐利（*boxy and sharp*）、为等宽字体而生。
  shadcn 官方对 Lyra 的定位就是「developer tools, terminals, and technical interfaces」。

三条不可协商的规则：

1. **圆角恒为 0**。终端里的框线只有直角：`┌ ┐ └ ┘ ─ │`。禁止圆角字符（`╭ ╮ ╰ ╯`）与双线框（`╔ ═ ║`）。
2. **层次靠明度 + 字重 + 描边，不靠色相**。颜色是语义信号（强调 / 成功 / 警告 / 错误 / 语法类型），不是装饰。
3. **颜色永远是 token**。组件里写裸 hex 一律违规；token 唯一来源是 `src/core/theme.ts` 的 `palette`
   （由主题的 19 个 token 派生），与本文档 front matter 逐项同值，由 `src/probes/theme-tokens.ts` 断言守着。

## Colors

色板分三类，用的时候别串门。下表的对比度是**实测值**（WCAG 相对亮度，底 = `{colors.background}`），
不是估的 —— 改色前先算，别凭眼睛。

**骨架（中性）**——承载 95% 的像素。正文 `{colors.text}`，次要 `{colors.textDim}`，最弱 `{colors.textMuted}`，
填充面 `{colors.surface}`，描边 `{colors.border}`，需要"请你看这里"的边框用 `{colors.borderFocus}`。

**强调**——`{colors.primary}` 是**前景**语义（链接、行内代码、当前项、聚焦、徽章），
`{colors.accent}` 是次级强调，`{colors.roleUser}` 专给用户消息（暖黄，与助手输出天然区分），
`{colors.shellMode}` 是品牌紫（本站没有 shell 模式，它落在 logo 与语法关键字上）。

| token | 值 | 对底对比度 | 用途 |
|---|---|---|---|
| `{colors.primary}` | `#4FA8FF` | **7.90:1** | 最常用色：链接、行内代码、选中项、聚焦边框 |
| `{colors.accent}` | `#5BC0BE` | **9.17:1** | 次级强调：提示符、面板、图片占位 |
| `{colors.text}` | `#E0E0E0` | **15.00:1** | 正文、Markdown 标题、列表符号 |
| `{colors.textStrong}` | `#F5F5F5` | **18.16:1** | 加粗强调、代码正文、工具标题 |
| `{colors.textDim}` | `#888888` | **5.58:1** | 次级、变暗：思考、提示、已完成项、引用 |
| `{colors.textMuted}` | `#6B6B6B` | **3.72:1** | 最浅文字：计数、滚动信息、链接 URL、代码块边框 |
| `{colors.border}` | `#5A5A5A` | **2.87:1** | 面板与编辑器普通边框、分隔线 |
| `{colors.borderFocus}` | `#E8A838` | **9.51:1** | 聚焦 / 注意边框（plan 模式提示） |
| `{colors.success}` | `#4EC87E` | **9.32:1** | 成功态：`✓`、已启用、完成 |
| `{colors.warning}` | `#E8A838` | **9.51:1** | 警告态：auto/yolo 徽章、过期标记、plan 提示 |
| `{colors.error}` | `#E85454` | **5.49:1** | 错误态：错误信息、失败的工具输出 |

`{colors.primaryFg}`（`#0A0A0A`）是压在 `{colors.primary}` 上的字色，对 primary **7.90:1**——
亮蓝底必须压深字，压白字读不了。

**diff 六色**——`{colors.diffAdded}` / `{colors.diffRemoved}` 是整行色，
`{colors.diffAddedStrong}` / `{colors.diffRemovedStrong}` 是**行内改动**的加粗高亮，
`{colors.diffGutter}` 画行号槽，`{colors.diffMeta}` 画 hunk 头。

**语法高亮**（本站派生，Kimi 未定义 token）：`{colors.synKeyword}`（关键字，借 shellMode 紫）、
`{colors.synFn}`（函数名，借 primary）、`{colors.synType}`（类型名，借 accent）、
`{colors.synString}`（字符串，借 success）、`{colors.synNumber}`（数字，借 warning）、
`{colors.synLiteral}`（字面量，借 error）、`{colors.synComment}`（注释，借 textMuted）。
规则写死在 `theme.ts` 的 `derive()` 里：**不引入体系外的色**，换主题时语法色跟着一起换。

**对比度底线**：正文 ≥ 7:1，次要文字 ≥ 4.5:1，装饰性/非文本（`diffGutter`、`textMuted`、`border`）≥ 2:1。

> **刻意保留的一条偏离**：`{colors.textMuted}`（3.72:1）低于 AA 正文线。它是「最浅文字」档，
> 只用于**元信息与占位符**（注释、计数、工具参数键、输入行占位符）—— 这些内容不需要被优先读。
> `designmd lint` 会对引用它的组件报 1 条对比度 warning，那是**故意留着的**：把它提到 4.5:1
> 就与 `{colors.textDim}`（5.58:1）拉不开差距，明度层级反而塌掉。

## Theming

主题是**数据**，不是代码：换主题不改任何组件，只换 palette 的值。

**默认**：内置 `dark`（上表）与 `light`（见 Appendix）两套基准，值与 Kimi Code 文档的 dark / light 两列逐项一致。

**自定义**：把 JSON 放进 `<VERSE_HOME>/themes/`（`VERSE_HOME` 默认 `~/.verse`），文件名即主题名
（`ember.json` → `/theme` 里显示 `Custom: ember`）。schema 与 Kimi 相同：

```json
{
  "name": "ember",
  "displayName": "Ember",
  "base": "dark",
  "colors": { "primary": "#83A598", "accent": "#FE8019" }
}
```

- `name` 必填（缺省用文件名）；`displayName` 可选；`base` 只认 `"dark"` / `"light"`（默认 `dark`）。
- `colors` 只写想覆盖的 token，其余自动沿用 `base` 调色板 —— 做浅色主题**必须**写 `"base": "light"`，
  否则没写的 token 会沿用 dark 值，在浅底上不可读。
- 色值必须是 `#` + 6 位十六进制。**任何一项不合法就只丢那一项**（其余照常生效）；无法识别的 token 忽略；
  JSON 坏掉 / 结构不对只跳过那一个文件，不影响其它主题（Kimi 的「尽量别打断你」）。

**选用**：`/theme` 选择器（每次打开重扫目录，新增主题文件**不用重启**），或直接 `/theme ember`；
要常驻就写 `tui.toml` 的 `theme = "ember"`（`/theme` 只做**会话内**切换，不代改你的配置文件）。

**两条实现约定**：

- 主题文件由**后端**读（前端不读配置文件与业务环境变量）—— 这是本项目与 Kimi 唯一的结构差异，
  见 `backend/theme.py` 与协议里的 `theme/list` / `theme/set`。
- `{colors.background}` 与 `{colors.surface}` 是本站补的：Kimi 认为终端底色归终端管。它们随 `base` 走
  （dark 取 `#0A0A0A` / `#1A1A1A`，light 取 `#FFFFFF` / `#F0F0F0`），**不属于主题 token**。

## Typography

终端只有一种字体宽度（等宽）与三种字形（normal / bold / italic / underline），**没有字号**。
所以层级不能靠"大小"，只能靠**字重 + 明度**：

- 正文 —— `{typography.body}`：常规字重，`{colors.text}`。
- 标签 —— `{typography.label}`：bold，配 `{colors.primary}` 或 `{colors.text}`。用于命令名、模型名、工具名、活跃状态。
- 弱化 —— `{typography.caption}`：常规字重，`{colors.textDim}`。用于元信息、说明、路径。
- 强调弱化 —— italic + `{colors.textDim}`：思考过程、引用。

等宽是 Lyra 的强制项（官方：\"pairs well with mono fonts\"），在终端里天然满足；但它带来一条义务：
**该对齐的必须对齐**。列头、键值、工具行参数、diff 标记都按固定列位排，不用空格凑；
按列号写断言必须用 `cellWidth()` 累加（中文占 2 列，字符串下标会错位）。

## Layout

- **两列**：终端宽 ≥ 90 列时开右列（固定 34 列宽：模式区 + Tips + 快捷键），左列放会话转写；
  窄于 90 列自动收起，转写占满整宽。列宽唯一来源是 `src/ui/layout.ts`，组件里不许再写数字。
- **行高恒为 1 cell**，没有 margin / padding 概念；块与块之间的呼吸靠**一个空行**，不靠缩进。
- **全宽元素**不参与分栏：输入行、两条分割线、状态栏。
- **状态栏**分左右两段，左 = 模型 + 后端行为态，右 = 连接 + 用量。窄终端按优先级丢段
  （cwd → cache → 耗时 → ctx → in/out → 模型名 → tools → 思考强度 → harness → 会话名），
  运行相位段**永不丢**。

## Elevation & Depth

终端没有阴影、模糊、透明度。表达层次只有三种手段，按优先级使用：

1. **明度**（首选）：`{colors.text}` > `{colors.textDim}` > `{colors.textMuted}`。
2. **描边**：1 cell 细线。结构性区域用 `{colors.border}`，需要注意的用 `{colors.borderFocus}`。
3. **填充**：`{colors.surface}`（代码块、内嵌块）、`{colors.primary}`（选中 / 激活面）。

弹窗**不抬高**（没有 drop shadow 可借），用描边 + 同底色表达；选中项用**填充 + 反白字**而不是亮色文字——
这是 Lyra 的"方"：状态变化靠色块位移，不靠发光。

## Shapes

- 圆角：一律 `{rounded.none}`（0px）。终端里即"只用直角线"。
- 描边：1 cell。不加粗、不双线、不斜角、不加装饰性边饰。
- 角：框的四角用 `┌ ┐ └ ┘`。T 形接口用 `├ ┤ ┬ ┴`，交叉用 `┼`。
- 选中 / 激活：整块填 `{colors.primary}` + 字色 `{colors.primaryFg}`；**不加**下划线或边框装饰。
- 焦点：用 `{colors.borderFocus}` 描边，而不是发光环。

## Components

| 组件 | 底 | 字 | 排版 | 备注 |
|---|---|---|---|---|
| `status-bar` | `{colors.background}` | `{colors.textMuted}` | `{typography.caption}` | 全宽，相位段 `{colors.primary}` + bold |
| `status-bar-active` | — | `{colors.primary}` | `{typography.label}` | 活跃相位、模式标签 |
| `tips-column` | `{colors.background}` | `{colors.textDim}` | `{typography.caption}` | 右列，竖线用 `{colors.border}` |
| `tips-column-mode` | — | `{colors.primary}` | `{typography.label}` | 当前 harness 模式 + 一行说明 |
| `divider` | `{colors.border}` | — | — | 1 行高 `─`，输入行上下各一条 |
| `composer` | `{colors.background}` | `{colors.text}` | `{typography.body}` | 无边框，提示符 `{colors.primary}` + bold |
| `completion-popup` | `{colors.background}` | `{colors.text}` | `{typography.caption}` | 选中项 `picker-item-selected` |
| `picker-item-selected` | `{colors.primary}` | `{colors.primaryFg}` | `{typography.body}` | 唯一的填充式选中态 |
| `welcome-block` | `{colors.background}` | `{colors.textDim}` | `{typography.body}` | 框线 `{colors.border}`，logo 用 `{colors.shellMode}` |
| `tool-row` | `{colors.background}` | `{colors.text}` | `{typography.body}` | 头部按工具取色（见下） |
| `code-block` | `{colors.surface}` | `{colors.textStrong}` | `{typography.body}` | padding 1 cell，语法色见 Colors |
| `diff-add` / `diff-del` | `{colors.surface}` | `{colors.diffAdded}` / `{colors.diffRemoved}` | `{typography.caption}` | 整行增 / 删 |
| `diff-add-inline` / `diff-del-inline` | — | `{colors.diffAddedStrong}` / `{colors.diffRemovedStrong}` | `{typography.label}` | 行内改动加粗 |
| `diff-gutter` / `diff-meta` | — | `{colors.diffGutter}` / `{colors.diffMeta}` | `{typography.caption}` | 行号槽 / hunk 头 |
| `user-message` | `{colors.background}` | `{colors.roleUser}` | `{typography.label}` | 用户消息与技能激活名 |
| `note-callout` | — | `{colors.warning}` | `{typography.body}` | 提示类系统消息（⚠ / note 行） |
| `success-mark` / `error-mark` | — | `{colors.success}` / `{colors.error}` | `{typography.caption}` | `✓` / 工具失败 |
| `attention-outline` | — | `{colors.borderFocus}` | `{typography.body}` | plan 模式等需要注意的边框 |
| `hyperlink` | — | `{colors.primary}` | `{typography.body}` | 带 underline（OSC8 链接元数据） |
| `shell-prompt` | — | `{colors.shellMode}` | `{typography.label}` | 预留：`!` shell 模式提示符 |

工具头六色各占一档，便于扫视辨识：`bash` = `{colors.primary}`（最常用 → 最醒目）、
`read` = `{colors.primary}`、`write` = `{colors.success}`、`edit` = `{colors.warning}`、
`ls` = `{colors.shellMode}`、`grep` = `{colors.synLiteral}`。认不出的工具退回 `{colors.primary}`，
不会出现无色行。

## Do's and Don'ts

**Do**

- 用 `{colors.primary}` 做强调**前景**（7.90:1，可以直接当正文色用）；做填充底时配 `{colors.primaryFg}`。
- 层次不足时，先加 **bold** 或拉开**明度**，最后才考虑引入新颜色。
- 代码块用 `{colors.surface}` 填充 + 无描边；结构性分隔用 `{colors.border}` 细线。
- 新增颜色前先在 Kimi 的 19 个 token 里找（`primary` / `accent` / `warning` …），实在没有再按 Colors
  里的派生规则扩展，并同步 `theme.ts`、`backend/theme.py` 与本文档三处。
- 用户消息一律 `{colors.roleUser}`（暖黄）—— 冷暖对比是"谁在说话"最快的信号。

**Don't**

- 别把 `{colors.textMuted}`（3.72:1）或 `{colors.border}`（2.87:1）当正文色 —— 它们只做元信息与线。
- 别引入 token 之外的色相。`{colors.shellMode}` 只给 logo / 关键字 /（未来的）shell 提示符，
  语法高亮只用 `syn-*` 那一组。
- 别用圆角字符（`╭ ╮ ╰ ╯`）、双线框（`╔ ═ ║`）或任何装饰性边饰——它们是 Lyra 的反面。
- 别用"浅灰 vs 深灰"在 16 色终端里表达层级：灰阶在低色终端会糊成一团，必须同时用 bold 或反白承载。
- 别在组件里写裸 hex；也别让 `theme.ts` / `backend/theme.py` / 本文档三者漂移（探针会红）。

## Appendix: light 基准（normative 值，非默认）

内置 `light` 基准 = Kimi Code light 一列的真值。自定义主题写 `"base": "light"` 时以它打底：

| token | light 值 | 对白底对比度 | 说明 |
|---|---|---|---|
| `{colors.primary}` | `#1565C0` | 5.75:1 | 深蓝（浅底上才够对比） |
| `{colors.accent}` | `#00838F` | 4.52:1 | 青 |
| `{colors.text}` | `#1A1A1A` | 17.40:1 | 正文 |
| `{colors.textStrong}` | `#1A1A1A` | 17.40:1 | 加粗（浅底无更亮可言） |
| `{colors.textDim}` | `#454545` | 9.59:1 | 次要 |
| `{colors.textMuted}` | `#5F5F5F` | 6.39:1 | 最浅 |
| `{colors.border}` | `#737373` | 4.74:1 | 描边 |
| `{colors.borderFocus}` | `#92660A` | 5.09:1 | 注意边框 |
| `{colors.success}` | `#0E7A38` | 5.44:1 | 成功 |
| `{colors.warning}` | `#92660A` | 5.09:1 | 警告 |
| `{colors.error}` | `#B91C1C` | 6.47:1 | 错误 |
| `{colors.roleUser}` | `#9A4A00` | 6.26:1 | 用户消息 |
| `{colors.shellMode}` | `#7C3AED` | 5.70:1 | 紫 |

diff 六色在 light 下取 `success` / `error` 系（`diffAdded` = `#0E7A38`、`diffRemoved` = `#B91C1C`，
Strong 两档同色）；`{colors.background}` 取 `#FFFFFF`、`{colors.surface}` 取 `#F0F0F0`
（代码正文对底 15.27:1）。

注意：上表的判据是**相对白底**得出的，与 dark 表不可混用 —— `primaryFg` 之类的派生值也随之变化
（浅底上它是深色，不再是近黑）。
