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
  {"jsonrpc":"2.0","id":9,"method":"agent/cancel","params":{"session":"<sid>"}}
      → 应答 {"result":{"cancelled":true|false}}；被取消那轮的 chat 请求另收 -32001 终态
  {"jsonrpc":"2.0","id":2,"method":"agent/reset","params":{"session":"<sid>"}}
  {"jsonrpc":"2.0","id":7,"method":"model/set","params":{"model":"<模型 id>"}}
      → 应答 {"result":{"model":"<新 id>","provider":...,"rebuilt":true}}
      → 语义：切服务端默认模型 = 重建 chat client + harness agent（全局生效，
        影响后续所有轮次）；plan/todos 随 harness 重建重置，磁盘历史不受影响。
        有轮次在跑时拒绝（-32003）；空 model → -32602。
        initialize.result.model 是当前 model 的权威回显，客户端据此显示。
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

配置（环境变量，全部可选，密钥绝不打印）：
  AGENT_RPC_HOST=127.0.0.1     仅监听本机；改 0.0.0.0 前先想清楚安全边界
  AGENT_RPC_PORT=8765
  AGENT_RPC_PROVIDER=wb2api    wb2api | openai(Responses API 端点)
  AGENT_RPC_BASE_URL           默认按 provider 取
  AGENT_RPC_MODEL=cn:hy3
  AGENT_RPC_API_KEY            默认取 HERMES_CUSTOM_WORKBUDDY_PROXY_API_KEY
  AGENT_RPC_HISTORY            历史目录（默认 <backend>/history，每 session 一个 JSONL）
  AGENT_RPC_WORKSPACE          agent 工具工作区（默认 <repo>/.agent-sandbox）
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import traceback
import uuid
from pathlib import Path
from typing import Any

import websockets
from websockets.asyncio.server import serve

from agent_framework import FileHistoryProvider, create_harness_agent

HERE = Path(__file__).resolve().parent
HOST = os.environ.get("AGENT_RPC_HOST", "127.0.0.1")
PORT = int(os.environ.get("AGENT_RPC_PORT", "8765"))
PROVIDER = os.environ.get("AGENT_RPC_PROVIDER", "wb2api").lower()
WORKSPACE = Path(os.environ.get("AGENT_RPC_WORKSPACE") or HERE.parent / ".agent-sandbox")
HISTORY_DIR = Path(os.environ.get("AGENT_RPC_HISTORY") or HERE / "history")
MAX_RUN_SECONDS = 300

# ── provider 装配 ─────────────────────────────────────────────────────
# 唯一允许的 agent 底座：agent-framework 的 create_harness_agent。
# 新增模型接入 = 在这里加一个 provider 分支，不改协议、不改事件模型。
if PROVIDER == "wb2api":
    BASE_URL = os.environ.get("AGENT_RPC_BASE_URL", "http://127.0.0.1:7863/v1")
    MODEL = os.environ.get("AGENT_RPC_MODEL", "cn:hy3")
    API_KEY = os.environ.get("AGENT_RPC_API_KEY") or os.environ.get(
        "HERMES_CUSTOM_WORKBUDDY_PROXY_API_KEY", ""
    )
else:  # openai：Responses API 端点（OpenAIChatClient，STORES_BY_DEFAULT=True）
    BASE_URL = os.environ.get("AGENT_RPC_BASE_URL", "https://88api.ai/v1")
    MODEL = os.environ.get("AGENT_RPC_MODEL", "deepseek-v4.1-flash")
    API_KEY = os.environ.get("AGENT_RPC_API_KEY") or os.environ.get(
        "HERMES_CUSTOM_88API_API_KEY", ""
    )

WORKSPACE.mkdir(parents=True, exist_ok=True)
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
# 工具的文件/命令落在工作区（等价前端的 VT_AGENT_ROOT），与历史文件分开
os.chdir(WORKSPACE)

logging.basicConfig(
    level=os.environ.get("AGENT_RPC_LOG", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
# 框架的 ExperimentalWarning 对使用者无意义（FileHistoryProvider 标记为实验特性），只降级不隐藏错误
logging.getLogger("agent_framework").addFilter(
    type("_F", (logging.Filter,), {"filter": lambda self, r: "ExperimentalWarning" not in r.getMessage()})()
)
log = logging.getLogger("verse-agent-rpc")

if PROVIDER == "wb2api":
    from agent_framework.openai import OpenAIChatCompletionClient as _ClientCls
else:
    from agent_framework.openai import OpenAIChatClient as _ClientCls

def _build_agent(model: str):
    """按指定 model 造 chat client + harness agent（启动时与 model/set 切换时共用）。

    切换 = 整体重建：plan/todos（内存 SessionStore）随之重置，
    对话历史在 FileHistoryProvider 磁盘 JSONL 里不受影响。
    """
    cli = _ClientCls(model=model, base_url=BASE_URL, api_key=API_KEY or None)
    ag = create_harness_agent(
        cli,
        name="verse-agent",
        # 对话历史：每 session 一个 append-only JSONL，跨连接/跨进程恢复（load_messages=True）
        history_provider=FileHistoryProvider(HISTORY_DIR),
        # PROVIDER=openai 时 OpenAIChatClient 默认服务端存会话，会跳过本地历史加载——
        # 88api 这类兼容端点没有服务端会话，必须显式 store=False 让本地文件成为历史唯一来源
        default_options={"store": False},
        # 文件/命令工具收敛在 WORKSPACE 内，且不触发审批等待（协议没有审批通道）
        file_access_disable_write_tool_approval=True,
        file_access_disable_readonly_tool_approval=True,
        disable_web_search=True,
    )
    return cli, ag


client, agent = _build_agent(MODEL)
log.info(
    "harness agent ready provider=%s model=%s base=%s history=%s workspace=%s",
    PROVIDER, MODEL, BASE_URL, HISTORY_DIR, WORKSPACE,
)

# ── chunk → 事件映射 ──────────────────────────────────────────────────
# 模型的思考（chunk text_reasoning）：
#   wb2api(cn:hy3) 不返回思考字段 → 永远没有 thinking_delta；
#   端点若支持 reasoning_details（OpenRouter/vLLM）就会出现。前端要兼容缺席。
# 工具调用（chunk function_call）：arguments 是增量分片，等 finish_reason=tool_calls
# 拼完整、JSON 解析后才发 tool_start（带完整 params）——跨 chunk 状态留在服务端。


def _event(session: str, ev: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "method": "agent/event",
            "params": {"session": session, "event": ev}}


async def _stream_turn(ws, session: str, prompt: str, send_lock) -> dict[str, Any]:
    """跑一轮 harness，把每个 AgentResponseUpdate 转成事件。返回 result 对象。"""
    sess = agent.create_session(session_id=session)

    answer: list[str] = []
    usage: dict[str, Any] | None = None
    pending: dict[str, dict[str, Any]] = {}   # call_id -> {name, args}
    tool_names: dict[str, str] = {}

    async def emit(ev: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send(json.dumps(_event(session, ev), ensure_ascii=False))

    async for chunk in agent.run(prompt, session=sess, stream=True):
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
                except Exception:
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

    async def run():
        try:
            result = await asyncio.wait_for(
                _stream_turn(ws, session, prompt, send_lock), timeout=MAX_RUN_SECONDS
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
    # model/set 会换掉模块级的 MODEL/client/agent（全局，只加不改的协议扩展）
    global MODEL, client, agent
    remote = getattr(ws, "remote_address", None)
    log.info("连接 %s", remote)
    send_lock = asyncio.Lock()
    tasks: dict[str, asyncio.Task] = {}
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
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
                cancelled = bool(task and not task.done())
                if cancelled:
                    task.cancel()
                    log.info("已取消会话 %s 的轮次", sid)
                if rid is not None:
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid,
                                                "result": {"cancelled": cancelled}})
            elif method == "agent/reset":                   # 清掉该会话的服务端内存状态
                sid = str(params.get("session") or "")
                if sid in agent._sessions:
                    agent._sessions.pop(sid, None)
                if rid is not None:
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid,
                                                "result": {"reset": True}})
            elif rid is None:
                pass                                        # 未知通知：忽略
            elif method == "initialize":
                await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                    "server": "verse-agent-backend", "version": "1.0.0",
                    "provider": PROVIDER, "model": MODEL,
                    "methods": ["initialize", "ping", "agent/chat", "agent/cancel", "agent/reset", "model/set"]}})
            elif method == "model/set":                    # 切服务端默认模型（重建 client+harness）
                new_model = str(params.get("model") or "").strip()
                if not new_model:
                    await _send(ws, send_lock, _err(rid, -32602, "model 不能为空"))
                elif any(t and not t.done() for t in tasks.values()):
                    # 本连接有轮次在跑：重建 harness 会把进行中的会话对象抽掉
                    await _send(ws, send_lock, _err(rid, -32003, "本连接有轮次在跑，等本轮结束再 model/set"))
                else:
                    MODEL = new_model
                    client, agent = _build_agent(MODEL)
                    log.info("model 切换为 %s（harness 已重建，plan/todos 重置，磁盘历史保留）", MODEL)
                    await _send(ws, send_lock, {"jsonrpc": "2.0", "id": rid, "result": {
                        "model": MODEL, "provider": PROVIDER, "rebuilt": True}})
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
