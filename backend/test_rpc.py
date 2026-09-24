"""协议级测试：真实连 ws://127.0.0.1:8765 跑 JSON-RPC 2.0 全流程。

断言：
  1. initialize / ping 正常应答
  2. agent/chat 返回流式 answer_delta 事件 + 最终 result（多 chunk，真流式）
  3. 第二轮同 session 带上下文（第一轮说过的名字，第二轮答得出来）
  4. 工具轮：tool_start / tool_line / tool_end 事件按序到达
  5. agent/cancel 能掐掉一轮
  6. 错误路径：method not found、坏 prompt
  7. model：initialize 权威回显、model/set 切换跟随、空值 -32602
  8. mode：plan/execute 默认值、切换与持久、同值不重发、非法值 -32602

跑法：先起 rpc_server.py，再 python test_rpc.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import uuid

import websockets

URL = "ws://127.0.0.1:8765"
# 每次跑生成新 sid：固定 sid 会把上一轮测试的历史叠进来，断言就不再独立
SID = f"test-{uuid.uuid4().hex[:8]}"

checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str) -> None:
    checks.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name} — {detail}")


class Rpc:
    """极简 JSON-RPC 2.0 over WS 客户端：收集通知 + 按 id 等最终响应。"""

    def __init__(self, ws):
        self.ws = ws
        self.next_id = 1
        self.events: list[dict] = []  # 所有 agent/event 通知

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
        """取走自上一 call 之后的新事件。"""
        out, self.events = self.events, []
        return out


async def main() -> int:
    async with websockets.connect(URL, max_size=4 * 1024 * 1024) as ws:
        rpc = Rpc(ws)

        # 1. 握手
        r = await rpc.call("initialize", timeout=10)
        ok = r.get("result", {}).get("server") == "verse-agent-backend"
        check("initialize", ok, str(r.get("result") or r.get("error"))[:120])
        r = await rpc.call("ping", timeout=10)
        check("ping", r.get("result", {}).get("pong") is True, str(r.get("result")))

        # 2. 第一轮：流式事件 + 最终 result
        r = await rpc.call("agent/chat", {"session": SID, "prompt": "记住：我叫小明，最喜欢蓝色。一句话确认。"})
        ev = rpc.drain()
        deltas = [e for e in ev if e["type"] == "answer_delta"]
        chunk_sizes = [len(e["text"]) for e in deltas]
        texts = "".join(e["text"] for e in deltas)
        ok_res = r.get("result") is not None and r.get("result", {}).get("text", "").strip()
        check(
            "第一轮流式 answer_delta（多 chunk）",
            len(deltas) >= 2 and "小明" in texts,
            f"{len(deltas)} 个增量, 块长 {chunk_sizes[:6]}...",
        )
        check(
            "最终 result 与事件文本一致",
            bool(ok_res) and r["result"]["text"] == texts,
            f"result 长度 {len(r.get('result', {}).get('text', ''))}，usage={r.get('result', {}).get('usage')}",
        )

        # 3. 跨轮上下文（FileHistoryProvider 从磁盘加载同 session 历史）
        r = await rpc.call("agent/chat", {"session": SID, "prompt": "我叫什么？最喜欢什么颜色？只答结论。"})
        ev = rpc.drain()
        text = "".join(e["text"] for e in ev if e["type"] == "answer_delta")
        check("同 session 跨轮上下文", "小明" in text and "蓝" in text, f"回答：{text[:60]}")

        # 4. 工具轮：tool_start → tool_line → tool_end
        r = await rpc.call(
            "agent/chat",
            {"session": SID, "prompt": "用你的 todo 工具记一个 2 步学习计划（标题用中文），不要问确认。"},
            timeout=240,
        )
        ev = rpc.drain()
        kinds = [e["type"] for e in ev]
        starts = [e for e in ev if e["type"] == "tool_start"]
        ends = [e for e in ev if e["type"] == "tool_end"]
        has_order = False
        if starts and ends:
            has_order = kinds.index("tool_start") < kinds.index("tool_end")
        check(
            "工具事件齐且有序",
            bool(starts) and bool(ends) and has_order and any(e["type"] == "tool_line" for e in ev),
            f"事件序列 {kinds[:10]}...，工具名 {starts[0]['name'] if starts else '-'}",
        )
        check("工具轮拿到最终 result", r.get("result") is not None, str(r.get("result", r.get("error")))[:80])

        # 5. cancel：发一个会跑一阵的轮次，立刻取消
        r1_id = rpc.next_id
        await ws.send(json.dumps({
            "jsonrpc": "2.0", "id": r1_id, "method": "agent/chat",
            "params": {"session": SID, "prompt": "从 1 数到 3000，每个数字一行，慢慢来。"},
        }))
        await asyncio.sleep(1.5)  # 等轮次真正起跑
        r = await rpc.call("agent/cancel", {"session": SID}, timeout=15)
        check("agent/cancel 返回 cancelled=true", r.get("result", {}).get("cancelled") is True, str(r.get("result")))
        # 被取消的那轮应收到 error id=r1_id
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if msg.get("id") == r1_id:
                check(
                    "被取消的轮次收到 -32001",
                    msg.get("error", {}).get("code") == -32001,
                    str(msg.get("error")),
                )
                break
            if msg.get("method") == "agent/event":
                rpc.events.append(msg["params"]["event"])  # 顺手留档，不影响断言
                continue

        # 6. 错误路径
        r = await rpc.call("no/such/method", timeout=10)
        check("method not found → -32601", r.get("error", {}).get("code") == -32601, str(r.get("error")))
        r = await rpc.call("agent/chat", {"session": SID, "prompt": "   "})
        check("坏 prompt → -32602", r.get("error", {}).get("code") == -32602, str(r.get("error")))

        # 7. model：initialize 权威回显 → model/set 切换 → initialize 跟随 → 空值报错 → 切回原值
        r = await rpc.call("initialize", timeout=10)
        orig_model = r.get("result", {}).get("model")
        check("initialize 回显当前 model", bool(orig_model), str(orig_model))
        r = await rpc.call("model/set", {"model": "probe-model"})
        check(
            "model/set 回显新 model",
            r.get("result", {}).get("model") == "probe-model" and r.get("result", {}).get("rebuilt") is True,
            str(r.get("result") or r.get("error")),
        )
        r = await rpc.call("initialize", timeout=10)
        check(
            "initialize 跟随切换后的 model",
            r.get("result", {}).get("model") == "probe-model",
            str(r.get("result", {}).get("model")),
        )
        r = await rpc.call("model/set", {"model": ""})
        check("空 model → -32602", r.get("error", {}).get("code") == -32602, str(r.get("error")))
        # 切回原值，不污染后续手工验证
        await rpc.call("model/set", {"model": orig_model})

        # 8. mode：harness 的 plan/execute 模式（会话对象复用后跨调用持久）
        r = await rpc.call("mode/get", {"session": SID})
        check("mode/get 默认 plan", r.get("result", {}).get("mode") == "plan", str(r.get("result")))
        r = await rpc.call("mode/set", {"session": SID, "mode": "execute"})
        res = r.get("result", {})
        check(
            "mode/set → execute（带变更通知）",
            res.get("mode") == "execute" and res.get("previous") == "plan" and res.get("notify") is True,
            str(res or r.get("error")),
        )
        r = await rpc.call("mode/get", {"session": SID})
        check("模式跨调用持久（会话对象复用）", r.get("result", {}).get("mode") == "execute", str(r.get("result")))
        r = await rpc.call("mode/set", {"session": SID, "mode": "execute"})
        check("同值切换 changed=false 不重发通知", r.get("result", {}).get("changed") is False, str(r.get("result")))
        r = await rpc.call("mode/set", {"session": SID, "mode": "fly"})
        check("非法 mode → -32602", r.get("error", {}).get("code") == -32602, str(r.get("error")))
        r = await rpc.call("mode/set", {"session": SID, "mode": "plan"})
        check("切回 plan", r.get("result", {}).get("mode") == "plan" and r.get("result", {}).get("changed") is True,
              str(r.get("result")))

    fails = [c for c in checks if not c[1]]
    print(f"\n{'FAIL' if fails else 'PASS'}: {len(checks) - len(fails)}/{len(checks)} 通过")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
