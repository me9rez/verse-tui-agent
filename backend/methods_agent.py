"""agent 轮次域的方法实现 —— agent/chat · agent/cancel · agent/reset。

一轮的终态规则（协议 §4.4）：run() 里恰好发一个终态——成功 result、取消 -32001、
其他异常 -32000（超时也归这里，换成中文原因）。事件在终态之前随意多，
都由 turn.stream_turn 经同一把连接锁发出。
"""
from __future__ import annotations

import asyncio
import logging
import traceback
from typing import Any

import images as images_domain
import rpc_protocol
import runtime
import turn
from config import ConfigError
from rpc_protocol import Conn

log = logging.getLogger("verse-agent-rpc")


async def h_chat(conn: Conn, rid: Any, params: dict) -> None:
    """起一轮：参数校验 → 惰性装配 → 后台任务跑 harness（本连接的收包循环继续跑）。"""
    session = str(params.get("session") or "").strip()
    prompt = params.get("prompt")
    if not session:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, "params.session 必须是非空字符串")
        return
    if not isinstance(prompt, str) or not prompt.strip():
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, "params.prompt 必须是非空字符串")
        return
    images = params.get("images")
    # 形状/base64/大小校验；capabilities 不再拒绝——不支持图片的模型在请求前
    # 投影为文本占位符（projection.py），跨模型切换双向都能成功
    if images is not None and (err := images_domain.validate(images)):
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, err)
        return
    try:
        runtime.ensure_agent()   # 参数校验之后才装配：坏参数仍回 -32602，配置缺失才 -32000
    except ConfigError as e:
        await conn.fail(rid, rpc_protocol.RUN_FAILED, str(e))
        return

    async def run() -> None:
        try:
            result = await asyncio.wait_for(
                turn.stream_turn(conn, session, prompt, images), timeout=turn.MAX_RUN_SECONDS
            )
            await conn.reply(rid, result)
        except asyncio.CancelledError:
            # 客户端 Esc / agent/cancel：补发 -32001 终态，让等待方不悬挂
            log.info("轮次被取消 rid=%s，补发 -32001", rid)
            try:
                await conn.fail(rid, rpc_protocol.CANCELLED, "cancelled")
                log.info("-32001 已发送 rid=%s", rid)
            except Exception as exc:  # noqa: BLE001 —— 连接可能已断，尽力而为
                log.warning("-32001 发送失败 rid=%s: %r", rid, exc)
            raise
        except Exception as exc:  # noqa: BLE001 —— 全部转成 JSON-RPC error
            log.error("agent/chat 失败: %s\n%s", exc, traceback.format_exc(limit=4))
            msg = str(exc)
            if "timed out" in msg or "Timeout" in type(exc).__name__:
                msg = f"本轮超过 {turn.MAX_RUN_SECONDS}s 超时"
            await conn.fail(rid, rpc_protocol.RUN_FAILED, msg[:600])
        finally:
            conn.tasks.pop(session, None)

    conn.tasks[session] = asyncio.create_task(run())


async def h_cancel(conn: Conn, rid: Any, params: dict) -> None:
    """取消该会话进行中的轮次：应答 {cancelled}，被取消那轮另收 -32001 终态。"""
    sid = str(params.get("session") or "")
    task = conn.tasks.get(sid)
    if task is not None and not task.done():
        task.cancel()
        log.info("已取消会话 %s 的轮次", sid)
        cancelled = True
    else:
        cancelled = False
    if rid is not None:
        await conn.reply(rid, {"cancelled": cancelled})


async def h_reset(conn: Conn, rid: Any, params: dict) -> None:
    """清掉该会话的服务端内存状态（磁盘历史保留）。"""
    runtime.reset_session(str(params.get("session") or ""))
    if rid is not None:
        await conn.reply(rid, {"reset": True})
