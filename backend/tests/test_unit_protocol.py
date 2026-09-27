"""协议域离线单测：错误码常量 / 能力清单 / 信封形状 / 每连接发送口。

不请求 8765、不打模型——协议壳的正确性不该靠真模型验证。
"""
from __future__ import annotations

import asyncio
import json

import rpc_protocol as P


def test_错误码常量与协议文档一致():
    """docstring 里承诺的码值就是常量值——防手抖改错一个数字（前端按码分流）。"""
    assert (P.PARSE_ERROR, P.INVALID_REQUEST, P.METHOD_NOT_FOUND) == (-32700, -32600, -32601)
    assert (P.INVALID_PARAMS, P.RUN_FAILED, P.CANCELLED, P.SESSION_BUSY) == (-32602, -32000, -32001, -32003)


def test_能力清单与分发表一致():
    """initialize.result.methods 必须等于真实注册表：清单撒谎会让客户端误判服务端能力。"""
    import dispatch
    assert set(P.METHODS) == set(dispatch.HANDLERS), \
        f"清单与注册表不一致：仅清单 {set(P.METHODS) - set(dispatch.HANDLERS)} / " \
        f"仅注册表 {set(dispatch.HANDLERS) - set(P.METHODS)}"


def test_信封形状():
    """事件无 id、终态有 id：形状即契约（流式 = 事件在前、终态在后）。"""
    assert P.event("s1", {"type": "answer_delta", "text": "x"}) == {
        "jsonrpc": "2.0", "method": "agent/event",
        "params": {"session": "s1", "event": {"type": "answer_delta", "text": "x"}}}
    assert P.err(7, P.INVALID_PARAMS, "坏参数") == {
        "jsonrpc": "2.0", "id": 7, "error": {"code": -32602, "message": "坏参数"}}


def test_conn串行发送且终态与事件都带jsonrpc():
    """Conn 是唯一的发送口：reply/fail/event/send 四种形状都要发到 ws 上（真实字节）。"""
    class FakeWs:
        def __init__(self):
            self.raw: list[str] = []

        async def send(self, raw: str) -> None:
            self.raw.append(raw)

    async def inner():
        ws = FakeWs()
        conn = P.Conn(ws)
        await conn.send({"jsonrpc": "2.0", "id": 1, "result": {"ok": True}})
        await conn.reply(2, {"ok": True})
        await conn.fail(3, P.SESSION_BUSY, "忙")
        await conn.event("s1", {"type": "thinking_end"})
        return ws.raw

    raw = asyncio.run(inner())
    sent = [json.loads(r) for r in raw]
    assert [m.get("id") for m in sent] == [1, 2, 3, None], f"终态带 id、事件不带 id：{sent}"
    assert all(m.get("jsonrpc") == "2.0" for m in sent)
    assert sent[2]["error"] == {"code": -32003, "message": "忙"}
    assert sent[3]["method"] == "agent/event" and sent[3]["params"]["session"] == "s1"
    assert "\\u" not in raw[3], "ensure_ascii=False：中文/事件名按 utf-8 原样发"
