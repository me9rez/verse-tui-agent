"""Verse Agent Backend —— Vue TUI 的唯一 agent 后端（JSON-RPC 2.0 over WebSocket）。

原 workbuddy_data/file-history-demo 的 rpc_server 迁入本仓库，成为唯一正式后端；
方向：以后所有 agent 能力统一用 Microsoft Agent Framework 在本服务内开发
（见 ../docs/architecture.md）。前端只剩渲染与会话编排，不再实现 agent 逻辑。

监听 ws://127.0.0.1:8765（仅本机）。运行：
    uv sync                       # 首次
    uv run python rpc_server.py   # 或在仓库根 pnpm backend

════════════════════════════════════════════════════════════════
JSON-RPC 2.0 over WebSocket 协议
════════════════════════════════════════════════════════════════
客户端 → 服务端（请求，带 id）：
  {"jsonrpc":"2.0","id":1,"method":"agent/chat",
   "params":{"session":"<sid>","prompt":"<用户输入>"}}
      可选 params.images = [{"media_type":"image/png","data":"<base64>"}]：
      多模态输入（≤4 张、单图 base64 ≤12MB）；当前模型 capabilities 需声明 image_in，
      否则 -32602。图片经 Content.from_data 与文本合成一条 user Message 进 harness。
  {"jsonrpc":"2.0","id":9,"method":"agent/cancel","params":{"session":"<sid>"}}
      → 应答 {"result":{"cancelled":true|false}}；被取消那轮的 chat 请求另收 -32001 终态
  {"jsonrpc":"2.0","id":2,"method":"agent/reset","params":{"session":"<sid>"}}
  {"jsonrpc":"2.0","id":7,"method":"model/set","params":{"model":"<模型 id>"}}
      → 应答 {"result":{"model":"<新 id>","provider":...,"rebuilt":true}}
      → 语义：切服务端默认模型 = 重建 chat client + harness agent（全局生效，
        影响后续所有轮次）；plan/todos 随 harness 重建重置，磁盘历史不受影响。
        有轮次在跑时拒绝（-32003）；空 model → -32602。
        initialize.result.model 是当前 model 的权威回显，客户端据此显示。
  {"jsonrpc":"2.0","id":4,"method":"config/get"}
      → {"result":{"config":<脱敏视图>,"sources":[实际读到的 toml 绝对路径]}}
      → config.providers[].api_key 恒为 "***set***"|"",明文永不下发；
        gateway.workspace/history 为服务端解析后的绝对路径；tui = TUI 偏好生效值。
        config.thinking.effort = 当前思考档位（运行时状态，非 toml 配置，见 thinking/set）。
  {"jsonrpc":"2.0","id":10,"method":"thinking/get"}
      → 应答 {"result":{"effort":"low|medium|high|xhigh|max|off|", "model":"<当前模型>",
             "support_efforts":[...], "default_effort":..., "off_effort":..., "capabilities":[...]}}
      → support_efforts 为空（模型没配）时回默认档位表 low/medium/high/xhigh。
  {"jsonrpc":"2.0","id":11,"method":"thinking/set","params":{"effort":"<档位>"}}
      → 应答 {"result":{"effort":"<生效档位>"}}；空参数/不在 support_efforts → -32602。
      → 语义：思考强度（Kimi [models.*].support_efforts/default_effort/off_effort），全局状态，
        下一轮 chat 生效；与 model/set 不同——不重建 harness，plan/todos 不受影响。
        "off" 映射到模型的 off_effort（没配则发端点通用的 "none"）；EFFORT 空 = 不发思考参数。
  {"jsonrpc":"2.0","id":8,"method":"mode/get","params":{"session":"<sid>"}}
      → 应答 {"result":{"session":"<sid>","mode":"plan"|"execute"}}
  {"jsonrpc":"2.0","id":9,"method":"mode/set","params":{"session":"<sid>","mode":"plan"|"execute"}}
      → 应答 {"result":{"session","mode","previous","changed","notify"}}
      → 语义：harness 的 plan/execute 模式，按会话隔离（AgentModeProvider，state["agent_mode"]，
        默认 plan）。plan = 规划/澄清/求批准，execute = 动手执行——指令级切换，
        下一轮生效；changed=true 时框架自动往下一轮注入 [Mode changed] 通知。
        同值切换 changed=false 且不发通知；非法 mode → -32602；空参数 → -32602。
        依赖服务端会话对象复用（_SESSION_CACHE）；进程重启后模式回到默认。
  {"jsonrpc":"2.0","id":3,"method":"initialize"} / {"method":"ping"}

服务端 → 客户端（一轮进行中的流式事件，通知，无 id）：
  {"jsonrpc":"2.0","method":"agent/event",
   "params":{"session":"<sid>","event":<Event>}}

  Event := {"type":"thinking_delta","text":str}            ← chunk 的 text_reasoning
         | {"type":"thinking_end"}                         ← 一次模型调用结束
         | {"type":"tool_start","id","name","arg","params"} ← arguments 已拼完整并解析
         | {"type":"tool_line","id","text"}                 ← 工具执行输出（截断 4000）
         | {"type":"tool_end","id","status":"ok"|"error"}
         | {"type":"answer_delta","text":str}               ← chunk 的 text 增量

一轮的终态（有 id，恰好一个）：
  成功 {"jsonrpc":"2.0","id":1,"result":{"ok":true,"text":<全文>,"usage":{...}}}
  失败 {"jsonrpc":"2.0","id":1,"error":{"code":...,"message":...}}

  错误码：-32700 解析错误 / -32600 非法请求 / -32601 方法不存在
         -32602 参数非法 / -32000 模型调用失败 / -32001 已取消
         -32003 该会话上一轮还在跑

流式模式 = 「事件通知在前、终态响应在后」：JSON-RPC 规范无流式语义，
客户端按请求 id 把事件归到当前轮，终态到达即该轮结束。
════════════════════════════════════════════════════════════════

配置（唯一来源 = TOML 文件，实现见 config.py；没有任何业务环境变量）：
  $VERSE_HOME/config.toml    默认 ~/.verse/config.toml   providers/models/gateway/默认值
  $VERSE_HOME/tui.toml       默认 ~/.verse/tui.toml      TUI 偏好（agent/speed/persist/shot/check）
  <repo>/.verse/local.toml   项目级覆盖（标量替换、表递归深合并）
  唯一环境变量 VERSE_HOME = 换配置目录，不参与业务配置。坏文件 = 警告+回退默认，不中断启动。
  密钥：providers.<name>.api_key 明文存文件；config/get 只下发 "***set***"|"",明文永不外传。
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import traceback
from pathlib import Path
from typing import Any, cast

import websockets
from agent_framework import (
    Content,
    FileHistoryProvider,
    Message,
    create_harness_agent,
    get_agent_mode,
    set_agent_mode,
)
from websockets.asyncio.server import serve

from config import ConfigError, load_config, resolve_provider_key, sanitize

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

# ── 配置装配：唯一来源是 TOML（见 config.py）────────────────────────
CFG, TUI, CFG_FILES = load_config(REPO_ROOT)
GW = CFG["gateway"]
HOST = str(GW.get("host", "127.0.0.1"))
PORT = int(GW.get("port", 8765))
WORKSPACE = Path(GW["workspace"]) if GW.get("workspace") else REPO_ROOT / ".agent-sandbox"
HISTORY_DIR = Path(GW["history"]) if GW.get("history") else HERE / "history"
MAX_RUN_SECONDS = 300

WORKSPACE.mkdir(parents=True, exist_ok=True)
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
WORKSPACE, HISTORY_DIR = WORKSPACE.resolve(), HISTORY_DIR.resolve()
GW["workspace"], GW["history"] = str(WORKSPACE), str(HISTORY_DIR)  # config/get 展示解析后路径
# 工具的文件/命令落在工作区，与历史文件分开
os.chdir(WORKSPACE)

logging.basicConfig(
    level=str(GW.get("log_level", "INFO")).upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
# 框架的 ExperimentalWarning 对使用者无意义（FileHistoryProvider 标记为实验特性），只降级不隐藏错误
logging.getLogger("agent_framework").addFilter(
    type("_F", (logging.Filter,), {"filter": lambda self, r: "ExperimentalWarning" not in r.getMessage()})()
)
log = logging.getLogger("verse-agent-rpc")

DEFAULT_MODEL_ALIAS = str(CFG.get("default_model", ""))
DEFAULT_MODE = str(CFG.get("default_mode", "plan"))

def _resolve(model_ref: str) -> tuple[str, str, dict, dict]:
    """model ref（[models] 别名，或裸 model id）→ (provider 名, 真实 model id, provider 表, 模型表)。

    模型表是 load_config 应用过 overrides 的 effective 视图；裸 id 没有别名表，返回空 dict
    （向后兼容 model/set 传裸 id——绑到 default_model 所属 provider）。
    """
    mdef = CFG["models"].get(model_ref) or {}
    if not mdef:  # 裸 id：绑到 default_model 所属 provider（向后兼容 model/set 传裸 id）
        d = CFG["models"].get(DEFAULT_MODEL_ALIAS)
        if d is None:
            raise ConfigError(f"default_model {DEFAULT_MODEL_ALIAS!r} 不在 [models] 里（检查 config.toml）")
        pname, raw = str(d["provider"]), model_ref
    else:
        pname, raw = str(mdef["provider"]), str(mdef["model"])
    pdef = CFG["providers"].get(pname)
    if pdef is None:
        raise ConfigError(f"providers 里没有 {pname!r}（检查 config.toml / local.toml）")
    return pname, raw, pdef, mdef


DEFAULT_MAX_OUTPUT_TOKENS = 16_384   # max_context_size 配了但 max_output_size 没配时的输出预留


def _compaction_kwargs(mdef: dict) -> dict[str, Any]:
    """Kimi 同款上下文三件套 → harness 压缩预算（ContextWindowCompactionStrategy）。

    不配 max_context_size = 完全不启用压缩（现状行为）。策略的 input_budget = 窗口 - 输出；
    max_input_size（Kimi：压缩/溢出预算优先用它）通过 window = min(ctx, in + out) 让
    input_budget 恰好等于 min(max_input_size, ctx - out)，绝不虚高过真实窗口。
    """
    max_ctx = int(mdef.get("max_context_size") or 0)
    if max_ctx <= 0:
        return {}
    max_out = int(mdef.get("max_output_size") or 0) or DEFAULT_MAX_OUTPUT_TOKENS
    max_in = int(mdef.get("max_input_size") or 0)
    window = min(max_ctx, max_in + max_out) if max_in > 0 else max_ctx
    return {"max_context_window_tokens": window, "max_output_tokens": max_out}


def _build_agent(model_ref: str):
    """按 model ref 造 chat client + harness agent（启动、model/set、惰性重建共用）。

    切换 = 整体重建：plan/todos（内存 SessionStore）随之重置，
    对话历史在 FileHistoryProvider 磁盘 JSONL 里不受影响。
    """
    pname, raw, pdef, mdef = _resolve(model_ref)
    api_key = resolve_provider_key(pdef)
    if not api_key:
        raise ConfigError(f"provider {pname!r} 没有 api_key（providers.{pname}.api_key 或其 env 子表）")
    if str(pdef.get("type", "openai")).lower() == "openai_responses":
        from agent_framework.openai import (
            OpenAIChatClient as ClientCls,  # Responses API
        )
    else:
        from agent_framework.openai import (
            OpenAIChatCompletionClient as ClientCls,  # Chat Completions
        )
    # Kimi 同款：模型级 base_url 优先于 provider 的（[models.x].base_url 覆盖 [providers.y].base_url）
    base_url = str(mdef.get("base_url") or pdef.get("base_url") or "")
    cli = ClientCls(model=raw, base_url=(base_url or None), api_key=api_key)
    ag = create_harness_agent(
        # 框架 harness 的注解只认 Responses 家族的 Options 协议，Chat Completions 客户端
        # 运行时完全可用但静态判不兼容（Options 类型缺 include/prompt 等字段）——cast 收窄
        cast(Any, cli),
        name="verse-agent",
        # 对话历史：每 session 一个 append-only JSONL，跨连接/跨进程恢复（load_messages=True）
        history_provider=FileHistoryProvider(HISTORY_DIR),
        # 兼容端点（wb2api/8788 等）没有服务端会话：store=False 让本地文件成为历史唯一来源
        default_options={"store": False},
        **_compaction_kwargs(mdef),
        # 文件/命令工具收敛在 WORKSPACE 内，且不触发审批等待（协议没有审批通道）
        file_access_disable_write_tool_approval=True,
        file_access_disable_readonly_tool_approval=True,
        disable_web_search=True,
    )
    return cli, ag, raw, pname


# ── 启动装配（惰性）──────────────────────────────────────────────────
# 配置缺失/无 key 不再让进程崩掉：config/get 照常可用，首条需要 agent 的请求会重试，
# 仍失败则回 -32000 + 中文原因（而不是启动时甩一段 SettingNotFoundError 栈）。
MODEL = DEFAULT_MODEL_ALIAS      # 当前 model 的权威回显（initialize.result.model）
PROVIDER = ""                    # 当前 provider 表名
client = agent = None
EFFORT = ""                      # 当前思考档位（Kimi 同款语义；空 = 不向端点发思考参数）


def _ensure_agent() -> None:
    """惰性装配：启动失败后的首个 chat / mode 请求在此重试（ConfigError → -32000）。"""
    global client, agent, PROVIDER
    if agent is None:
        client, agent, _, PROVIDER = _build_agent(MODEL)
        _calibrate_effort(MODEL)


# ── 思考档位（thinking，Kimi Code 同款语义）──────────────────────────
# support_efforts 配了就强校验（列表外 -32602）；没配用默认档位表（不含 max——responses
# 客户端的 ReasoningOptions.effort 上限是 xhigh，配了 support_efforts 才按配置透传）。
# off 是用户-facing 档位：下发时映射到 off_effort（没配则端点通用的 "none"）。
# EFFORT 是全局状态（对齐 model/set），但切换不重建 harness——每轮 run options 注入，
# plan/todos 不受影响。模型没配 default_effort/support_efforts 时 EFFORT 保持空 = 不发参数。
DEFAULT_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"]


def _thinking_support(model_ref: str) -> dict[str, Any]:
    """模型的 thinking 能力视图（effective 模型表；裸 id / 未配置字段给空值）。"""
    mdef = CFG["models"].get(model_ref) or {}
    return {
        "support_efforts": [str(e) for e in mdef.get("support_efforts", [])],
        "default_effort": str(mdef.get("default_effort", "")),
        "off_effort": str(mdef.get("off_effort", "")),
        "capabilities": [str(c) for c in mdef.get("capabilities", [])],
    }


def _calibrate_effort(model_ref: str) -> None:
    """装配/切模型后校准 EFFORT：当前档位仍被支持（或模型没配支持表）就保留，
    否则回落 default_effort；空 EFFORT 也借此吃到模型默认档。"""
    global EFFORT
    sup = _thinking_support(model_ref)
    if EFFORT and sup["support_efforts"] and EFFORT not in sup["support_efforts"]:
        log.info("思考档位 %r 不在模型 %s 的 support_efforts 里，回落 default_effort=%r",
                 EFFORT, model_ref, sup["default_effort"])
        EFFORT = sup["default_effort"]
    elif not EFFORT:
        EFFORT = sup["default_effort"]


def _effort_wire_value() -> str | None:
    """EFFORT → 发给端点的 effort 编码；None = 不发参数（完全向后兼容）。"""
    if not EFFORT:
        return None
    if EFFORT == "off":
        return _thinking_support(MODEL)["off_effort"] or "none"
    return EFFORT


def _effort_run_options() -> dict[str, Any] | None:
    """当前档位 → agent.run 的 options，键形按 provider type 分：responses 用嵌套
    reasoning.effort，chat completions 用顶层 reasoning_effort（库原样透传给 SDK）。"""
    effort = _effort_wire_value()
    if effort is None:
        return None
    pdef = CFG["providers"].get(PROVIDER) or {}
    if str(pdef.get("type", "openai")).lower() == "openai_responses":
        return {"reasoning": {"effort": effort}}
    return {"reasoning_effort": effort}


# ── 多模态输入（agent/chat params.images，Kimi capabilities.image_in 门控）────
MAX_IMAGE_B64_BYTES = 12 * 1024 * 1024   # base64 编码后的单图上限（≈9MB 原始 PNG）
MAX_IMAGES_PER_TURN = 4


def _images_error(images: Any) -> str | None:
    """params.images 校验：合法返回 None，否则回中文错误消息（→ -32602）。"""
    if not isinstance(images, list):
        return "params.images 必须是数组"
    if len(images) > MAX_IMAGES_PER_TURN:
        return f"images 最多 {MAX_IMAGES_PER_TURN} 张"
    for i, img in enumerate(images):
        if not isinstance(img, dict):
            return f"images[{i}] 必须是对象"
        mt = str(img.get("media_type") or "")
        data = img.get("data")
        if not mt.startswith("image/"):
            return f"images[{i}].media_type 必须是 image/*（收到 {mt!r}）"
        if not isinstance(data, str) or not data:
            return f"images[{i}].data 必须是非空 base64 字符串"
        if len(data) > MAX_IMAGE_B64_BYTES:
            return f"images[{i}] 超过单图 12MB 上限"
        try:
            base64.b64decode(data, validate=True)
        except (TypeError, ValueError):
            return f"images[{i}].data 不是合法 base64"
    return None


def _model_accepts_images(model_ref: str) -> bool:
    """capabilities 门控：模型在 [models] 里声明 image_in 才放行。

    capabilities 未配置的模型保守视为不支持（Kimi 语义是显式追加式标签，
    宁可拒绝也不把图片扔给可能不消费的端点）。
    """
    mdef = CFG["models"].get(model_ref) or {}
    caps = mdef.get("capabilities")
    if not isinstance(caps, list) or not caps:
        return False
    return "image_in" in [str(c) for c in caps]


try:
    _ensure_agent()
    log.info(
        "harness agent ready provider=%s model=%s config=%s history=%s workspace=%s",
        PROVIDER, MODEL, CFG_FILES or "（无，全部默认值）", HISTORY_DIR, WORKSPACE,
    )
except ConfigError as e:
    log.warning("启动时未装配 agent（config/get 照常可用，需要 agent 的请求会重试）：%s", e)

# ── chunk → 事件映射 ──────────────────────────────────────────────────
# 模型的思考（chunk text_reasoning）：
#   wb2api(cn:hy3) 不返回思考字段 → 永远没有 thinking_delta；
#   端点若支持 reasoning_details（OpenRouter/vLLM）就会出现。前端要兼容缺席。
# 工具调用（chunk function_call）：arguments 是增量分片，等 finish_reason=tool_calls
# 拼完整、JSON 解析后才发 tool_start（带完整 params）——跨 chunk 状态留在服务端。


def _event(session: str, ev: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "method": "agent/event",
            "params": {"session": session, "event": ev}}


# ── 会话对象复用（plan/todos/mode 跨轮持久的地基）─────────────────────
# 源码事实：AgentSession 只是 {session_id, state} 轻量容器，run() 不会从任何 store
# 里自动水合 state——每轮 new 一个会话对象，provider state（Todo/plan/agent_mode）
# 每轮都会清零。这里按 sid 复用同一个对象，harness 才能跨轮记住状态（与官方
# Harness 文档「keep an AgentSession」一致）。内存级：进程重启即丢；
# 对话历史另有 FileHistoryProvider JSONL，不受影响。
_SESSION_CACHE: dict[str, Any] = {}


def _get_session(sid: str):
    # 调用链保证 agent 已装配（handle_chat 先 _ensure_agent() 成功才会走到这里），
    # assert 既安抚 pyright 的 Optional 推断，也让不变量被破坏时尽早暴露
    assert agent is not None, "agent 未装配（_ensure_agent 应先成功）"
    sess = _SESSION_CACHE.get(sid)
    if sess is None:
        sess = agent.create_session(session_id=sid)
        if DEFAULT_MODE != "plan":
            # 新会话按 config 的 default_mode 起步（notify=False：这是初始值，不是变更，不注入通知）
            try:
                set_agent_mode(sess, DEFAULT_MODE, notify=False)
            except Exception as exc:  # noqa: BLE001 —— 配置值非法不致命，回落框架默认 plan
                log.warning("default_mode=%r 应用失败，回落默认 plan：%s", DEFAULT_MODE, exc)
        _SESSION_CACHE[sid] = sess
    return sess


async def _stream_turn(ws, session: str, prompt: str, send_lock,
                       images: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """跑一轮 harness，把每个 AgentResponseUpdate 转成事件。返回 result 对象。"""
    sess = _get_session(session)
    assert agent is not None, "agent 未装配（_ensure_agent 应先成功）"

    answer: list[str] = []
    usage: dict[str, Any] | None = None
    pending: dict[str, dict[str, Any]] = {}   # call_id -> {name, args}
    tool_names: dict[str, str] = {}

    async def emit(ev: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send(json.dumps(_event(session, ev), ensure_ascii=False))

    # 思考档位按轮注入（thinking/set 改全局 EFFORT，下一轮生效；空 = 不发参数）
    run_opts = _effort_run_options()
    if images:
        # 多模态：文本 + 图片内容项合成一条 user 消息（AgentRunInputs 接受 Message，
        # Content.from_data 生成 data URI 内容项，编码交给端点）
        contents: list[Any] = [Content.from_text(prompt)]
        contents += [
            Content.from_data(base64.b64decode(img["data"]), media_type=img["media_type"])
            for img in images
        ]
        turn_input: Any = Message("user", contents)
    else:
        turn_input = prompt
    async for chunk in agent.run(turn_input, session=sess, stream=True, options=run_opts):
        for c in chunk.contents:
            ctype = getattr(c, "type", "")
            if ctype == "text":
                text = getattr(c, "text", "") or ""
                if text:
                    answer.append(text)
                    await emit({"type": "answer_delta", "text": text})
            elif ctype == "text_reasoning":
                # 思考内容与正文严格分离（.text 不含它），只有端点提供时才会走到这
                t = getattr(c, "text", "") or ""
                if t:
                    await emit({"type": "thinking_delta", "text": t})
            elif ctype == "function_call":
                cid = str(getattr(c, "call_id", "") or "")
                entry = pending.setdefault(cid, {"name": "", "args": ""})
                if getattr(c, "name", ""):
                    entry["name"] = c.name
                if getattr(c, "arguments", ""):
                    entry["args"] += c.arguments
            elif ctype == "function_result":
                cid = str(getattr(c, "call_id", "") or "")
                result = getattr(c, "result", "")
                text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                await emit({"type": "tool_line", "id": cid, "text": text[:4000]})
                await emit({"type": "tool_end", "id": cid, "status": "ok"})
            elif ctype == "usage":
                usage = getattr(c, "usage_details", None)

        if chunk.finish_reason == "tool_calls" and pending:
            for cid, p in pending.items():
                try:
                    params = json.loads(p["args"]) if p["args"] else {}
                except (TypeError, ValueError):   # JSONDecodeError ⊂ ValueError；args 异常时按空参数继续
                    params = {}
                    log.warning("tool arguments 非法 call_id=%s", cid)
                if not isinstance(params, dict):
                    params = {"value": params}
                first = next((v for v in params.values() if isinstance(v, str)), "")
                arg = f"{p['name']} {first}" if first else p["name"]
                tool_names[cid] = p["name"]
                await emit({"type": "tool_start", "id": cid, "name": p["name"],
                            "arg": arg[:120], "params": params})
            pending.clear()
            await emit({"type": "thinking_end"})

    return {"ok": True, "text": "".join(answer), "usage": usage}


# ── JSON-RPC 分发 ─────────────────────────────────────────────────────

async def handle_chat(ws, rid, params, tasks, send_lock) -> None:
    session = str(params.get("session") or "").strip()
    prompt = params.get("prompt")
    if not session:
        await _send(ws, send_lock, _err(rid, -32602, "params.session 必须是非空字符串"))
        return
    if not isinstance(prompt, str) or not prompt.strip():
        await _send(ws, send_lock, _err(rid, -32602, "params.prompt 必须是非空字符串"))
        return
    images = params.get("images")
    if images is not None:
        if err := _images_error(images):
            await _send(ws, send_lock, _err(rid, -32602, err))
            return
        if not _model_accepts_images(MODEL):
            await _send(ws, send_lock, _err(
                rid, -32602, f"当前模型 {MODEL!r} 未声明 image_in 能力（[models.{MODEL}].capabilities）"))
            return
    try:
        _ensure_agent()   # 参数校验之后才装配：坏参数仍回 -32602，配置缺失才 -32000
    except ConfigError as e:
        await _send(ws, send_lock, _err(rid, -32000, str(e)))
        return

    async def run():
        try:
            result = await asyncio.wait_for(
                _stream_turn(ws, session, prompt, send_lock, images), timeout=MAX_RUN_SECONDS
            )
            await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": result})
        except asyncio.CancelledError:
            # 客户端 Esc / agent/cancel：补发 -32001 终态，让等待方不悬挂
            log.info("轮次被取消 rid=%s，补发 -32001", rid)
            try:
                await _send(ws, send_lock, _err(rid, -32001, "cancelled"))
                log.info("-32001 已发送 rid=%s", rid)
            except Exception as exc:  # noqa: BLE001 —— 连接可能已断，尽力而为
                log.warning("-32001 发送失败 rid=%s: %r", rid, exc)
            raise
        except Exception as exc:  # noqa: BLE001 —— 全部转成 JSON-RPC error
            log.error("agent/chat 失败: %s\n%s", exc, traceback.format_exc(limit=4))
            msg = str(exc)
            if "timed out" in msg or "Timeout" in type(exc).__name__:
                msg = f"本轮超过 {MAX_RUN_SECONDS}s 超时"
            await _send(ws, send_lock, _err(rid, -32000, msg[:600]))
        finally:
            tasks.pop(session, None)

    tasks[session] = asyncio.create_task(run())


def _err(rid, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


async def _send(ws, lock, payload: dict[str, Any]) -> None:
    async with lock:
        await ws.send(json.dumps(payload, ensure_ascii=False))


async def handler(ws) -> None:
    """一条连接的收发循环：请求分发 + 每连接串行化发送。"""
    # model/set 会换掉模块级的 MODEL/PROVIDER/client/agent（全局，只加不改的协议扩展）；
    # thinking/set 换 EFFORT（同属全局状态，见 handler 的 thinking/set 分支）
    global MODEL, PROVIDER, client, agent, EFFORT
    remote = getattr(ws, "remote_address", None)
    log.info("连接 %s", remote)
    send_lock = asyncio.Lock()
    tasks: dict[str, asyncio.Task] = {}
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:  # noqa: BLE001 —— raw 是对端任意输入，任何解析异常都只回 -32700，不能杀收发循环
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": None, "error": {
                    "code": -32700, "message": "Parse error"}})
                continue
            if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": msg.get("id"),
                                            "error": {"code": -32600, "message": "Invalid Request"}})
                continue

            method = msg.get("method")
            rid = msg.get("id")
            params = msg.get("params") or {}

            if method == "agent/chat":                      # 异步起任务，继续收后续消息（可 cancel）
                if rid is None:
                    continue
                busy = tasks.get(str(params.get("session") or ""))
                if busy and not busy.done():
                    await _send(ws, send_lock, _err(rid, -32003, "该会话上一轮还在跑，先 agent/cancel"))
                    continue
                await handle_chat(ws, rid, params, tasks, send_lock)
            elif method == "agent/cancel":                  # 请求：应答 {cancelled}；被取消轮补发 -32001
                sid = str(params.get("session") or "")
                task = tasks.get(sid)
                if task is not None and not task.done():
                    task.cancel()
                    log.info("已取消会话 %s 的轮次", sid)
                    cancelled = True
                else:
                    cancelled = False
                if rid is not None:
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid,
                                                "result": {"cancelled": cancelled}})
            elif method == "agent/reset":                   # 清掉该会话的服务端内存状态
                sid = str(params.get("session") or "")
                # _sessions 是框架 Agent 未公开的映射，getattr 兜住未来改名（拿不到就当无会话可清）
                sessions = getattr(agent, "_sessions", None)
                if sessions is not None and sid in sessions:
                    sessions.pop(sid, None)
                _SESSION_CACHE.pop(sid, None)
                if rid is not None:
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid,
                                                "result": {"reset": True}})
            elif rid is None:
                pass                                        # 未知通知：忽略
            elif method == "initialize":
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                    "server": "verse-agent-backend", "version": "1.0.0",
                    "provider": PROVIDER, "model": MODEL,
                    "methods": ["initialize", "ping", "agent/chat", "agent/cancel", "agent/reset",
                                "model/set", "thinking/get", "thinking/set",
                                "mode/get", "mode/set", "config/get"]}})
            elif method == "thinking/get":                 # 读当前思考档位与模型支持表
                sup = _thinking_support(MODEL)
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                    "effort": EFFORT, "model": MODEL,
                    "support_efforts": sup["support_efforts"] or DEFAULT_EFFORT_LEVELS,
                    "default_effort": sup["default_effort"], "off_effort": sup["off_effort"],
                    "capabilities": sup["capabilities"]}})
            elif method == "thinking/set":                 # 设思考档位（全局，下一轮生效，不重建 harness）
                val = str(params.get("effort") or "").strip().lower()
                sup = _thinking_support(MODEL)
                allowed = sup["support_efforts"] or DEFAULT_EFFORT_LEVELS
                if not val:
                    await _send(ws, send_lock, _err(rid, -32602, "params.effort 必须是非空字符串"))
                elif val != "off" and val not in allowed:
                    await _send(ws, send_lock, _err(
                        rid, -32602, f"effort {val!r} 不受支持（可选：{'/'.join([*allowed, 'off'])}）"))
                else:
                    EFFORT = val
                    log.info("思考档位切换为 %s（model=%s）", EFFORT or "（未设置）", MODEL)
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {"effort": EFFORT}})
            elif method == "config/get":                   # 脱敏配置视图 + 实际读到的 toml（明文 key 永不下发）
                view = sanitize(CFG, TUI)
                view["thinking"] = {"effort": EFFORT}      # 前端重连后恢复档位显示（不进 toml，非配置）
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                    "config": view, "sources": CFG_FILES}})
            elif method == "model/set":                    # 切服务端默认模型（重建 client+harness）
                new_model = str(params.get("model") or "").strip()
                if not new_model:
                    await _send(ws, send_lock, _err(rid, -32602, "model 不能为空"))
                elif any(t and not t.done() for t in tasks.values()):
                    # 本连接有轮次在跑：重建 harness 会把进行中的会话对象抽掉
                    await _send(ws, send_lock, _err(rid, -32003, "本连接有轮次在跑，等本轮结束再 model/set"))
                else:
                    try:
                        new_client, new_agent, _, pname = _build_agent(new_model)
                    except ConfigError as e:
                        await _send(ws, send_lock, _err(rid, -32000, str(e)))
                    else:
                        client, agent, MODEL, PROVIDER = new_client, new_agent, new_model, pname
                        _calibrate_effort(new_model)   # 新模型不支持当前档位时回落 default_effort
                        _SESSION_CACHE.clear()   # 旧会话对象的 provider state 归属旧 agent，一并丢弃
                        log.info("model 切换为 %s（harness 已重建，plan/todos/mode 重置，磁盘历史保留）", MODEL)
                        await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                            "model": MODEL, "provider": PROVIDER, "rebuilt": True}})
            elif method == "mode/get":                     # 读该会话的 harness 模式（默认见 config default_mode）
                try:
                    _ensure_agent()
                except ConfigError as e:
                    await _send(ws, send_lock, _err(rid, -32000, str(e)))
                    continue
                sid = str(params.get("session") or "")
                sess = _get_session(sid)
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                    "session": sid, "mode": get_agent_mode(sess)}})
            elif method == "mode/set":                     # 切该会话的 plan/execute 模式
                sid = str(params.get("session") or "").strip()
                mode = str(params.get("mode") or "").strip()
                if not sid or not mode:
                    await _send(ws, send_lock, _err(rid, -32602,
                                                    "params.session 与 params.mode 必须是非空字符串"))
                    continue
                try:
                    _ensure_agent()
                except ConfigError as e:
                    await _send(ws, send_lock, _err(rid, -32000, str(e)))
                    continue
                sess = _get_session(sid)
                previous = get_agent_mode(sess)
                if mode == previous:
                    # 同值不重发通知：set_agent_mode(notify) 会往下一轮注入 Mode changed 消息
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                        "session": sid, "mode": mode, "previous": previous,
                        "changed": False, "notify": False}})
                else:
                    try:
                        set_agent_mode(sess, mode)     # 非法值抛 ValueError → -32602
                    except ValueError as exc:
                        await _send(ws, send_lock, _err(rid, -32602, f"非法 mode: {exc}"))
                    else:
                        log.info("会话 %s 模式切换 %s → %s（下一轮生效）", sid, previous, mode)
                        await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                            "session": sid, "mode": mode, "previous": previous,
                            "changed": True, "notify": True}})
            elif method == "ping":
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid,
                                            "result": {"pong": True}})
            else:
                await _send(ws, send_lock, _err(rid, -32601, f"method not found: {method}"))
    except websockets.ConnectionClosed:
        pass
    finally:
        for task in tasks.values():
            task.cancel()
        log.info("断开 %s", remote)


async def main() -> None:
    async with serve(handler, HOST, PORT, max_size=4 * 1024 * 1024) as server:
        log.info("verse-agent-backend listening ws://%s:%d", HOST, PORT)
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
