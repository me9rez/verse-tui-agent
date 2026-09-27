"""传输循环 —— 一条 WebSocket 的收包循环 + JSON-RPC 信封校验 + 服务入口。

信封层的两条错误码在这里产生（-32700 解析错误 / -32600 非法请求）：
它们先于方法分发，处理器永远拿到合法信封。
"""
from __future__ import annotations

import json
import logging
from typing import Any

import websockets
from websockets.asyncio.server import serve

import bootstrap
import dispatch
import rpc_protocol
from rpc_protocol import Conn

log = logging.getLogger("verse-agent-rpc")


async def handler(ws: Any) -> None:
    """一条连接的收发循环：请求分发 + 每连接串行化发送。"""
    remote = getattr(ws, "remote_address", None)
    log.info("连接 %s", remote)
    conn = Conn(ws)
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:  # noqa: BLE001 —— raw 是对端任意输入，任何解析异常都只回 -32700，不能杀收发循环
                await conn.send({"jsonrpc": "2.0", "id": None, "error": {
                    "code": rpc_protocol.PARSE_ERROR, "message": "Parse error"}})
                continue
            if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
                # 非对象（数组/标量）没有 id 可取——原来会在这里抛 AttributeError 打断连接，
                # 信封层不该被对端任意输入打断，统一按 id=null 回 -32600
                mid = msg.get("id") if isinstance(msg, dict) else None
                await conn.send({"jsonrpc": "2.0", "id": mid, "error": {
                    "code": rpc_protocol.INVALID_REQUEST, "message": "Invalid Request"}})
                continue
            await dispatch.dispatch(conn, msg)
    except websockets.ConnectionClosed:
        pass
    finally:
        for task in conn.tasks.values():
            task.cancel()
        log.info("断开 %s", remote)


async def main() -> None:
    bootstrap.init()
    async with serve(handler, bootstrap.HOST, bootstrap.PORT, max_size=4 * 1024 * 1024) as server:
        log.info("verse-agent-backend listening ws://%s:%d", bootstrap.HOST, bootstrap.PORT)
        await server.serve_forever()
