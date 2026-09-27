"""JSON-RPC 方法分发表 —— 协议方法名 → 处理器（一处声明，initialize 的能力清单与它对齐）。

处理器统一形如 `async def h_x(conn, rid, params) -> None`，自己经 conn 发出应答
（因为 agent/chat 的终态由后台任务延迟发出，分发层不能替它回）。
连接级的两条约束留在本层：
  - agent/chat 必须带 id（无 id 的轮次无法归属终态 → 忽略）；
  - 同会话已有轮次在跑 → -32003（防同会话并行写历史）。
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

import methods_agent
import methods_config
import methods_model
import methods_session
import methods_theme
import rpc_protocol
from rpc_protocol import Conn

log = logging.getLogger("verse-agent-rpc")

Handler = Callable[[Conn, Any, dict], Awaitable[None]]

HANDLERS: dict[str, Handler] = {
    "agent/chat": methods_agent.h_chat,
    "agent/cancel": methods_agent.h_cancel,
    "agent/reset": methods_agent.h_reset,
    "model/set": methods_model.h_model_set,
    "thinking/get": methods_model.h_thinking_get,
    "thinking/set": methods_model.h_thinking_set,
    "mode/get": methods_session.h_mode_get,
    "mode/set": methods_session.h_mode_set,
    "theme/list": methods_theme.h_theme_list,
    "theme/set": methods_theme.h_theme_set,
    "config/get": methods_config.h_config_get,
    "initialize": methods_config.h_initialize,
    "ping": methods_config.h_ping,
}


async def dispatch(conn: Conn, msg: dict) -> None:
    """一条已通过信封校验的请求 → 对应处理器；未知方法 -32601，未知通知忽略。"""
    method = msg.get("method")
    rid = msg.get("id")
    params = msg.get("params") or {}

    if method == "agent/chat":                      # 异步起任务，继续收后续消息（可 cancel）
        if rid is None:
            return
        busy = conn.tasks.get(str(params.get("session") or ""))
        if busy and not busy.done():
            await conn.fail(rid, rpc_protocol.SESSION_BUSY, "该会话上一轮还在跑，先 agent/cancel")
            return
        await methods_agent.h_chat(conn, rid, params)
        return

    handler = HANDLERS.get(method) if isinstance(method, str) else None
    if handler is None:
        if rid is None:
            return                                  # 未知通知：忽略
        await conn.fail(rid, rpc_protocol.METHOD_NOT_FOUND, f"method not found: {method}")
        return
    await handler(conn, rid, params)
