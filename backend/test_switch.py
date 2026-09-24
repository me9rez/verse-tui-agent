"""验证「TUI 切换会话」的底层语义：同一条 WS 连接上按 session 参数切换历史是否生效。

模拟 TUI 的三种切换：
  1. 新开会话（/new 等价）：sid A 记「我叫小明」，sid B 记「我在写书法」
  2. 切到 B 提问 → 应只记得 B 的事
  3. /open 恢复 A（= 用存储的 sid 重新发问）→ 应记得 A 的事，且不受 B 污染
  4. 进程退出重连（TUI 重启后 /open A）→ 磁盘历史仍能恢复
"""
import asyncio, json, sys, uuid
from websockets.asyncio.client import connect

URL = "ws://127.0.0.1:8765"

async def chat(ws, sid, prompt):
    """发起 agent/chat 并等终态（事件只做计数）。返回 (text, event_count) 或抛错。"""
    rid = uuid.uuid4().int >> 1
    await ws.send(json.dumps({
        "jsonrpc": "2.0", "id": rid, "method": "agent/chat",
        "params": {"session": sid, "prompt": prompt},
    }))
    events = 0
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=120))
        if msg.get("method") == "agent/event":
            events += 1
            continue
        if msg.get("id") == rid:
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg["result"]["text"], events

async def main():
    sid_a = f"switch-a-{uuid.uuid4().hex[:6]}"
    sid_b = f"switch-b-{uuid.uuid4().hex[:6]}"
    results = []

    # 第一段：同一条连接上开两个会话各存记忆
    async with connect(URL) as ws:
        t_a, _ = await chat(ws, sid_a, "记住：我这次的身份是小明。只答「记住了」。")
        t_b, _ = await chat(ws, sid_b, "记住：我这次的身份是书法老师。只答「记住了」。")
        # 切到 B 提问（/open 等价：换 session 参数即可）
        b_recall, ev_b = await chat(ws, sid_b, "我这次的身份是谁？只答名字。")
        # 切回 A 提问
        a_recall, ev_a = await chat(ws, sid_a, "我这次的身份是谁？只答名字。")
        results.append(("A 存记忆", True, t_a[:20]))
        results.append(("B 存记忆", True, t_b[:20]))
        results.append(("切到 B：记得 B 的事（不含小明）",
                        ("书法" in b_recall or "老师" in b_recall) and "小明" not in b_recall,
                        b_recall[:40]))
        results.append(("切回 A：记得 A 的事（不含书法）",
                        "小明" in a_recall and "书法" not in a_recall,
                        a_recall[:40]))
        results.append(("两条连接都真的走了流式事件", ev_b > 0 and ev_a > 0,
                        f"A {ev_a} 事件 / B {ev_b} 事件"))

    # 第二段：模拟 TUI 重启后 /open A —— 新连接、同一个存储的 sid
    async with connect(URL) as ws2:
        a2, _ = await chat(ws2, sid_a, "我这次的身份是谁？只答名字。")
        results.append(("重连后恢复 A：磁盘历史还在", "小明" in a2, a2[:40]))

    ok = 0
    for name, passed, detail in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name} — {detail}")
        ok += passed
    print(f"\n{ok}/{len(results)} 通过")
    sys.exit(0 if ok == len(results) else 1)

asyncio.run(main())
