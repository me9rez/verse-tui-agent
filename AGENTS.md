# AGENTS.md

给在这个仓库里干活的 AI 编码代理的工作约定。**先读这一份，再读 `README.md`（用法与实测结论）
和 `docs/architecture.md`（方向决策，本仓库的 single source of truth）**，然后动手。

## 1. 这是什么

Verse —— 用 Vue 3 + `@simon_he/vue-tui` 搭的**终端流式 agent TUI**，单仓两半：

| 半边 | 位置 | 职责 |
|---|---|---|
| TUI | `src/`（TypeScript） | 渲染、键盘/版面、会话落盘与重放、协议客户端 |
| 唯一 agent 后端 | `backend/`（Python） | 协议分发、Agent Framework harness、工具执行、会话历史 |

两条铁律（改了就是方向错误，先改 `docs/architecture.md` 并确认）：

1. **所有 agent 能力只在 `backend/` 里用 Microsoft Agent Framework 开发**，TS 侧不再新增任何 agent 逻辑；
2. **`rpc`（`backend/rpc_server.py`）是唯一真实 agent 后端**，`mock` 永久保留为离线测试夹具。

## 2. 环境与命令

要求 **Node ≥ 22.18**（`node` 直接跑 `.ts`，靠内置类型剥离，**没有打包器、没有构建步骤**），包管理用 **pnpm**；
后端是 **uv** 项目，要求 Python ≥ 3.11。首次：`pnpm install` + `cd backend && uv sync`。

| 命令 | 作用 | 需要后端 | 需要 TTY |
|---|---|---|---|
| `pnpm dev` | 交互式 TUI（flag 必须写成 `pnpm dev -- --rpc`，pnpm 会吞 flag） | 否（mock） | **是** |
| `pnpm dev -- --list-sessions` | 列出落盘会话后退出（无头可用） | 否 | 否 |
| `pnpm backend` | 起唯一后端 `ws://127.0.0.1:8765` | — | 否 |
| `pnpm typecheck` | `tsc -p tsconfig.json`（当前 **0 报错**，是硬门禁） | 否 | 否 |
| `pnpm typecheck:backend` | pyright 检查 `backend/`（当前 **0 报错**；配置在 `backend/pyproject.toml` `[tool.pyright]`，走 uv venv） | 否 | 否 |
| `pnpm lint:backend` | ruff 检查 `backend/`（当前 **0 报错**；`[tool.ruff]` 的 `src` 让本地模块按第一方排序） | 否 | 否 |
| `pnpm build` | tsdown 编译 `src/cli` 两个入口 → `dist/`（`bin: verse`，带 shebang） | 否 | 否 |
| `pnpm smoke` | vitest：渲染 / 流式 / 折叠 / 颜色 / 落盘（离线 mock） | 否 | 否 |
| `pnpm sessions` | vitest：会话落盘 / 读回 / 重放 / 记录器（临时目录） | 否 | 否 |
| `pnpm complete` | vitest：slash 补全按键链路（离线 mock） | 否 | 否 |
| `pnpm config-test` | pytest：TOML 配置深合并 / 脱敏 / 坏文件回退（离线） | 否 | 否 |
| `pnpm rpc` | vitest：TUI ↔ 后端真实链路（**打真模型**） | **是** | 否 |
| `pnpm model` | vitest：`/model` 选择器（**打真模型**） | **是** | 否 |
| `pnpm open` | vitest：`/open` 会话选择器（离线 mock + 临时会话目录） | 否 | 否 |
| `pnpm effort` | vitest：`/effort` 思考强度命令（离线 mock） | 否 | 否 |
| `pnpm image` | vitest：Alt+V 剪贴板贴图（离线 mock + 能力门控） | 否 | 否 |
| `pnpm hotkeys` | vitest：Alt+M/Alt+E 快捷键 + 状态栏 usage 格式化（离线） | 否 | 否 |
| `pnpm test:backend` | pytest 全量（protocol + agent + switch，agent/switch 打真模型） | 自拉或复用 8765 | 否 |
| `pnpm test` | vitest 全量（含 rpc / model，**必须先起后端**） | **是** | 否 |
| `pnpm shot` | 把跑完的 buffer 渲成带色 HTML 出图 | 否 | 否 |
| `node src/probes/<name>.ts` | 跑一次性探针（库行为/排版的实测现场） | 视探针 | 否 |

改完东西的验收口径（本仓库一直按这个来）：**`pnpm typecheck` 0 错 + 受影响的套件全绿**（后端改动还要
`pnpm typecheck:backend` 与 `pnpm lint:backend` 0 错）。
只碰文档时例外。后端改动至少跑 `pnpm config-test`；碰协议/会话/工具就跑 `pnpm rpc` + 对应 pytest。
`rpc` / `model` / `test:backend` 的 agent 用例是**真调用模型端点**的，连跑会撞上游 RPM 限流
（转写里出现 `[RPC 错误]`）——等一分钟单跑一次即可，不要误判成代码坏了，也不要为此改断言。

## 3. 架构与依赖方向

```
src/cli → src/ui → src/session → src/transcript → src/core      （test/ 与 probes/ 只经 AppApi 触碰界面）
```

单向、无环。新增模块时把它放进对应域，**不要引入反向依赖**（例如 `transcript` 里 import `ui`）。

| 目录 | 内容 |
|---|---|
| `src/cli/` | 可执行入口：`terminal.ts`（交互 TUI）、`shot.ts`（出图） |
| `src/ui/` | `App.ts`（装配层：props / hook 串联 / 4 个 `TRenderPlane` 外壳 / `AppApi`）、`hooks/`（11 个组合式函数，无渲染）、`components/`（7 个渲染子组件）、`layout.ts`（版面坐标）、`texts.ts`（命令表与文案） |
| `src/session/` | 接缝 `seam.ts` + 实现 `mock.ts` / `rpc.ts` + `sink.ts`（事件→转写分组）+ `persist/`（落盘） |
| `src/transcript/` | 转写域：`LineStream` + `TranscriptStore`（分组、可见行过滤、版本号） |
| `src/core/` | 底座：`config.ts`（gateway 客户端）、`theme.ts`、`syntax.ts`、`text.ts`、`html.ts`、`brand.ts` |
| `src/probes/` | 一次性探针：摸库行为 + 排版回归，**不是测试套件**，可随时新增 |
| `test/` | vitest 套件（根目录，6 个文件），断言真事 |
| `backend/` | `rpc_server.py`（协议 SSOT 在模块 docstring）+ `config.py` + `tests/`（pytest） |

## 4. 落点速查：想加东西改哪里

| 想加什么 | 改哪里 | 不要碰 |
|---|---|---|
| 新的 slash 命令 | `src/ui/texts.ts` 的 `COMMANDS`（**唯一数据源**，`/help` 与 `/` 补全都从它派生）+ `src/ui/hooks/useSlashCommands.ts` 的分发分支 + 一个 test | 别在别处再抄一份命令文案 |
| 新工具 / 新 agent 能力 | `backend/rpc_server.py` 的 `create_harness_agent(...)` 装配 | 协议、前端（工具行自动出现） |
| 新模型 / provider | `~/.verse/config.toml` 的 `[providers.*]` / `[models.*]` | 协议、事件模型 |
| 新交互能力（审批、diff 预览…） | 新事件 type + `rpc_server.py` 分发 + 前端 `TurnSink` 映射 | 已有字段语义与「一轮一个终态」 |
| 新配置项 | `backend/config.py` 的 `DEFAULTS` / `DEFAULT_TUI` + `docs/config.example.toml` / `docs/tui.example.toml` + `README` 配置表 | — |
| 新排版/配色 | `src/core/theme.ts`（hex 单源）+ `src/transcript/store.ts` | 别在组件里散写颜色 |

`src/core/config.ts` 的 `BUILTIN_CONFIG` 必须与 `backend/config.py` 的 `DEFAULTS` **同值**：前端在 gateway
连不上时用它兜底（保住离线 mock）。两边改一边就是漂移——`/env` 的「配置文件」行能发现（有 sources 才说明读到真配置）。

## 5. 硬性规则（违反即返工）

- **❌ 在 `src/` 里写工具执行、上下文拼接、提示词管理** —— 这些属于后端 harness。
- **❌ 从前端直连模型端点**（历史 `live`/`ai` 两条路即因此被删除）；密钥只存在于后端 `config.toml` 与后端进程。
- **❌ 在协议里传 provider 密钥**：`config/get` 只回 `***set***` | 空串，明文永不下发。
- **❌ 引入第二个后端进程 / 第二套会话存储。**
- **协议只加不改**：新事件类型可以加（客户端忽略未知 type），已有字段语义不改；**一轮恰好一个终态**（result 或 error）。
- **前端不读任何配置文件与业务环境变量**（唯一 `VERSE_HOME` 换数据目录）；要新配置项就加进 TOML + `config/get`。
- **测试不许往仓库写数据**：`test/smoke|sessions|open` 用 `setSessionDir(临时目录)`，`rpc|complete|model|probes` 传 `persist: false`。
  产物一律落 `./.artifacts/`（已 gitignore）。
- **密钥、真实账号信息（昵称/uid/邮箱/端点 token）绝不进代码、测试、文档、示例或 git 历史**；示例数据用中性占位名。
- **不要把端口从 `127.0.0.1` 改出去**（当前协议无鉴权，回环假设是安全边界的一部分）。

## 6. 代码约定

- **注释用中文，说明「为什么」和实测依据**，不要复述代码。仓库的注释密度是刻意的，请保持。
- **Node 类型剥离的限制**：不能写构造函数参数属性（`constructor(private x: T)` → `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），
  字段先声明再在构造函数里赋值；import 一律带 `.ts` 扩展名；`verbatimModuleSyntax` 生效，只作类型的导出必须 `import type` / `export type`。
- **样式表要强类型**：`src/core/theme.ts` 的 `styles` 不要标成 `Record<string, Style>`，否则拼错的键运行时拿到
  `undefined` → 那一行**静默不上色**（有 3 个历史案例）。用 const + 字面量推导。
- **纯函数里不放副作用状态**：markdown 围栏（` ``` `）的开关只在 `commit()`（封行）里翻转，`classOf()` 必须保持纯——
  它对未完成行的每个流式增量都会调，放这里会被翻转奇偶次。
- **折叠规则**（手风琴）只落一处：`TranscriptStore.soloExpand()` + `src/session/sink.ts` 的四处调用点；
  折叠是**数据源过滤**（`visibleEntries()`），不是像素隐藏，`rowCount()/getRow()` 都走过滤后的行。
- **给库腾位置**：输入行与 `/` 补全弹窗必须挂在 `TRenderPlane plane="overlay"`；`TBox` 的内容要做成 children
  （兄弟节点会被盒体填充覆盖）。这些不是风格偏好，是实测结论。
- **数组/对象的响应式要真响应式**：跨组件共享的配置必须是 `ref`（`src/core/config.ts` 曾用普通 `let` 导致
  `computed` 永久缓存空数组，`/model` 误判 `[models] 为空`）。
- 改界面文案先看 `src/ui/texts.ts` 有没有现成常量；噪音文案（「（点我展开）」之类）不要加。
- **UI 按域分治**：`src/ui/hooks/` 只放无渲染的组合式函数，`src/ui/components/` 只放渲染子组件，`App.ts`
  只做装配（props → hook 串联 → plane 外壳 → 子组件 → `AppApi`）。`useTerminal()` 全仓只在
  `hooks/useShell.ts` 调**一次**：`TRenderPlane` 是 `inject` 作用域边界，在 plane 内部再调会拿到 plane 版
  scheduler（只标脏那一个 plane）；其余 hook/组件统一收 `invalidate: () => void` 参数，hook 之间按拓扑序
  传参注入，不引 provide/inject。`components/` 之间不互相 import（跨域成员由 App 用 `TRenderPlane` 装）。

## 7. 测试纪律

- **断言事实，不采信自述**：断言真实字节 / 真实文件 / 真实 buffer（`api.screenText()`、`api.getRow()`、`store.entries`），
  不接受「函数被调用过」。折叠状态读**行数据**而不是屏幕像素（像素受视口/滚动影响，会 flaky）；
  「真的画上屏了」另用 `screenText()` 断言，两者分开。
- 用 `expect.soft` 写「软断言」：单条失败不阻断，最后统一算账，报告写进 `.artifacts/*-report.json`。
- 前端套件之间**串行**（`vitest.config.ts` 里 `fileParallelism: false`，各套件会各起一个 TUI 实例）——别为提速开并行。
- 每个新行为配一个能变红的断言；先写 RED（证明现状不满足）再实现，是这里的习惯。
- 探针（`src/probes/*.ts`）用于一次性摸清库行为，结论要写回注释或 README；探针挂了不用当门禁。

## 8. 提交与文档

- **提交信息用中文 conventional commits**，scope 取既有词汇：`feat(tui)`/`fix(probe)`/`test(frontend)`/`refactor(backend)`/
  `docs`/`chore`/`build`/`style(tui)`。标题写清「改了什么 + 为什么」，允许带 `——` 补充。
- 行为/命令/断言数变化时**同步 README**（快速开始、命令表、测试表、断言块）；方向性变化先改 `docs/architecture.md`。
- **别自作主张 commit / push / 重写历史**，除非用户明确要求。
- 大改动（新功能、跨层重构、协议变更）**先写技术方案**到 `.hermes/plans/YYYY-MM-DD_HHMMSS-slug.md`
  （目标 / 现状带 `file:line` / 架构与数据流 / 逐任务可照抄的实现与验证命令 / 测试对照 / 风险），**给用户过目后再动手**。
  小改动不需要。（`.hermes/` 已 gitignore，方案只存本地。）

## 9. 已知坑（详见 README「踩过的坑」，这里只列高频）

- 无 TTY 直接拒绝启动 TUI（除 `--list-sessions`）：无头验证走 `pnpm smoke` / `pnpm shot`。
- `pnpm dev` 的 flag 必须 `pnpm dev -- <flag>`。
- `bash` 工具必须设输出上限并杀进程树（曾因 MSYS `find` 全盘遍历 + 每行都进响应式 store 饿死事件循环）；
  Windows 上只等 `'close'` 杀不掉孙子进程，要 `taskkill /T /F`。
- 该仓库运行在 Windows 上（git-bash 执行）：**改文件用编辑器/patch 工具**，不要用 shell 重定向或
  PowerShell `Set-Content` / `WriteAllLines` 重写文件（会改编码与换行符，git 看到整个文件被重写）。
- 会话文件是**明文**（`.verse-sessions/`、`backend/history/` 均已 gitignore）；别把不该落盘的东西粘进对话。
  Alt+V 贴的图片以 data URI 随会话 JSONL 落盘并在后续轮次重发——多图长对话会显著膨胀 token。
- 图片走「事实 + 投影」模型（`backend/projection.py`）：会话存原图为唯一事实源，非 image_in 模型在
  请求发出前投影为**确定性文本占位符**（内容哈希派生，逐字节稳定保前缀缓存）；image_in 模型恒等投影。
  投影函数禁止加入位置/时间等请求态信息——会打爆上游 prompt cache。
- Windows 剪贴板读图走 PowerShell `Get-Clipboard -Format Image`（`src/ui/clipboard.ts`）：约定无图输出
  `NO-IMAGE`；子进程必须 `windowsHide + maxBuffer 上限 + timeout`（同上条杀进程纪律）。
- `tsc` 的报错就是门禁（当前 0 错）；`docs/architecture.md` §10 里那条「probes/complete.ts 有遗留报错」的记录已过时。
