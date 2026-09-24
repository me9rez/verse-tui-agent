"""集成测试共用的极简 JSON-RPC 2.0 over WS 客户端（无断言，只收事件/等终态）。"""
from __future__ import annotations

import asyncio
import json
import uuid

URL = "ws://127.0.0.1:8765"


def new_sid(prefix: str = "test") -> str:
    """每次生成新 sid：固定 sid 会把上一轮测试的历史叠进来，断言就不再独立。"""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class Rpc:
    def __init__(self, ws):
        self.ws = ws
        self.next_id = 1
        self.events: list[dict] = []

    async def call(self, method: str, params: dict | None = None, timeout: float = 200.0):
        req_id = self.next_id
        self.next_id += 1
        await self.ws.send(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=timeout))
            if msg.get("method") == "agent/event":
                self.events.append(msg["params"]["event"])
                continue
            assert msg.get("id") == req_id, f"id 错位: {msg}"
            return msg

    def drain(self) -> list[dict]:
        out, self.events = self.events, []
        return out


async def chat(ws, sid: str, prompt: str, timeout: float = 120.0) -> tuple[str, int]:
    """发起 agent/chat 并等终态。返回 (text, event_count)；服务端报错则抛 RuntimeError。"""
    rid = uuid.uuid4().int >> 1
    await ws.send(json.dumps({
        "jsonrpc": "2.0", "id": rid, "method": "agent/chat",
        "params": {"session": sid, "prompt": prompt},
    }))
    events = 0
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if msg.get("method") == "agent/event":
            events += 1
            continue
        if msg.get("id") == rid:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg["result"]["text"], events
