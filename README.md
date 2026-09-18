# Verse · 终端流式 agent（Vue 3 + @simon_he/vue-tui）

用 [`@simon_he/vue-tui`](https://vue-tui.pages.dev/)（Vue 3 的 terminal UI 组件库）搭的终端 agent demo，重点是**流式输出**：思考流 → 真实执行的工具调用 → 逐行增量渲染的 markdown 正文。

交互排版参考了 Claude Code 的转写形式（思考块 / 工具调用 / 可折叠分组），
组件、渲染、会话层与 AI SDK 工具循环都是本项目自己的实现。

![demo](.artifacts/demo.png)

## 跑起来

```bash
pnpm install
cp .env.example .env   # 填 provider（不填就默认离线 mock 剧本）
pnpm dev               # 交互式
pnpm smoke             # 无头验证：10 项渲染断言 + 9 项 .env 行为断言
pnpm typecheck         # tsc -p（不含 emit）
```

要求 Node ≥ 22（本 demo 直接用 `node src/cli/terminal.ts` 跑 TypeScript，靠 Node 自带的类型剥离，不需要 tsx/esbuild/打包器）。

## 配置：.env

provider 配置放 `.env`（已被 `.gitignore` 忽略），入口文件开头统一 `loadDotEnv()` 一次，之后正常读 `process.env`：

```bash
cp .env.example .env
# .env
VT_AGENT=ai                                     # mock（默认）| live | ai
VT_BASE_URL=https://88api.ai/v1                 # 任何 OpenAI 兼容端点
VT_MODEL=deepseek-v4.1-flash
VT_API_KEY=sk-...                               # 只在本机文件里，不进命令行/不进仓库
VT_AGENT_ROOT=./.agent-sandbox                   # 工具只能动这个目录
VT_SPEED=1
```

加载规则（有 9 项断言守着，见 `pnpm smoke` 第二段）：

| 规则 | 说明 |
|---|---|
| 顺序 | `.env` → `.env.local`，**后者覆盖前者** |
| 优先级 | **命令行/系统里已有的键永不被文件覆盖**（`VT_MODEL=... pnpm dev` 临时换模型很方便） |
| 坏行 | 只警告不中断启动 |
| 缺文件 | 静默跳过，没 `.env` 也能跑离线 mock |
| 密钥 | 只回报**键名**，值不进日志/终端/结果 |

进了 TUI 用 `/env` 可以随时看当前生效的配置（脱敏）：

```
provider  88api.ai · model deepseek-v4.1-flash · key 已设置(不回显)
agent 工作区  C:\workspace\vue-tui-demo\.agent-sandbox
.env  .env（带入 6 个键：VT_AGENT, VT_BASE_URL, VT_MODEL, VT_API_KEY, VT_AGENT_ROOT, VT_SPEED）
```

界面上能干什么：

| 操作 | 说明 |
|---|---|
| `Enter` | 发送当前输入 |
| `Esc` | 中断正在跑的这一轮（会写入「已中断」） |
| `Ctrl+End` | 视口跳回底部 |
| **`Ctrl+T`** | **折叠/展开最近一组**（思考或工具） |
| **`Ctrl+O`** | **折叠/展开全部分组** |
| **点标题** | 鼠标点分组标题也能折叠/展开（库画 ▸/▾ 并带命中区） |
| 滚轮 / `PgUp` | 翻历史；一旦你往上滚，新内容不再把你拽回底部 |
| `/help` `/clear` `/long` `/mock` `/live` `/ai` `/env` `/fold` `/exit` | 命令 |

`/long` 会吐一段长回答，专门用来看长内容下的增量重绘与滚动保持。

## 排版规则

终端排版的可读性基本来自"层级 + 留白"，这里定死了两件事：

| 层级 | 缩进 | 例 |
|---|---|---|
| 用户消息 / 正文 / 分组头部 | 0 | `> 问题` · `▾ ● Bash(...)  · ok` · `▸ ✻ Thinking  · 2 行已折叠` |
| 组内 section | 2 | `params` · `out` |
| section 的值行 | 4 | `command: dir /b` · `357  src/agent/aiSdkSession.ts` |

留白：每个块（用户消息 / 思考组 / 工具组 / 正文 / 提示）开始前插**一行空行**，由 `store.blank()` 统一处理——它只在"上一行不是空行"时插入，所以不会出现连续空行。这一条是排版观感的关键。

噪音文案一律去掉：折叠行不再重复"（点我展开）"（提示栏里说一次就够），无参数的调用不再打"（无参数）"，状态用 `· ok` / `· error` / `…` 与标题分开。

工具输出**按原样显示**（`wc -l` 风格的数字右对齐等由工具自己决定），不为了对齐去改工具的输出。

## 思考 / 工具调用的折叠与参数

每个"思考"和每个"工具调用"都是**一个可折叠组**：头部行常驻，内容行（思考正文、参数块、工具输出）跟着折叠状态显隐。

**展开态**（工具带 params 块）：

![fold-expanded](.artifacts/fold-expanded.png)

**折叠态**（头部只留状态与行数，正文仍在）：

![fold-collapsed](.artifacts/fold-collapsed.png)

```
▸ ✻ Thinking · 2 行已折叠（点我展开）
▸ ● Read  src/core/transcript/index.ts  ok · 17 行已折叠（点我展开）
▸ ● Bash  node -e "统计 src 下各文件行数"  ok · 23 行已折叠（点我展开）
```

实现要点（三条都是实测出来的，探针留在 `src/probes/toolrow.ts` / `src/probes/foldmark.ts`）：

| 事实 | 做法 |
|---|---|
| 库的 `tool-call` row **能折叠**（自带 ▸/▾ 与点击命中区） | 头部行用 `kind: 'tool-call'`，`collapsed` 只用来驱动标记 |
| 但它的 `body` 是**段落式**：段内换行不断行，塞不下 params/输出 | 内容行仍是独立 row，**显隐由我自己的数据源过滤**（`visibleEntries()` 按组过滤） |
| 折叠必须真的减少可见行 | `rowCount()/getRow()` 都走过滤后的行；`toggleGroup()` 里 `version++` 让视图重算 |

工具参数来自会话层的 `ToolStep.params`：AI SDK 那路直接透传工具的 `input` 对象，展示前每个值截断到 120 字符（长文本显示成 `content: (43 字符)` 而不是啰嗦全文）：

```
● Bash  node -e "统计 src 下各文件行数"  ok
  params
    command: node -e "<walk src/*.ts and count lines>"
    timeout_ms: 20000
  out
    96  src/agent/liveSession.ts
    ...
```

思考组在**回答开始时会自动收起**（参考答案的默认行为），点一下标题或 `Ctrl+T` 随时展开；一轮结束后工具组保持展开，方便看输出。

## AI SDK 工具 agent（形状参照 pi）

`src/agent/aiSdkSession.ts`：用 Vercel AI SDK（`ai@7` + `@ai-sdk/openai-compatible` + `zod`）写的极简编码 agent，工具集对着 [pi](https://github.com/badlogic/pi-mono) 来：`read_file` / `write_file` / `edit_file` / `bash` / `ls`。

```bash
# 交互式：模型自己决定读写哪个文件、跑什么命令
VT_AGENT=ai VT_AGENT_ROOT=$PWD/.agent-sandbox \
  VT_BASE_URL=https://88api.ai/v1 VT_MODEL=deepseek-v4.1-flash VT_API_KEY=<key> pnpm dev

# 无头端到端检查：7 项断言，包含「用 fs 独立核对模型说写下的文件」
VT_BASE_URL=... VT_MODEL=... VT_API_KEY=... pnpm agent
```

![agent](.artifacts/agent.png)

链路是这样接的：

```
streamText({ model, system, messages, tools, stopWhen: stepCountIs(8) })
  fullStream ─┬─ reasoning-delta ──→ 思考行（LineStream 'system'）
              ├─ tool-call        ──→ 新建工具行（按 toolCallId 建键，并发不串行）
              ├─ tool-result      ──→ 工具行标 ok / err
              └─ text-delta       ──→ 正文行（逐行 markdown）
```

几个刻意的点：

- **工具在 `respond()` 内部创建**，闭包直接拿到 sink —— 所以 `bash` 的 stdout 是**边跑边写进转写**的，不是等工具返回才一次性显示。
- **工具行按 `toolCallId` 建键**，一个 step 里并发多个工具调用不会错位。
- **文件工具限制在 `VT_AGENT_ROOT` 内**，越界路径直接拒绝；`edit_file` 要求唯一匹配（不唯一时报错，跟 pi 一样的语义）。
- **历史用 `result.responseMessages` 累积**（含 tool 消息），多轮能接着聊。
- 这**不是沙箱**：`bash` 跑的是真实命令，只是 cwd 固定在工作区。别拿它跑不可信输入。

实测（`pnpm agent`，2026-09-18）：

```
✔ 模型发起了工具调用 — write_file(demo.txt) | ls(.) | read_file(demo.txt) | bash(...) | write_file(_count.bat) ...
✔ 模型写下的文件在磁盘上真的存在且内容正确 — 磁盘上 3 行，第 2 行="第二行：这是要被读回来的关键行"
✔ bash 的真实输出进了转写并画到屏幕 — 工具输出 21 行；含 demo.txt=true；屏幕上可见=true
✔ 流式是增量的 — 采样 570 次，version 跨度 1309
✔ 产生了多帧提交 — commit 次数 1288
✔ 正文画到了屏幕上 — 屏幕 33 行非空
✔ 没有 SDK / 网络错误 — 转写里没有错误标记
PASS
```

注意第二条：不只看界面显示了什么，而是**用 `fs` 独立读了那个文件**——模型自述"我写好了"不算数。

## 接真实 API

同一套界面换成真实 SSE 流，任何 OpenAI 兼容端点都行（本机 llama-server、各家网关）。实测用的是 `deepseek-v4.1-flash` @ 88api.ai：

```bash
# 交互
VT_LIVE=1 VT_BASE_URL=https://88api.ai/v1 VT_MODEL=deepseek-v4.1-flash VT_API_KEY=<key> pnpm dev
# 无头端到端检查（断言流式/落屏/markdown 解析/无 HTTP 错误）
VT_BASE_URL=... VT_MODEL=... VT_API_KEY=... pnpm live
# 用真实输出出图
VT_LIVE=1 VT_BASE_URL=... VT_MODEL=... VT_API_KEY=... VT_SHOT_ROWS=42 pnpm shot
```

跑起来后也可以 `/live` `/mock` 在两种会话间切。

实测结果（`.artifacts/live-report.json`）：

| 指标 | 实测 |
|---|---|
| 流式 | 采样 164 次，version 跨度 1330（不是一次性给完） |
| 耗时 | 整轮 7.3s |
| 落屏 | 模型正文首行出现在终端 buffer 上 |
| markdown 解析 | 行样式集合 `code / plain / bullet` |
| 错误 | 无 `[请求失败]` / `[流中断]` |
| 中断 | 流式进行中按 Esc：HTTP 流被 AbortController 掐断，转写写「已中断」，状态回 `ready` |

注意：`deepseek-v4.1-flash` 会先长时间吐 `reasoning_content`（实测跑到 4800 tok 还在思考），所以「✻ Thinking…」可能占满前半程——那是模型行为不是渲染卡住，提示词里加「直接给答案，不要推理」可以跳过去。

live 模式目前**只做纯文本流，不解析 tool-call**（mock 剧本才是默认，保证离线永远能演示）。要让真实模型真调工具，得自己接 function calling 并把结果写回 store。

## 目录

```
src/
  cli/                   可执行入口（人跑的东西）
    terminal.ts            交互式 TUI：createTerminalApp + stdout 渲染器 + stdin driver + 清理
    shot.ts                出图：把跑完的 buffer 转成带色 HTML（多轮用 ;; 分隔）
  checks/                断言脚本：退出码即结果，失败即事实
    smoke.ts               渲染/流式/折叠的 16 项断言 + 屏幕快照产物（mock，离线）
    live-check.ts          真实 SSE 端点的 6 项断言（流式/落屏/markdown/错误/中断）
    agent-check.ts         AI SDK 工具 agent 的 10 项断言（含用 fs 独立核对模型写下的文件）
    env-check.ts           .env 加载行为的 9 项断言（优先级/覆盖/坏行/密钥不外泄）
  probes/                一次性探针：摸清库行为与排版回归
    toolrow.ts             tool-call row 的多行 body 与折叠行为
    foldmark.ts            折叠标记在「有/无 body」下的渲染
    indent.ts              库对不同 role 的默认缩进（实测都是 0）
    layout.ts              把转写行与缓冲区的前导空格按 JSON 打出来
    debug-agent.ts         不带 TUI 的二分脚本（判断卡在 SDK 层还是渲染层）
  ui/                    界面层
    App.ts                 组件装配：版面摆放、命令、键盘、对外的 AppApi
    layout.ts              版面坐标（layoutOf）与 Layout 类型
    texts.ts               命令帮助、提示栏、状态行对齐、输入清洗
    turn-sink.ts           一轮对话的事件映射（思考/工具/正文 → 分组），Phase 定义在此
  core/                  底座（与界面、会话都无关）
    transcript/            转写模型，三层分明
      types.ts               行/分组的类型（叶子模块，无依赖）
      markdown.ts            行级 markdown 与参数格式化（纯函数）
      rows.ts                entry → TTranscriptRow（缩进、折叠标记）
      store.ts               LineStream + TranscriptStore（分组、可见行过滤、版本号）
      index.ts               对外桶文件
    env.ts                 .env / .env.local 加载（真实环境变量优先）
    text.ts                cell 宽度、按列截断、流式分块
    theme.ts               配色与样式 token
    html.ts                buffer → 带色 HTML（shot / 三个 check 共用）
  agent/                 会话层（同一接缝的多个实现）
    session.ts             接缝类型（AgentSession / StreamStep / ToolStep / TurnSink）
    mockSession.ts         本地剧本（工具步骤真的起子进程跑命令）
    liveSession.ts         裸 SSE 纯文本流
    aiSdkSession.ts        AI SDK 工具 agent（read/write/edit/bash/ls）
```

导入方向是单向的：`cli/checks/probes → ui/agent → core`，core 内部 `store → rows → markdown → types`，没有反向依赖，也没有循环。`checks/*` 与 `probes/*` 只通过 `ui/App.ts` 暴露的 `AppApi` 触碰界面，不 import 组件内部。

## 流式是怎么实现的

三条链路各自独立：

```
会话层(剧本/SSE)  --delta-->  TranscriptStore  --version-->  TTranscriptView  --只重绘脏行-->  终端 buffer
```

1. **会话层**按 2~3 个字符一块吐（`chunkText()` 保证不切碎换行）。
2. **数据源按行累积**：`LineStream.push(delta)` 每遇到一个换行符就「封行 + 开新行」，只改当前行的 `text` 并把这一行的 `rev++`，整体 `version++`。
3. **视图只重绘脏行**：`<TTranscriptView :source :version>` 拿到新版本号后比对每行的 `getRowVersion`，只把变化的那一行写进终端 buffer。

版面按 plane 分区（`TRenderPlane`）：transcript（每 10~20ms 一次）、chrome 状态栏（每 100ms 一次）、输入框（只在按键时）互不干扰——正文刷 30 行也不会让输入框光标闪一下。

## 实测踩到的坑

**库行为（1.1.9）**

- **transcript 行是「段落式」的**：同一行里 segments 之间写换行符**不会**断行，所以这里按物理行拆 row，而不是「一条消息一个 row」。刚开始按消息拆行时，整段 markdown 会挤成一坨。
- **`TInputBox` 的 `placeholder` 属性没接线**：types 里有，1.1.9 的实现里没有渲染（`placeholder` 只出现在 TLogSearchBar 那条代码路径上）。所以输入提示放进了框线标题。
- **`TInputBox` 提交后不会自己清空**：`onChange` 里把 `modelValue` 置空**不生效**（组件内部持有文本，而且没有 expose 出 `clear()`）。做法是提交后自增 `key` 强制重建输入框（`composerKey`）。这个坑是往 PTY 里连发两次 `/env` 才暴露的——第二次提交的实际文本是 `/env/env`，于是掉进了"未知命令"分支；顺带加了控制字符清洗，以及 `VT_DEBUG_INPUT=1` 把**原始提交文本按 JSON** 记进 `.artifacts/input-debug.log`（含不可见字符，排查输入问题全靠它）。
- 别用 `constructor(private x)` —— Node 的类型剥离模式不支持构造函数参数属性（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）。

**自己写的工具也得防**

- **`bash` 必须设输出上限，否则会堵死事件循环**：模型跑 `dir /b *.txt | find /c /v ""` 时，`find` 命中的是 git-bash 的 MSYS 版本，变成全盘遍历，吐出几万行；每行都写进 Vue 响应式 store 触发一次调度 → **事件循环被饿死，连 `setInterval` 心跳都停了**。现在的做法：最多显示 200 行 / 64KB，超限就杀掉进程树，并把 `%SystemRoot%\System32` 提到 PATH 最前面（让 Windows 的 `find.exe` 赢过 MSYS 的）。
- Windows 上只等 `'close'` 事件不够：孙子进程（`dir | find`）不退出时 `kill()` 杀不掉管道，工具会永远 pending。改成 `taskkill /T /F` 杀进程树 + `'exit'` 兜底 + 硬超时。

## 验证

三个无头套件，退出码即结论；命令行**不需要带任何 `VT_*` 变量**（都从 `.env` 来）：

| 命令 | 覆盖 | 断言数 |
|---|---|---|
| `pnpm smoke` | mock 剧本的渲染链路 + `.env` 加载行为 | 16 + 9 = 25 |
| `pnpm agent` | 真实 API + 真实工具循环（含 `fs` 独立核对） | 10 |
| `pnpm live` | 真实 API 的纯文本流 | 6 |

`pnpm smoke` 断言的是**事实**而不是「函数被调用过」：

```
✔ 流式是增量的 — 采样 231 次，version 跨度 475
✔ 产生了多帧提交 — commit 次数 512
✔ 正文进入转写（数据层完整）/ 正文末尾画在屏幕上（自动贴底）
✔ 工具输出是真实子进程 — 含 Read 的真实源码行与行数统计
✔ 工具调用显示了参数 — 展开态工具组含 params 块：path: src/core/transcript/index.ts
✔ 思考被归成一个分组并自动收起 — groups=[thinking(collapsed,2 行), tool(17 行), tool(23 行)]
✔ 折叠真的隐藏了内容行 — 可见行 65 → 25；折叠后仍能读到「合计」=false
✔ 展开真的恢复内容行 — 可见行 25 → 67（此前 65 是「思考已自动收起」的混合态）
✔ 折叠标记进入行数据（▸ + 已折叠）/ 展开态头部显示 ▾ 与行数
✔ 状态栏 / 输入框 / 响应式宽度 / Esc 能中断一轮
```

折叠那几条断言取的是 `getRow()` 的**行数据**而不是屏幕像素——屏幕受视口滚动影响，会变成 flaky 测试；行数据才是"喂给视图的东西"。渲染是否真的落到屏幕上，另有 `terminal.getRow(y)` 的真实 buffer 断言守着。

`pnpm agent` 在真实运行后额外断言折叠往返：`可见行 110 → 30（折叠）→ 177（展开）`，以及 `params` 块里出现 `path: demo.txt`。

产物落在 `.artifacts/`：`smoke-screen.txt`、`smoke-report.json`、`agent-report.json`、`live-report.json`、`input-debug.log`（`VT_DEBUG_INPUT=1` 时的原始提交文本）。

出图（Linux/macOS 用 xvfb 或直接有显示时同理）：

```bash
VT_SHOT_ROWS=64 node src/cli/shot.ts     # → .artifacts/demo.html（带色，可浏览器打开）
chrome --headless=new --screenshot=demo.png --window-size=960,1250 file:///<abs>/.artifacts/demo.html
```

## 已知边界

- mock 剧本会在正文末尾明说「本段文本来自本地剧本，不是真实模型输出」——演示不假装真模型。
- 表格（`| a | b |`）不做特殊渲染，按原文输出。
- 折叠只影响**显示**：折叠组的内容行仍在内存里（`visibleEntries()` 过滤），所以展开是瞬时的、不重跑任何东西。
- 思考/工具的分组状态不进会话历史：重启后新会话是全新状态。
- 长回答的虚拟化依赖 `TTranscriptView` 内部实现，本 demo 未自行测帧率上限。
- 换行由库负责，**续行没有悬挂缩进**：列表项/段落折行后从第 0 列开始（终端的常见行为）。要做悬挂缩进得自己按视口宽度预折行，而宽度会随 resize 变，收益不抵复杂度，故没做。
- 工具输出按原样显示，因此工具自身的对齐（例如 `wc -l` 式数字右对齐）会保留。
