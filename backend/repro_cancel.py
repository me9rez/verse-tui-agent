"""聚焦复现：发一轮长任务，1.5s 后 cancel，打印此后收到的每一条消息。"""
import asyncio, json, websockets

async def main():
    async with websockets.connect("ws://127.0.0.1:8765") as ws:
        await ws.send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "agent/chat",
                                  "params": {"session": f"repro-{id(ws)}",
                                             "prompt": "从 1 数到 3000，每个数字一行，慢慢来。"}}))
        await asyncio.sleep(1.5)
        await ws.send(json.dumps({"jsonrpc": "2.0", "method": "agent/cancel",
                                  "params": {"session": f"repro-{id(ws)}"}}))
        got = []
        try:
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                kind = msg.get("method") or f"id={msg.get('id')} err={msg.get('error')}"
                got.append(kind)
                if msg.get("id") == 1:
                    break
        except TimeoutError:
            got.append("<20s 超时，没等到终态>")
        print("收到序列:", got)

asyncio.run(main())
