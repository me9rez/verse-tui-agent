"""会话模式域的方法实现 —— mode/get · mode/set（harness 的 plan/execute，按会话隔离）。

模式是指令级切换（AgentModeProvider，state["agent_mode"]），下一轮生效；
changed=true 时框架自动往下一轮注入 [Mode changed] 通知，同值切换不重发通知。
依赖服务端会话对象复用（runtime.RT.sessions），进程重启后回到默认。
"""
from __future__ import annotations

import logging
from typing import Any

import rpc_protocol
import runtime
from config import ConfigError
from rpc_protocol import Conn

log = logging.getLogger("verse-agent-rpc")


async def h_mode_get(conn: Conn, rid: Any, params: dict) -> None:
    sid = str(params.get("session") or "")
    try:
        runtime.ensure_agent()
    except ConfigError as e:
        await conn.fail(rid, rpc_protocol.RUN_FAILED, str(e))
        return
    sess = runtime.session_for(sid)
    await conn.reply(rid, {"session": sid, "mode": runtime.get_mode(sess)})


async def h_mode_set(conn: Conn, rid: Any, params: dict) -> None:
    sid = str(params.get("session") or "").strip()
    mode = str(params.get("mode") or "").strip()
    if not sid or not mode:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS,
                        "params.session 与 params.mode 必须是非空字符串")
        return
    try:
        runtime.ensure_agent()
    except ConfigError as e:
        await conn.fail(rid, rpc_protocol.RUN_FAILED, str(e))
        return
    sess = runtime.session_for(sid)
    previous = runtime.get_mode(sess)
    if mode == previous:
        # 同值不重发通知：set_agent_mode(notify) 会往下一轮注入 Mode changed 消息
        await conn.reply(rid, {"session": sid, "mode": mode, "previous": previous,
                               "changed": False, "notify": False})
        return
    try:
        runtime.set_mode(sess, mode)     # 非法值抛 ValueError → -32602
    except ValueError as exc:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, f"非法 mode: {exc}")
        return
    log.info("会话 %s 模式切换 %s → %s（下一轮生效）", sid, previous, mode)
    await conn.reply(rid, {"session": sid, "mode": mode, "previous": previous,
                           "changed": True, "notify": True})
