"""会话切换语义：同一条 WS 上按 session 参数切历史是否生效 + 重连后磁盘历史恢复。"""
from __future__ import annotations

import asyncio

from websockets.asyncio.client import connect

from conftest import RPC_URL
from rpc_helpers import chat, new_sid


def _run(coro):
    return asyncio.run(coro)


def test_同连接上切换会话互不污染(live_server):
    async def inner():
        sid_a, sid_b = new_sid("switch-a"), new_sid("switch-b")
        async with connect(RPC_URL) as ws:
            t_a, _ = await chat(ws, sid_a, "记住：我这次的身份是小明。只答「记住了」。")
            t_b, _ = await chat(ws, sid_b, "记住：我这次的身份是书法老师。只答「记住了」。")
            b_recall, ev_b = await chat(ws, sid_b, "我这次的身份是谁？只答名字。")
            a_recall, ev_a = await chat(ws, sid_a, "我这次的身份是谁？只答名字。")
        assert t_a, f"A 存记忆 — {t_a[:20]}"
        assert t_b, f"B 存记忆 — {t_b[:20]}"
        assert ("书法" in b_recall or "老师" in b_recall) and "小明" not in b_recall, \
            f"切到 B：记得 B 的事（不含小明） — {b_recall[:40]}"
        assert "小明" in a_recall and "书法" not in a_recall, \
            f"切回 A：记得 A 的事（不含书法） — {a_recall[:40]}"
        assert ev_b > 0 and ev_a > 0, f"两条连接都真的走了流式事件 — A {ev_a} 事件 / B {ev_b} 事件"
    _run(inner())


def test_重连后磁盘历史仍可恢复(live_server):
    async def inner():
        sid_a = new_sid("reconn")
        async with connect(RPC_URL) as ws1:
            await chat(ws1, sid_a, "记住：我这次的身份是小明。只答「记住了」。")
        async with connect(RPC_URL) as ws2:  # 模拟 TUI 重启后 /open：新连接、同一存储 sid
            a2, _ = await chat(ws2, sid_a, "我这次的身份是谁？只答名字。")
        assert "小明" in a2, f"重连后恢复：磁盘历史还在 — {a2[:40]}"
    _run(inner())
