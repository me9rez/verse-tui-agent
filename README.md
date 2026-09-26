# Verse · 终端流式 agent

> 用 Vue 3 + [`@simon_he/vue-tui`](https://vue-tui.pages.dev/) 搭的终端 AI agent 界面：思考流、真实执行的工具调用、逐行增量渲染的 markdown，思考 / 工具块可折叠。
> A streaming terminal agent UI in Vue 3 — think / tool-call / answer panes with collapsible groups, TOML config via gateway, headless-verifiable.

![Verse](docs/demo.png)

![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%E2%89%A5%2022.18-brightgreen)

## 它是什么

一个克隆下来就能跑的终端 agent demo，重点在**流式链路与界面工程**，不在模型能力：

- **流式**：增量按物理行累积，视图只重绘脏行（双版本号：行的 `rev` + 数据源的 `version`）。
- **折叠**：每个「思考」和每次「工具调用」都是一个可折叠组，头部常驻、内容随状态显隐（`Ctrl+T` 最后一个 / `Ctrl+O` 全部 / 点标题）。
- **工具**：工具循环与执行在唯一 agent 后端（`backend/`，Python/Agent Framework），TUI 只渲染 `tool_start/line/end` 事件，`bash` 的 stdout **边跑边写进转写**。
- **两路会话**：离线 mock 剧本（默认，保证离线可演示）/ rpc 唯一 agent 后端 —— `/mock` `/rpc` 随时切。
- **配置全在 TOML**：`~/.verse/config.toml`（provider/模型，后端读）+ `~/.verse/tui.toml`（界面偏好）+ 项目级 `.verse/local.toml` 深合并覆盖；没有业务环境变量（唯一 `VERSE_HOME` 换目录）。见「配置」一节。
- **无头可验证**：vitest（`test/`）+ pytest（`backend/tests/`）双端套件，退出码即结论；关键结论用 `fs` 独立核对，不采信模型自述。

依赖极简：`node` 直接跑 TypeScript（类型剥离），**没有打包器、没有构建步骤**。

## 快速开始

```bash
pnpm install
mkdir -p ~/.verse && cp docs/config.example.toml ~/.verse/config.toml   # 填 provider/api_key；不填也能跑（默认离线 mock 剧本）
pnpm dev                # 交互式（默认开一个新会话）
pnpm backend            # 起唯一 agent 后端（Agent Framework，ws://127.0.0.1:8765）
pnpm dev -- --rpc        # TUI 接上后端（真实 agent 的标准姿势，详见 docs/architecture.md）

pnpm dev -- --continue          # 接着最近一次会话继续（转写与模型上下文一起恢复）
pnpm dev -- --list-sessions     # 列出落盘的会话（不进 TUI，无需 TTY）
pnpm dev -- --session 20260918-172237-uw3c   # 直接打开指定会话
```

> 注意 `--continue` / `--session` / `--rpc` 这些 flag 要用 `pnpm dev -- <flag>` 的形式（`pnpm dev --continue` 会被 pnpm 自己吞掉，
> 传不进脚本）。默认行为要改就写 `~/.verse/tui.toml`（如 `agent = "rpc"`，则 `pnpm dev` 直接接后端）。

要求 **Node ≥ 22.18**（`node` 直接跑 `.ts`，靠内置类型剥离，不需要任何 flag；23.6+/24 同样可以）。

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 交互式 TUI（需要真实 TTY；无 TTY 会直接提示去跑 `pnpm smoke`） |
| `pnpm test` | vitest 全量：smoke + sessions + complete + rpc 四文件（rpc 需 `pnpm backend`） |
| `pnpm smoke` | vitest：渲染 / 流式 / 折叠 / 颜色 / 落盘 27 项软断言（离线，不需要 key） |
| `pnpm complete` | vitest：slash 命令补全的按键链路 5 项（离线 mock） |
| `pnpm rpc` | vitest：WebSocket JSON-RPC 后端 8 项（需先起 `pnpm backend`） |
| `pnpm model` | vitest：`/model` 模型选择器 5 项（弹出/↑↓切换/Esc 取消/文本直切/mock 守卫，需后端） |
| `pnpm effort` | vitest：`/effort` 思考强度 5 项软断言（补全/mock 守卫/选择器回退/HELP 派生，离线） |
| `pnpm image` | vitest：Alt+V 贴图 4 项软断言（mock 守卫/能力门控/指示条，离线） |
| `pnpm hotkeys` | vitest：Alt+M/Alt+E 路由 + 状态栏 usage 格式化 10 项软断言（离线） |
| `pnpm sessions` | vitest：会话落盘 / 读回（含 usage 持久化）/ 重放 / 记录器 25 项（离线，用临时目录，不碰仓库） |
| `pnpm config-test` | pytest：后端 TOML 配置 11 函数 35 断言（深合并/overrides/新模型字段/脱敏/坏文件回退，离线） |
| `pnpm test:backend` | pytest 全量：25 函数 79 断言（protocol 十秒内；agent/switch 打真模型） |
| `pnpm shot` | 把跑完的一轮渲染成带色 HTML，便于出图 |
| `pnpm build` | tsdown 编译 `src/cli` 两个入口到 `dist/`（`bin`: `verse` → `dist/terminal.mjs`，带 shebang 可直接执行） |
| `pnpm typecheck` | `tsc -p tsconfig.json`（零报错） |
| `pnpm typecheck:backend` | pyright 检查 `backend/`（读 `backend/.venv`，零报错；配置在 `backend/pyproject.toml` 的 `[tool.pyright]`） |
| `pnpm lint:backend` | ruff 检查 `backend/`（零报错；`src` 配置在 `backend/pyproject.toml` 的 `[tool.ruff]`） |

## 配置：三份 TOML（Kimi Code 同款格式）

**配置的唯一读取者是 Python gateway**（`backend/config.py`）：前端一行配置文件都不读，开机连一次
gateway 的 `config/get`（JSON-RPC 2.0）拿脱敏视图；连不上（离线 mock）就用与后端同值的内置默认。

| 文件 | 读取者 | 内容 |
|---|---|---|
| `~/.verse/config.toml` | gateway | provider / 模型 / 端口（复制 `docs/config.example.toml` 改） |
| `~/.verse/tui.toml` | gateway（下发给 TUI） | `agent` / `speed` / `persist` / `session_dir` / `[shot]` / `[check]`（复制 `docs/tui.example.toml` 改） |
| `<repo>/.verse/local.toml` | gateway | 项目级覆盖，**深合并**（同 schema），已 gitignore |

- 三者按 `默认值 ← config.toml ← 项目 local.toml` 深合并（标量替换、表递归合并）；坏 TOML 只警告并回退，不中断启动。
- `[models."<别名>"]` 支持 Kimi Code 同款字段：`max_context_size` / `max_input_size` / `max_output_size`
  （配了即启用 harness 历史压缩）、`capabilities` / `support_efforts` / `default_effort` / `off_effort`
  （`/effort` 思考强度档位）、模型级 `base_url` 覆盖、`display_name` / `reasoning_key` / `adaptive_thinking`，
  以及 `[models."<别名>".overrides]` 覆盖子表（`provider`/`model`/`base_url` 三键不接受覆盖）——
  全部可选，不配 = 行为不变；字段明细见 `docs/config.example.toml`。
- 唯一环境变量 `VERSE_HOME`：整体换数据目录（此时配置变为 `$VERSE_HOME/config.toml`），对标 Kimi 的 `KIMI_CODE_HOME`。
- **一次性覆盖用 CLI flag**（每次运行生效）：`--rpc/--mock`、`--speed <n>`、`--url <ws://…>`、`--continue/-c`、`--session <id|last>`、`--debug-input`。
- 模型与密钥**只在 `config.toml`**：`config/get` 只回 `***set***`（或空串），明文 key 永不出后端。

进 TUI 后用 `/env` 随时看当前生效的配置（脱敏）：

```
gateway  127.0.0.1:8765 · model cn:hy3 · key 由后端持有（前端不接触）
providers  wb2api(openai) key ***set***
agent 工作区  <repo>/.agent-sandbox
tui  agent=rpc speed=1 persist=true · session_dir=…
配置文件  C:\Users\<you>\.verse\config.toml + <repo>\.verse\local.toml
```

## 交互

| 操作 | 说明 |
|---|---|
| `Enter` | 发送当前输入 |
| **`Alt+V`** | **粘贴剪贴板图片**（待发图片显示在输入行右端，随下一条消息发出，重复按覆盖；模型 `capabilities` 未声明 `image_in` 时后端自动降级为文本占位符，请求照常成功） |
| **`Alt+M`** | **弹出模型选择器**（= `/model` 无参；仅 rpc） |
| **`Alt+E`** | **弹出思考强度选择器**（= `/effort` 无参；仅 rpc） |
| `Esc` | 中断正在跑的这一轮（转写里写入「已中断」） |
| `Ctrl+End` | 视口跳回底部 |
| **`Ctrl+T`** | **折叠 / 展开最近一组**（思考或工具） |
| **`Ctrl+O`** | **折叠 / 展开全部分组** |
| **点标题** | 鼠标点分组标题也能折叠 / 展开（库画 ▸/▾ 并带命中区） |
| 滚轮 / `PgUp` | 翻历史；一旦你往上滚，新内容不再把你拽回底部 |
| **输入 `/`** | **命令自动补全**：↑↓ 选择 · Enter/Tab 采用（再按 Enter 发送）· 模糊匹配、与 `/help` 同一张命令表 |
| **Shift+Tab** | **切 harness 模式 plan ↔ execute**（仅 rpc；状态栏独立模式段显示当前值，plan 高亮；mock 提示不支持） |
| 命令 | `/help` `/clear` `/long` `/mock` `/rpc` `/env` `/fold` `/model [<id>]`（无参弹模型选择器，带 id 直切） `/effort [<档位>]`（无参弹思考强度选择器：low/medium/high/xhigh/max/off，带档位直切） `/exit` |
| 会话 | `/sessions` 列表（▶ = 当前）· `/open [序号\|id]`（无参弹选择器）切换 · `/new [标题]` 新建 · `/rename <标题>` 改名 · `/delete <序号\|id>` 删除 |

`/long` 会吐一段长回答，专门用来看长内容下的增量重绘与滚动保持。

## 排版与折叠

终端排版的可读性基本来自「层级 + 留白」，这里把两件事定死：

| 层级 | 缩进 | 例 |
|---|---|---|
| 用户消息 / 正文 / 分组头部 | 0 | `> 问题` · `▾ ● Bash(...)  · ok` · `▸ ✻ Thinking  · 2 行已折叠` |
| 组内 section | 2 | `params` · `out` |
| section 的值行 | 4 | `command: dir /b` · `357  src/session/rpc.ts` |

留白：每个块（用户消息 / 思考组 / 工具组 / 正文 / 提示）开始前插**一行空行**，由 `store.blank()` 统一处理 —— 它只在「上一行不是空行」时插入，所以不会出现连续空行。这一条是观感的关键。

噪音文案一律去掉：折叠行不重复「（点我展开）」（占位符与 /help 里各说一次就够），无参数的调用不打「（无参数）」，状态用 `· ok` / `· err` 与标题分开。工具输出**按原样显示**，不为了对齐去改工具自己的格式。

**流式进行中**：只有正在写的那一块是展开的，前面的组自动收起（截图是跑到第二个工具时的状态，状态栏显示 `Running tool…`）：

![流式中](docs/streaming.png)

**手动展开全部**（`Ctrl+O` 或点标题；工具带 `params` 块）：

![展开态](docs/fold-expanded.png)

```
▸ ✻ Thinking  · 2 行已折叠
▸ ● Read(src/transcript/store.ts)  · ok  · 19 行已折叠
▸ ● Bash(node -e "统计 src 下各文件行数")  · ok  · 34 行已折叠
```

三条实现事实都是实测出来的（探针留在 `src/probes/toolrow.ts` / `src/probes/foldmark.ts`）：

| 事实 | 做法 |
|---|---|
| 库的 `tool-call` row **能折叠**（自带 ▸/▾ 与点击命中区） | 头部行用 `kind: 'tool-call'`，`collapsed` 只用来驱动标记 |
| 但它的 `body` 是**段落式**：段内换行不断行，塞不下 params / 输出 | 内容行仍是独立 row，**显隐由数据源过滤**（`visibleEntries()` 按组过滤） |
| 折叠必须真的减少可见行 | `rowCount()` / `getRow()` 都走过滤后的行；`toggleGroup()` 里 `version++` 让视图重算 |

工具参数来自会话层的 `ToolStep.params`（rpc 后端在服务端把 function_call 参数拼完整后透传）。展示前每值截断到 120 字符，长文本显示成 `content: (43 字符)` 而不是啰嗦全文：

```
● Bash(node -e "统计 src 下各文件行数")  · ok
  params
    command: node -e "<walk src/*.ts and count lines>"
    timeout_ms: 20000
  out
    96  src/session/rpc.ts
    ...
```

**折叠规则（手风琴）**：一轮进行中只有**正在写的那块**展开，它一出现前面的组就自动收起；正文开始流式输出时（此时没有「当前组」）全部收起；**一轮结束（含 Esc 中断）后全部收起**。想细看就点标题或 `Ctrl+T`（最近一组）/ `Ctrl+O`（全部折叠或展开）。

规则落在两处：`store.soloExpand(keepId?)`（只留一个展开，或全部收起）与 `src/session/sink.ts` 里的四处调用——新建思考组 / 新建工具组 / 正文开始 / 回合收尾。想改回「工具组保持展开」，把 `finish()` 里那行 `store.soloExpand()` 删掉即可。

轨迹可以用探针一眼看全：

```bash
node src/probes/foldrule.ts
#   thinking  展开: thinking(1行)
#   tool      展开: tool(4行)          ← 思考组收起，当前工具组展开
#   tool      展开: tool(13行)         ← 第二个工具出现，前一个收起
#   answering 展开: （无，全部收起）    ← 正文开始
#   idle      展开: （无，全部收起）    ← 回合结束
```

> `pnpm rpc` 会真的打后端与模型端点：背靠背连续跑会撞上游 RPM 限流，
> 转写里出现 `[RPC 错误]` 时等一分钟再单跑一次即可，不是代码问题。

### 颜色：真彩 / 256 / 16 / 8 四级

配色统一用 hex 写在 `src/core/theme.ts`，渲染器按终端能力自动降级。下面是同一份 palette 在四种色深下**真实写出的字节**（`src/probes/color.ts` 抓的 stdout 渲染器原始输出，不是照文档抄的）：

| 模式 | 前景转义形式 | accent `#d97757` 实际写成 |
| --- | --- | --- |
| `truecolor` | `ESC[38;2;R;G;Bm` | `38;2;217;119;87` |
| `ansi256` | `ESC[38;5;Nm` | `38;5;173` |
| `ansi16` | `ESC[3xm` / `ESC[9xm` | `91m` |
| `ansi8` | `ESC[3xm` | `31m` |

粗体 / 斜体 / 反显（`ESC[1m` `ESC[3m` `ESC[7m`）在四种模式下都照常输出。

自动探测的顺序：`COLORTERM` 含 `truecolor`/`24bit` → `TERM_PROGRAM` 是 VS Code / WezTerm / Alacritty / Ghostty / Kitty / iTerm / Windows Terminal / Tabby / Hyper / Rio / Contour → Windows 下的 `WT_SESSION` 一类变量 → 回落看 `TERM` 里的 `256color` / `color` / `dumb`。输出不是 TTY 时直接按真彩走。可用 `VUE_TUI_COLOR_MODE=truecolor|ansi256|ansi16|ansi8` 强制指定（旧名 `DIMCODE_COLOR_MODE`）。

```bash
VUE_TUI_COLOR_MODE=ansi16 node src/probes/color.ts   # 按转义形式分类计数
```

> 缺口：库**不认 `NO_COLOR`**（43 个 dist 文件里一次都没出现），也没有单色档——`parseColorMode` 只认上面四个值。要彻底去色只能在终端侧做。

### 彩色输出：哪些地方真的有颜色

四级降级只是底色，具体配色分五类，全部集中在 `src/core/theme.ts`：

| 位置 | 上色方式 |
| --- | --- |
| **代码块** | 按围栏语言做语法高亮：关键字 / 字符串 / 数字 / 函数名 / 类型 / 注释 各一色。实现在 `src/core/syntax.ts`（约 200 行，关键字表驱动，**不引 shiki / highlight.js**——那些库产出 HTML 或主题 JSON，几百 KB 起步还得再映射回 ANSI） |
| **工具组头部** | 按工具类型上色：`read*` 蓝 · `write*` 绿 · `edit*` 琥珀 · `bash` 橙 · `ls` 青 · `grep` 品红。名字做前缀归一化，mock 剧本的 `Read(...)` 与后端的 `todos_add` / `read_file` 都认 |
| **工具参数** | `key:` 暗灰 + 值亮色分两段，扫参数时不用逐字读 |
| **分组头部** | 思考组暗色斜体，工具组按类型（见上），折叠后追加的「N 行已折叠」统一淡灰 |
| **其它** | 用户消息 `>` 前缀用 accent 色、状态栏按状态绿/红、markdown 行内 `code` 带底色、正文里的 `**粗体**`/`*斜体*`/链接各有样式 |

支持高亮的围栏语言：`ts` / `js` / `json` / `bash` / `yaml` / `diff`（` ```diff ` 的 `+` / `-` / `@@` 行红绿分明）；其它围栏回落成单色代码块——**认不出语言只损失颜色，不影响可读性**。

```bash
node src/probes/codecolor.ts    # 把「整行都是代码底色」的 row 连 style 一起打出来，看每段是什么颜色
```

写这段时被自己的断言抓出两个 bug（见「踩过的坑」最后两条）：围栏状态被流式增量翻转奇偶次、以及三个引用了但从未定义的样式 token 让整行静默不上色。

## 架构

```
src/
  cli/                   可执行入口
    terminal.ts            交互式 TUI：createTerminalApp + stdout 渲染器 + stdin driver + 退出清理
    shot.ts                出图：把跑完的 buffer 转成带色 HTML（多轮用 ;; 分隔）
  （断言已迁至根 test/：vitest 四文件，见「验证」一节）
  probes/                一次性探针：摸清库行为 + 排版回归
    toolrow.ts / foldmark.ts / foldrule.ts / indent.ts / layout.ts / color.ts / codecolor.ts / complete.ts / promptdebug.ts / welcomedump.ts / session-seed.ts
  ui/                    界面层
    App.ts                 组件装配：版面、命令、键盘、对外 AppApi
    layout.ts              版面坐标（layoutOf）
    texts.ts               命令表（/help 与 / 补全同源）、占位符与空态文案、状态行对齐、输入清洗
  session/               会话域（接缝 + 实现 + 落盘，一个概念一个目录）
    seam.ts                接缝类型（AgentSession / StreamStep / ToolStep / TurnSink）
    mock.ts                本地剧本（工具步骤真的起子进程）
    rpc.ts                 唯一 agent 后端客户端（WebSocket + JSON-RPC 2.0）
    sink.ts                TurnSink 实现：一轮对话的事件 → 转写分组
    persist/               落盘会话（model · store · recorder · replay）
  transcript/            转写域（entry → 可见行）
    types.ts               行 / 分组的类型（叶子模块，无依赖）
    markdown.ts            行级 markdown 与参数格式化（纯函数）
    rows.ts                entry → TTranscriptRow（缩进、折叠标记）
    store.ts               LineStream + TranscriptStore（分组、可见行过滤、版本号）
    index.ts               对外桶文件
  core/                  与界面/会话无关的底座
    config.ts / text.ts / theme.ts / syntax.ts / html.ts / brand.ts
```

导入方向是单向的：`test/probes/cli → ui → session → transcript → core`（`session/persist` 的重放依赖 transcript，transcript 依赖 core 的 theme/syntax），无反向依赖、无循环。`test/*` 与 `probes/*` 只通过 `ui/App.ts` 暴露的 `AppApi` 触碰界面，不 import 组件内部。

数据流：

```
会话层(本地剧本 / RPC 后端)  ──delta──▶  TranscriptStore  ──version──▶  TTranscriptView  ──只重绘脏行──▶  终端 buffer
```

版面按 plane 分区（库的 `TRenderPlane`）：transcript（空态欢迎块 / 正文，每 10~20ms 一次）、chrome（状态栏与分割线，每 100ms 一次）、**overlay（输入行 + 补全弹窗**，只在按键时）——正文刷 30 行也不会让输入框光标闪一下，补全弹窗必须在 overlay 平面（见「踩过的坑」）。

### 空态与输入行（step 风格）

- **欢迎块**（仅空态）：`v0.1.0` 边框标题 + 紫色像素 V logo + `model`/`cwd` 信息列 + `Tips`（三条命令，desc 与 `/help` 同源于 `COMMANDS`）；下面一行空态提示，再往下是留白。`model` 显示后端握手 `initialize.result.model` 的权威值（rpc 会话创建即连后端回填；`/model` 选择器或 `/model <id>` 切换后跟随更新），不是环境变量。
- **输入行**：`>` 前缀（accent 色）+ 无边框 `TInput` + 占位符 `问点什么（/ 补全命令 · Enter 发送 · Esc 中断）`，上方一条 `─` 分割线；输入 `/` 弹补全（弹窗画在输入行上方的 overlay 栈）。
- **状态栏**（底行，多段拼色）：`✻ ready · 模式 · harness 模式 · 模型 · cwd`（左）+ `会话 · in/out · ctx 占用 · cache 命中 · N tools`（右）。跑过 rpc 轮次后，右段显示 LLM 终态返回的真实 usage：`in 12.3k out 678`、`ctx 12.3k/200k 6%`（input / 当前模型 `max_context_size`，没配窗口只显示绝对值）、`cache 8.1k 66%`（端点缓存命中 token 与命中率，端点没回缓存信息就不显示）；usage 随轮次持久化在会话文件里，重进会话 / `/open` 切回自动回填最近一轮（`/new` `/mock` `/rpc` 切走即清空）；没跑过轮次退回本地 token 估算。窄终端从右往左自动丢段（先 cwd 后模型），永不换行溢出。`模型` 段与欢迎块同源（`displayModel` = 握手回填的后端 model id）。

## 唯一后端：Agent Framework（WebSocket + JSON-RPC 2.0）

**方向（见 `docs/architecture.md`）**：本仓库单仓 = TUI + `backend/`（Python），`backend/` 是唯一
agent 后端，所有 agent 能力统一用 Microsoft Agent Framework 的 harness（`create_harness_agent`：
todo/工具循环 + FileHistoryProvider 跨进程历史）在 `backend/` 内开发；TS 侧只做渲染与会话编排。
`live` / `ai` 两条旧实现**已删除**，`mock` 永久保留为离线测试夹具。

```bash
# 1. 起后端（= cd backend && uv run python rpc_server.py；首次先 cd backend && uv sync）
pnpm backend

# 2. 交互式接上
pnpm dev -- --rpc         # 或 tui.toml 设 agent = "rpc"，或 TUI 里敲 /rpc

# 3. 断言（协议级 + 无头端到端）
pnpm config-test        # pytest：配置 11 函数 35 断言
pnpm test:backend       # pytest 全量 25 函数 79 断言（或 uv run pytest tests/test_rpc_protocol.py -q 只跑协议）
pnpm rpc                # vitest：TUI↔后端真实链路 8 项
pnpm model              # vitest：/model 选择器 5 项
pnpm effort             # vitest：/effort 思考强度 5 项（离线）
```

协议（JSON-RPC 2.0 over WebSocket，**权威定义见 `backend/rpc_server.py` 模块 docstring**）：

```
请求   {"jsonrpc":"2.0","id":1,"method":"agent/chat","params":{"session":"vt-xxx","prompt":"…"}}
       可选 params.images = [{"media_type":"image/png","data":"<base64>"}]（≤4 张/单图 12MB；
       会话存原图为事实源，模型 capabilities 未声明 image_in 时请求前降级为文本占位符，
       result 附 images_omitted=N）
事件   {"jsonrpc":"2.0","method":"agent/event","params":{"event":{"type":"answer_delta","text":"…"}}}
       type: thinking_delta / thinking_end / tool_start / tool_line / tool_end / answer_delta
终态   {"jsonrpc":"2.0","id":1,"result":{"text":"…","usage":{…}}}    或 error
取消   agent/cancel → {"cancelled":bool}；被取消那轮的 chat 另收 -32001；忙时新 chat 收 -32003
```

几个刻意的点：

- **一个请求 = 一轮**：JSON-RPC 规范没有流式语义，用「事件通知在前、终态响应在后」的常见模式；
  客户端靠 `id` 把事件归到当前轮，响应到达即 `respond()` 返回（= 回合结束）。
- **会话状态在服务端**：客户端 `snapshot()` 只存 `serverSid`；历史由服务端 FileHistoryProvider
  按 `session` 落 JSONL（`backend/history/`），**重启 TUI 后 `/open` 恢复的会话能接上服务端已有上下文**。
- **工具行服务端拼好再推**：`function_call` 的 `arguments` 是增量分片，服务端等
  `finish_reason=tool_calls` 拼完整、JSON 解析后才发 `tool_start`（带完整 params），
  客户端不做参数拼接——协议里跨 chunk 的状态留在产生它的地方。
- **失败也是一等公民**：连不上 / 中途断开 → 转写里出现 `[RPC 错误] …`（rpc.test 用它做断言），
  不会静默挂起。

------

## 持久会话与多会话

一轮跑完（含 Esc 中断）就把这一轮落盘；`/open` 切回来时会**用同一套 store API 重放**转写
（实时看到的排版与重开看到的排版是同一条代码路径），并把模型上下文一起恢复。
Alt+V 贴的图片经历史 provider 以 data URI 随会话 JSONL 明文落盘、并在后续轮次重发——别贴敏感截图。

```bash
.verse-sessions/20260918-172237-uw3c.json   # 一会话一文件，默认在仓库根目录（已 gitignore）
```

```jsonc
{
  "v": 1,                                  // schema 版本；不兼容升级时 +1，坏文件会被跳过而不是崩
  "id": "20260918-172237-uw3c",
  "title": "这个 demo 的流式输出是怎么实现的？",   // 首条用户输入压平后截断 40 字
  "kind": "ai",                            // mock | live | ai | rpc
  "provider": { "host": "…", "model": "…" },     // 只记名字，**不存密钥**
  "turns": [
    {
      "user": "这个 demo 的流式输出是怎么实现的？",
      "thinking": ["…"],                   // 完整行（不是流式增量）
      "tools": [{ "name": "read_file", "arg": "…", "params": { "path": "…" }, "status": "ok", "out": ["102| …"] }],
      "answer": ["…"],
      "agentState": [ /* 仅 rpc 路：{sid}（服务端会话 id），用于恢复多轮上下文 */ ]
    }
  ]
}
```

三个开关：

| 开关 | 作用 |
|---|---|
| `tui.toml session_dir` | 换会话目录（空 = `<repo>/.verse-sessions`；测试用 `setSessionDir()` 指到临时目录） |
| `pnpm dev -- --continue` / `--session <id\|last>` | 启动时恢复会话 |
| `tui.toml persist = false` | 完全不写磁盘（此时 `/new` 只清空转写） |

取舍（有意为之）：

- **存「行」不存 delta**：重放等价的最小单位是行（`TranscriptStore` 的封行/围栏判定都发生在行粒度），
  存增量只会把文件放大十倍。
- **没有索引文件**：列表直接扫目录读每个文件（会话都很小），少一个需要维护同步的冗余结构。
- **空会话不落盘**：新建后第一次写出内容时才建文件，不给列表塞空壳。
- **`/open` 在流式中直接拒绝**（提示先 Esc）：少一条「中断 + 落盘 + 切换」的竞态路径。

> 隐私：会话文件是**明文**，里面是你和模型的对话内容。它已进 `.gitignore`，但别把不该落盘的
> 东西粘进对话；要彻底关掉就 `tui.toml persist = false`。

## 验证（实测）

无头套件退出码即结论；命令行不需要带任何配置（前端开机自动向 gateway 取 `config/get`，离线用内置默认；`rpc` 需要 `pnpm backend` 在跑，其余离线）。
**它们都不会往仓库的 `.verse-sessions/` 写东西**：`smoke` / `sessions` 用临时目录（`setSessionDir`），`rpc` / `complete` / 各 probes 传 `persist: false`：

| 命令 | 覆盖 | 断言数 |
|---|---|---|
| `pnpm smoke` | mock 剧本的渲染链路（vitest） | 27 软断言 |
| `pnpm rpc` | WebSocket JSON-RPC 后端的流式链路（vitest，需 `pnpm backend` 在跑） | 8 |
| `pnpm complete` | slash 命令补全的按键注入链路（vitest，离线 mock） | 5 |
| `pnpm effort` | `/effort` 思考强度：补全 / mock 守卫 / 选择器回退 / HELP 派生（vitest，离线 mock） | 5 |
| `pnpm config-test` | TOML 配置：三文件深合并 / overrides / Kimi 同款模型字段 / 脱敏 / 坏文件回退（pytest） | 35 |
| `backend/tests/test_rpc_*.py` | 协议级：握手/流式/上下文/工具/取消/错误码/model 切换/mode 切换/thinking 档位/images 校验/`config/get`（pytest，拆 protocol 31 + agent 7） | 38 |
| `backend/tests/test_switch.py` | 协议级：会话切换/隔离/重连恢复（pytest） | 6 |
| `pnpm sessions` | 会话落盘 / 读回（含 usage 持久化）/ 重放 / 记录器（vitest，临时目录） | 25 |

断言的是**事实**而不是「函数被调用过」。真实输出：

```
# pnpm smoke（离线）
✔ 流式是增量的 — 采样 224 次，version 跨度 499
✔ 产生了多帧提交 — commit 次数 521
✔ 思考与每次工具调用各自成组 — 3 个分组（1 个 thinking + 2 个 tool）
✔ 流式中只展开当前组（手风琴） — 采样 224 次，展开组数最大值 1（期望 ≤ 1）
✔ 回合结束后分组全部收起 — 3 个分组，收起 3 个
✔ 工具调用显示了参数 — 展开态工具组含 params 块：path: src/transcript/store.ts
✔ 折叠真的隐藏了内容行 — 可见行 88 → 29；折叠后仍能读到「合计」= false
✔ 展开真的恢复内容行 — 可见行 29 → 88（展开基线经显式展开取得，往返无损）
✔ 代码块按语言上色 — 5 行代码，合计 5 种前景色：#c9d1f2 #7fb3ff #c678dd #56b6c2 #6f7480
✔ 分组头部按类型上色 — 头部出现 4 种颜色：#8b8b93 #5a5a63 #7fb3ff #d97757

# pnpm complete（离线 mock，events.dispatch 注入按键）
✔ 输入 '/' 弹出命令补全 — 屏幕上出现 /help、/sessions、/new 的 detail 文案
✔ 查询 '/he' 收窄匹配 — 只剩 /help 的 detail，其余命令被过滤
✔ Enter 采用建议而非提交 — 弹窗收起（suppressed），转写里还没有 /help 的说明 note
✔ /help 被真正执行 — HELP note 出现在转写

# pnpm rpc（真实 WS + JSON-RPC，后端 cn:hy3 harness）
✔ RPC 后端真的在流式推事件 — 采样 155 次，version 跨度 96
✔ 没有 HTTP/网络/RPC 错误 — 转写里没有 [请求失败]/[流中断]/[RPC 错误]
✔ markdown 被解析成结构化行 — 行样式集合：code/plain/bullet
✔ 耗时合理 — 整轮 4.8s
```

两条断言纪律值得单独说：

- **折叠状态断言读的是行数据，不是屏幕像素**。屏幕受视口滚动影响，会变成 flaky 测试；`getRow()` 拿到的「喂给视图的东西」才是确定的。渲染是否真的落到终端上，另有从库的真实 buffer 读回屏幕文本的断言（`screenText()`）守着，两者分开。

产物落在 `.artifacts/`：`smoke-screen.txt`、`smoke-report.json`、`rpc-screen.txt`、`rpc-report.json`、`demo.html`。

## 踩过的坑

**库行为（`@simon_he/vue-tui` 1.1.11，全部实测）**

- **transcript 行是「段落式」的**：同一行里 segments 之间写换行符**不会**断行，所以这里按物理行拆 row，而不是「一条消息一个 row」。一开始按消息拆行时整段 markdown 挤成一坨。
- **`TInputBox` 的 `placeholder` 没接线**：types 里有、1.1.9 的实现里没渲染，所以输入提示放进了框线标题。
- **`TInputBox` 提交后不会自己清空**：把 `modelValue` 置空不生效（组件内部持有文本，也没 expose `clear()`），做法是提交后自增 `key` 强制重建输入框。这个坑是往 PTY 里连发两次 `/env` 才暴露的 —— 第二次提交的文本实际是 `/env/env`，掉进了「未知命令」分支。顺带加了控制字符清洗和 `debug_input`（`tui.toml` 或 `--debug-input`，把**原始提交文本按 JSON** 记进 `.artifacts/input-debug.log`）。
- **TBox 的内容必须做成 children**：欢迎块第一版把 logo/Tips 画成 TBox 的兄弟节点，结果整块内容被盒体自身的填充覆盖得只剩边框——TBox 的绘制发生在子树之后，兄弟节点必输。
- **TInput 的占位符要 `placeholderWhenFocused`**：默认 false，autoFocus 的输入框（我们恒定聚焦）永远不显示 placeholder；设 true 才有 step 那种常驻提示。
- **`/` 补全弹窗必须包在 `TRenderPlane plane="overlay"` 里**：弹窗是 prompt 插件画在 zIndex=1e4 独立栈上的；挂在 root 或 `'default'` 平面时，逐帧合并会吃掉内容行——实测框和最后一行在、前 6 行全空，flush 流里连 detail 都缺。挪进 `overlay` 平面后全部行稳定渲染（`pnpm complete` 4 项断言守着）。同一次实测还确认：`TInputBox` 不透传 `prompt*` props（types + 源码双验证），补全必须自己用 `TBox + TInput` 组合，`prompt*` 直接给 `TInput`。
- **Node 的类型剥离模式不支持构造函数参数属性**（`constructor(private x: T)` → `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。

**自己写的工具也得防**

- **`bash` 必须设输出上限，否则会堵死事件循环**：模型跑 `dir /b *.txt | find /c /v ""` 时，`find` 命中的是 git-bash 里的 MSYS 版本，变成全盘遍历、吐出几万行；每行都写进响应式 store 触发一次调度 → **事件循环被饿死，连 `setInterval` 心跳都停了**。现在的做法是：最多显示 200 行 / 64KB，超限杀进程树，并把 `%SystemRoot%\System32` 提到 PATH 最前面（让 Windows 的 `find.exe` 赢过 MSYS 的）。
- **Windows 上只等 `'close'` 事件不够**：孙子进程（`dir | find`）不退出时 `kill()` 杀不掉管道，工具会永远 pending。改成 `taskkill /T /F` 杀进程树 + `'exit'` 兜底 + 硬超时。
- **出图时 Chrome 的 `--screenshot=` 用相对路径会静默不写文件**（退出码 0，磁盘上还是旧图）：给绝对路径，并确认文件的修改时间变了再拿去用。

**自己写的数据源也会错得很隐蔽**

- **带副作用的状态判定不能放在「每次增量都会调」的函数里**：原先「遇到 ``` 就翻转 `inFence`」写在 `classOf()` 里，而 `classOf()` 对**未完成的行每个流式增量都会调一次**、封行时又调一次 → 同一个 ```` ```ts ```` 被翻转奇偶次，围栏状态时对时错（表现是代码块有时单色、有时压根没被当成代码）。现在围栏只在 `commit()`（封行，每行一次）里翻转，`classOf()` 是纯函数。
- **`styles` / `syntax` 别标成 `Record<string, Style>`**：那样 `styles.thinkingHeader` 这类拼错的键 tsc 查不出来，运行时拿到 `undefined` → 那一行**静默不上色**（终端不会报错）。本仓库曾有 3 个这样的引用（`thinkingHeader` / `userPrompt` / `dim`，其中 `dim` 影响所有工具输出行），改成强类型 const 后 tsc 立刻全部报出来。

## 已知边界

- **会话恢复依赖服务端**：rpc 路的 `agentState` 只存 `{sid}`，对话历史在 `backend/history/`；
  后端换了历史目录（`config.toml` 的 `[gateway] history`），旧会话就接不回模型上下文（转写仍可重放）。
- **多进程同时写同一个会话是 last-write-wins**：没有做文件锁。demo 场景够用，真要并发得先加锁。

- mock 剧本会在正文末尾明说「本段文本来自本地剧本，不是真实模型输出」—— 演示不假装真模型。
- 思考 / 工具的分组状态**不进会话历史**：重启后新会话是全新状态。
- 表格（`| a | b |`）不做特殊渲染，按原文输出。
- 折叠只影响**显示**：内容行仍在内存里（`visibleEntries()` 过滤），展开是瞬时且不重跑任何东西。
- 长回答的虚拟化依赖 `TTranscriptView` 内部实现，本项目未测帧率上限。
- 换行由库负责，**续行没有悬挂缩进**：折行后从第 0 列开始。要做悬挂缩进得按视口宽度预折行，而宽度随 resize 变，收益不抵复杂度。
- 工具输出按原样显示，所以工具自身的对齐（例如 `wc -l` 式数字右对齐）会保留。
- 每次 `pnpm rpc` 都会真的请求后端与模型端点：注意上游的 RPM 配额。

## 许可

MIT
