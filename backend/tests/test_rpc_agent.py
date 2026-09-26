"""agent 重轮次：流式 / 跨轮上下文 / 工具事件 / cancel（真模型，请求 live_server）。"""
from __future__ import annotations

import asyncio
import json

import websockets

from conftest import RPC_URL
from rpc_helpers import Rpc, new_sid


def _run(coro):
    return asyncio.run(coro)


def test_第一轮流式answer_delta并与result一致(live_server):
    async def inner():
        async with websockets.connect(RPC_URL, max_size=4 * 1024 * 1024) as ws:
            rpc = Rpc(ws)
            sid = new_sid("chat")
            r = await rpc.call("agent/chat", {"session": sid, "prompt": "记住：我叫小明，最喜欢蓝色。一句话确认。"})
            ev = rpc.drain()
            deltas = [e for e in ev if e["type"] == "answer_delta"]
            chunk_sizes = [len(e["text"]) for e in deltas]
            texts = "".join(e["text"] for e in deltas)
            assert len(deltas) >= 2 and "小明" in texts, \
                f"第一轮流式 answer_delta（多 chunk） — {len(deltas)} 个增量, 块长 {chunk_sizes[:6]}..."
            assert r.get("result") is not None and r["result"]["text"] == texts, \
                f"最终 result 与事件文本一致 — result 长度 {len(r.get('result', {}).get('text', ''))}"
    _run(inner())


def test_同session跨轮上下文(live_server):
    async def inner():
        async with websockets.connect(RPC_URL, max_size=4 * 1024 * 1024) as ws:
            rpc = Rpc(ws)
            sid = new_sid("ctx")
            await rpc.call("agent/chat", {"session": sid, "prompt": "记住：我叫小明，最喜欢蓝色。一句话确认。"})
            rpc.drain()
            await rpc.call("agent/chat", {"session": sid, "prompt": "我叫什么？最喜欢什么颜色？只答结论。"})
            text = "".join(e["text"] for e in rpc.drain() if e["type"] == "answer_delta")
            assert "小明" in text and "蓝" in text, f"同 session 跨轮上下文 — 回答：{text[:60]}"
    _run(inner())


def test_工具事件齐且有序并拿到result(live_server):
    async def inner():
        async with websockets.connect(RPC_URL, max_size=4 * 1024 * 1024) as ws:
            rpc = Rpc(ws)
            sid = new_sid("tool")
            r = await rpc.call(
                "agent/chat",
                {"session": sid, "prompt": "用你的 todo 工具记一个 2 步学习计划（标题用中文），不要问确认。"},
                timeout=240,
            )
            ev = rpc.drain()
            kinds = [e["type"] for e in ev]
            starts = [e for e in ev if e["type"] == "tool_start"]
            ends = [e for e in ev if e["type"] == "tool_end"]
            has_order = bool(starts) and bool(ends) and kinds.index("tool_start") < kinds.index("tool_end")
            assert has_order and any(e["type"] == "tool_line" for e in ev), \
                f"工具事件齐且有序 — 事件序列 {kinds[:10]}..., 工具名 {starts[0]['name'] if starts else '-'}"
            assert r.get("result") is not None, f"工具轮拿到最终 result — {str(r.get('result', r.get('error')))[:80]}"
    _run(inner())


def test_cancel掐掉一轮并收到错误码32001(live_server):
    async def inner():
        async with websockets.connect(RPC_URL, max_size=4 * 1024 * 1024) as ws:
            rpc = Rpc(ws)
            sid = new_sid("cancel")
            r1_id = rpc.next_id
            await ws.send(json.dumps({
                "jsonrpc": "2.0", "id": r1_id, "method": "agent/chat",
                "params": {"session": sid, "prompt": "从 1 数到 3000，每个数字一行，慢慢来。"},
            }))
            await asyncio.sleep(1.5)  # 等轮次真正起跑
            r = await rpc.call("agent/cancel", {"session": sid}, timeout=15)
            assert r.get("result", {}).get("cancelled") is True, f"agent/cancel 返回 cancelled=true — {r.get('result')}"
            while True:  # 被取消那轮应收到 error id=r1_id
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
                if msg.get("id") == r1_id:
                    assert msg.get("error", {}).get("code") == -32001, f"被取消的轮次收到 -32001 — {msg.get('error')}"
                    break
                if msg.get("method") == "agent/event":
                    rpc.events.append(msg["params"]["event"])
                    continue
    _run(inner())


def test_带图请求按能力投影后成功(live_server):
    """真模型验证双向投影（能力自适应，不依赖 config 现状）：
    - 模型声明 image_in → 图片原样进请求（恒等投影），result 无 images_omitted；
    - 未声明 → 请求前降级为文本占位符，result.images_omitted == 1。
    两个方向请求都必须成功（会话事实源里的图片不阻断任何模型）。"""
    async def inner():
        async with websockets.connect(RPC_URL, max_size=4 * 1024 * 1024) as ws:
            rpc = Rpc(ws)
            cfg = (await rpc.call("config/get", timeout=10)).get("result", {}).get("config", {})
            init = await rpc.call("initialize", timeout=10)
            model = init.get("result", {}).get("model")
            caps = next((m.get("capabilities") or [] for m in cfg.get("models", [])
                         if m.get("alias") == model), [])
            supports = "image_in" in caps
            sid = new_sid("img")
            r = await rpc.call("agent/chat", {
                "session": sid,
                "prompt": "收到一张图。只需回答两个字：收到。",
                "images": [{"media_type": "image/png",
                            "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}],
            })
            res = r.get("result") or {}
            assert res.get("ok") is True, f"带图请求成功（无论能力） — {str(r.get('error') or res)[:120]}"
            if supports:
                assert "images_omitted" not in res, f"image_in 模型恒等投影，无降级回显 — {res.get('images_omitted')}"
            else:
                assert res.get("images_omitted") == 1, f"降级时 result 回显 images_omitted=1 — {res.get('images_omitted')}"
            assert res.get("text"), "模型有回答文本"
    _run(inner())
