# Verse 架构设计：TUI + Agent Framework 唯一后端

> 方向决策文档。生效日期：2026-09-24。
> 两条铁律：**① 本仓库是唯一 agent 后端**（`backend/`，Python）；**② 以后所有 agent 能力统一用
> Microsoft Agent Framework 开发**——不再在 TypeScript 侧新增任何 agent 逻辑。
> 方向调整时先改本文档的结构并确认，再动代码。

## 1. 背景与动机

本仓库原本有四条会话实现（原 `src/agent/`，现 `src/session/`）：`mock`（离线剧本）、`live`（裸 SSE 纯文本）、
`ai`（Vercel AI SDK 本地工具循环）、`rpc`（远端 agent 后端）。其中 `ai` 路把工具循环、
历史管理、上下文恢复都写在 TypeScript 里，每加一个 agent 能力就要在 TS 侧重写一遍；
且与 Python 生态（agent-framework 的 harness：计划/todo/压缩/工具审批/会话持久化）能力差距越拉越大。

合并决策：

- 把 Python 侧的 RPC 服务（原 `workbuddy_data/file-history-demo`）迁入本仓库 `backend/`，
  单仓同时拥有前端与后端；
- `rpc` 成为**唯一真实 agent 后端**：所有真实模型调用、工具执行、历史持久化都发生在
  `backend/`，且全部构建在 Agent Framework 之上；
- TypeScript 侧退回它擅长的：渲染、键盘/版面、会话编排（落盘转写、切换、重放）。

## 2. 目标架构

```
┌─ vue-tui-demo（单仓）─────────────────────────────────────────────┐
│                                                                  │
│  src/  TUI（TypeScript，纯客户端）                                │
│    cli/terminal.ts ── VT_AGENT=rpc ──┐                           │
│    ui/App.ts（命令/版面/落盘编排）    │                           │
│    session/rpc.ts ──────────────────┼── AgentSession 接缝        │
│    checks/rpc-check.ts（无头端到端）  │                           │
│                                      │ JSON-RPC 2.0 over WebSocket│
│  backend/  Agent 后端（Python）       │ ws://127.0.0.1:8765       │
│    rpc_server.py ◀───────────────────┘                           │
│      ├─ create_harness_agent（Agent Framework，唯一 agent 底座）    │
│      │    ├─ todo / 文件 / shell 工具循环（工作区=仓库/.agent-sandbox）│
│      │    └─ FileHistoryProvider → backend/history/<sid>.jsonl    │
│      ├─ provider 装配：wb2api(cn:hy3) 默认，openai 兼容可切换        │
│      └─ test_rpc.py / test_switch.py（协议级断言）                 │
│                                                                  │
│  docs/architecture.md（本文档）                                    │
└──────────────────────────────────────────────────────────────────┘
                      │
                      ▼ OpenAI 兼容端点（key 只在后端进程内，绝不下发前端）
              wb2api 127.0.0.1:7863 · cn:hy3
```

分层职责（单向依赖，与现有 `checks → ui → session → transcript → core` 规则叠加）：

| 层 | 职责 | 禁止 |
|---|---|---|
| `src/` TUI | 渲染、键盘、会话落盘/切换/重放、协议客户端 | 不实现工具、不拼上下文、不直接调模型 API |
| `backend/` RPC | 协议分发、并发/取消、事件映射 | 不含任何界面概念（行/分组/折叠） |
| `backend/` agent 层 | Agent Framework harness 组装、工具、历史 | 不感知 WebSocket（只产出 chunk） |
| provider 端点 | 模型推理 | —— |

## 3. 仓库布局（合并后）

```
vue-tui-demo/
  src/                    # TUI（不变，接缝 AgentSession 的四个实现）
  backend/                # ★ 新增：唯一 agent 后端
    pyproject.toml        # uv 项目：agent-framework + websockets
    rpc_server.py         # 服务端 = 协议 docstring + 装配 + 分发（单文件，约 330 行）
    test_rpc.py           # 协议级 11 项断言
    test_switch.py        # 会话语义 6 项断言（切换/隔离/重启恢复）
    repro_cancel.py       # 取消路径的聚焦复现工具
    history/              # 运行时数据：每 session 一个 JSONL（gitignore）
    .venv/                # uv 环境（gitignore）
  docs/architecture.md    # 本文档
  .agent-sandbox/         # agent 工具工作区（gitignore，= 前端 VT_AGENT_ROOT）
```

启动：

```bash
pnpm backend              # = cd backend && uv run python rpc_server.py（首次先 uv sync）
VT_AGENT=rpc pnpm dev     # TUI 接上；或进 TUI 后敲 /rpc
```

## 4. 协议层（JSON-RPC 2.0 over WebSocket）

完整协议以 `backend/rpc_server.py` 模块 docstring 为唯一权威来源（single source of truth），
本文只给骨架与演化规则。

### 4.1 方法

| 方法 | 类型 | 语义 |
|---|---|---|
| `agent/chat` | 请求 | 发一轮。**流式 = 事件通知在前、终态响应在后**（JSON-RPC 规范无流式语义，这是选定的模式） |
| `agent/cancel` | 请求 | 取消该 session 进行中的轮次；应答 `{cancelled:bool}`；被取消的 chat 另收 `-32001` |
| `agent/reset` | 请求 | 丢弃服务端内存会话对象（磁盘历史保留） |
| `model/set` | 请求 | 切服务端默认模型 = 重建 chat client + harness（plan/todos 重置、磁盘历史保留）；`{model,provider,rebuilt}`；轮次进行中拒绝 `-32003`、空值 `-32602`。客户端显示的 model 以 `initialize.result.model` 为权威，连上即握手回填 |
| `mode/get` | 请求 | 读该会话 harness 模式 `{session,mode}`（plan\|execute，默认 plan；AgentModeProvider，`state["agent_mode"]`） |
| `mode/set` | 请求 | 切该会话 plan/execute `{session,mode}` → `{mode,previous,changed,notify}`；指令级切换下一轮生效，changed=true 时框架注入 `[Mode changed]` 通知；同值不重发、非法值/空参数 `-32602`。UI 经 Shift+Tab 触发，状态栏独立模式段显示 |
| `initialize` / `ping` | 请求 | 能力发现 / 存活探测 |

### 4.2 事件（`agent/event` 通知，无 id）

`thinking_delta` · `thinking_end` · `tool_start` · `tool_line` · `tool_end` · `answer_delta`

与前端 `TurnSink` 一一对应——**事件模型即 UI 语义**，这是前后端的契约。

### 4.3 错误码

`-32700` 解析 · `-32600` 非法请求 · `-32601` 方法不存在 · `-32602` 参数非法 ·
`-32000` 模型调用失败 · `-32001` 已取消 · `-32003` 该会话上一轮还在跑

### 4.4 兼容性规则（协议演化必须遵守）

1. **只加不改**：新事件类型可以加（客户端必须忽略未知 type），已有字段语义不改；
2. **一轮恰好一个终态**（result 或 error），客户端据此结束 `respond()`——任何新路径不得破坏；
3. 终态前可以推任意多事件；事件可能缺席（如 `thinking_*`，见 §6.2）；
4. `initialize.result.methods` 是能力发现入口，客户端可据此判断服务端版本。

## 5. 会话层与数据模型

### 5.1 接缝不变

前端仍通过 `AgentSession`（`respond/snapshot/restore/kind`）消费后端——切换/落盘逻辑零改动。

| kind | 处置 | 依据 |
|---|---|---|
| `rpc` | **主力**：唯一真实 agent 后端 | 本次合并的目标 |
| `mock` | **永久保留**：离线测试夹具，不是 agent 后端 | `pnpm smoke` 断言依赖；无 key 也能跑 |

> `live` / `ai` 两条实现已于 2026-09-24 **删除**（连同 `live-check` / `agent-check` 套件、
> `ai`/`@ai-sdk/*`/`zod` 依赖、`VT_LIVE`/`VT_BASE_URL`/`VT_MODEL`/`VT_API_KEY` 前端配置）；
> `SessionKind` 同步收紧为 `'mock' | 'rpc'`，旧落盘会话文件里的 `live`/`ai` kind 会被跳过
> （文件保留在磁盘，只是不再出现在 `/sessions` 列表）。见 §11。

### 5.2 双层持久化

```
前端 .verse-sessions/<id>.json     # 转写（行级重放）、kind、agentState={sid}
后端 backend/history/<sid>.jsonl   # 对话历史（FileHistoryProvider，append-only，每行一条 Message）
```

- `snapshot()={sid}` / `restore()` 读回 sid：**重启 TUI 后 `/open` 接回服务端上下文**（已实测）；
- 同连接换 `session` 参数即切换历史，互不污染（已实测 6/6）；
- 服务端重启：历史从磁盘读回（已实测）；plan/todos 走内存 `SessionStore`，**不跨服务端重启**（已知边界）。

## 6. 后端内部架构

### 6.1 装配（唯一入口）

```python
client = OpenAIChatCompletionClient(model, base_url, api_key)   # 或 openai: OpenAIChatClient
agent  = create_harness_agent(
    client,
    history_provider=FileHistoryProvider(HISTORY_DIR),
    default_options={"store": False},        # Responses 端点必须；chat completions 无害
    file_access_*_approval=True 的关闭位,      # 协议没有审批通道，文件工具收敛在 WORKSPACE
    disable_web_search=True,
)
```

### 6.2 chunk → 事件映射（实测校准）

| `AgentResponseUpdate` 里的 Content | 事件 | 备注 |
|---|---|---|
| `text` | `answer_delta` | 增量拼接即终态 `result.text` |
| `text_reasoning` | `thinking_delta` | **cn:hy3 不产思考，事件必然缺席**——前端必须兼容没有 thinking 的轮次 |
| `function_call`（arguments 分片） | 等 `finish_reason=tool_calls` 拼完整→`tool_start` | 跨 chunk 状态留在服务端，协议里只出现完整 params |
| `function_result` | `tool_line` + `tool_end` | 截断 4000 字符 |
| `usage`（收尾 chunk） | 终态 `result.usage` | |

### 6.3 并发模型

- 一条 WebSocket = 一个接收循环；每个 `agent/chat` 起独立 asyncio task（`tasks[session]`），
  所以请求进行中仍能收到 `cancel`/`busy 判断`；
- 同 session 忙时新 chat 直接 `-32003`（防同会话并行写历史）；
- 发送用每连接 `asyncio.Lock` 串行化，事件与终态不会交错损坏帧；
- 单轮超时 300s → `-32000`；连接断开时取消该连接的全部任务。

## 7. 扩展指南：以后 agent 能力怎么加

**唯一入口在 `backend/`。** 三类扩展的标准路径：

| 想加什么 | 改哪里 | 不改哪里 |
|---|---|---|
| 新工具（如浏览器、SQL） | `create_harness_agent(tools=[...])` 或 Agent Framework 自带工具开关 | 协议、前端（工具行自动出现） |
| 新模型/新 provider | `rpc_server.py` 的 provider 装配分支 + `AGENT_RPC_*` 环境变量 | 协议、事件模型 |
| 新交互能力（如人工审批、diff 预览） | 新事件 type + `rpc_server.py` 分发 | 已有字段/终态语义（只加不改，§4.4） |
| 新会话后端（如多 agent 编排） | Agent Framework 层实现后仍经同一协议暴露 | 前端接缝 `AgentSession` |

明确禁止：

- ❌ 在 `src/` 写工具执行、上下文拼接、提示词管理——这些是 Agent Framework/harness 的职责；
- ❌ 绕过 `backend/` 从前端直连模型端点（`live` 路即因此删除）；
- ❌ 在协议里传 provider 密钥（key 只存在于后端进程环境）；
- ❌ 引入第二个后端进程或第二套会话存储。

新增能力的验收口径（与现有套件同标准）：**协议级断言（backend test_*）+ 无头端到端断言
（`src/checks/`）双侧都有，断言建立在真实字节/真实文件上，不接受"函数被调用过"。**

## 8. 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGENT_RPC_HOST` / `AGENT_RPC_PORT` | `127.0.0.1` / `8765` | 只监听本机 |
| `AGENT_RPC_PROVIDER` | `wb2api` | `wb2api` \| `openai` |
| `AGENT_RPC_BASE_URL` | 按 provider | OpenAI 兼容端点 |
| `AGENT_RPC_MODEL` | `cn:hy3` | |
| `AGENT_RPC_API_KEY` | 后端环境注入 | 绝不打印、绝不下发前端 |
| `AGENT_RPC_HISTORY` | `backend/history` | 每 session 一个 JSONL |
| `AGENT_RPC_WORKSPACE` | `<repo>/.agent-sandbox` | 工具文件/命令的根 |
| `VT_AGENT` | — | 前端：`rpc` 即接本后端 |
| `VT_RPC_URL` | `ws://127.0.0.1:8765` | |

## 9. 安全边界

1. 服务只绑 `127.0.0.1`；改 `0.0.0.0` 前必须先加认证（当前协议**无鉴权**，是本机回环假设的一部分）；
2. 密钥单向流动：环境 → 后端进程 → provider，日志/协议/前端三个出口都不出现；
3. agent 文件/命令工具限定在 `WORKSPACE`；会话文件是明文（gitignore），别让 agent 把敏感内容写进对话；
4. `history/` 与 `.verse-sessions/` 均已 gitignore。

## 10. 验证与验收（实测，2026-09-24）

| 套件 | 覆盖 | 断言 | 结果 |
|---|---|---|---|
| `backend/test_rpc.py` | 握手/流式/跨轮上下文/工具事件/取消-32001/错误码 | 11 | **11/11** |
| `backend/test_switch.py` | 会话切换/隔离/重连恢复 | 6 | **6/6** |
| `pnpm rpc` | TUI↔后端真实链路（真实模型） | 6 | **6/6** |
| `pnpm smoke` | mock 渲染链路 + .env 行为（回归，离线） | 全套 | PASS |
| `pnpm sessions` | 会话落盘/重放（回归） | 24 | **24/24** |
| `pnpm typecheck` | `tsc -p`（`src/probes/complete.ts` 的既有报错为仓库遗留，与本方向无关） | — | 本次改动 0 错 |

## 11. 迁移状态与待决策

**已完成（本方向的验收项）**：

- [x] 后端迁入 `backend/`，`pnpm backend` 一键起（uv 管依赖，独立 venv）
- [x] 前端 `VT_AGENT=rpc` / `/rpc` 为真实 agent 唯一入口；协议测试与端到端全绿
- [x] 三处合并回归修复并有断言覆盖：cancel 应答 + -32001、同会话忙守卫 -32003、测试随机 sid（防历史跨次污染）
- [x] 本 `docs/architecture.md` 成为方向的 single source of truth
- [x] **删除 `live`/`ai` 两条会话实现**（2026-09-24）：`liveSession.ts`/`aiSdkSession.ts`/
      `live-check.ts`/`agent-check.ts`/`debug-agent.ts` 删除，`ai`+`@ai-sdk/openai-compatible`+
      `zod` 依赖移除，`/live` `/ai` 命令与 `VT_LIVE` 系配置清理，README 同步；
      验收：全仓 typecheck 0 错、smoke/sessions/rpc/shot 全绿、README 无残留引用
- [x] **`SessionKind` 收紧为 `'rpc' | 'mock'`**（2026-09-24）：旧 `live`/`ai` kind 的
      `.verse-sessions` 文件被校验器跳过（磁盘文件不删）

**待决策（不在本次范围，需单独排期）**：

1. 协议加鉴权（若未来要离开本机回环）；
2. harness plan/todos 的跨服务端重启持久化（换 `FileSessionStore`）——按需求再做；
3. 是否给旧 `live`/`ai` 会话文件做一次性 kind 迁移（当前选择跳过而非改写：转写仍可手工查阅）。

**已知边界（不修，记录在案）**：

- 旧 kind=`live`/`ai` 的会话不出现在 `/sessions` 列表（校验器跳过，文件保留在磁盘）；
- `thinking_*` 事件在 cn:hy3 下必然缺席（端点不返回思考字段，框架也不解析 `reasoning_content`）；
- `FileHistoryProvider` 在 agent-framework 1.19.0 标记 experimental。

## 12. 演进记录

| 日期 | 变更 |
|---|---|
| 2026-09-24 | 方向确立：单仓 + Agent Framework 唯一后端；`file-history-demo` 迁入 `backend/`；本文档建立 |
| 2026-09-24 | 删除 `live`/`ai` 后端与依赖，`SessionKind` 收紧为 `'mock' \| 'rpc'`——TS 侧不再有任何 agent 实现 |
