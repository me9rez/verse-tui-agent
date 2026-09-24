"""协议轻量面：握手 / config/get / 错误码 / model 切换 / mode 切换（请求 live_server）。"""
from __future__ import annotations

import asyncio

import websockets

from conftest import RPC_URL
from rpc_helpers import Rpc, new_sid


def _run(coro):
    return asyncio.run(coro)


def test_initialize_and_ping(live_server):
    async def inner():
        async with websockets.connect(RPC_URL) as ws:
            rpc = Rpc(ws)
            r = await rpc.call("initialize", timeout=10)
            assert r.get("result", {}).get("server") == "verse-agent-backend", \
                f"initialize — {str(r.get('result') or r.get('error'))[:120]}"
            r = await rpc.call("ping", timeout=10)
            assert r.get("result", {}).get("pong") is True, f"ping — {r.get('result')}"
    _run(inner())


def test_config_get脱敏与结构(live_server):
    async def inner():
        async with websockets.connect(RPC_URL) as ws:
            rpc = Rpc(ws)
            r = await rpc.call("config/get", timeout=10)
            res = r.get("result") or {}
            cfg = res.get("config") or {}
            providers = cfg.get("providers")
            assert isinstance(providers, list) and all(
                p.get("api_key") in ("", "***set***") for p in providers
            ), f"config/get 的 api_key 已脱敏 — {str(r.get('error') or providers)[:120]}"
            assert isinstance(res.get("sources"), list) and all(
                s.endswith(".toml") for s in res["sources"]
            ), f"config/get.sources 是 toml 绝对路径 — {res.get('sources')}"
            tui = cfg.get("tui") or {}
            assert tui.get("agent") in ("mock", "rpc") and isinstance(tui.get("speed"), (int, float)) \
                and tui.get("speed", 0) >= 0, f"config/get 含 tui 段 — {tui.get('agent')}"
    _run(inner())


def test_错误路径(live_server):
    async def inner():
        async with websockets.connect(RPC_URL) as ws:
            rpc = Rpc(ws)
            sid = new_sid("err")
            r = await rpc.call("no/such/method", timeout=10)
            assert r.get("error", {}).get("code") == -32601, f"method not found → -32601 — {r.get('error')}"
            r = await rpc.call("agent/chat", {"session": sid, "prompt": "   "})
            assert r.get("error", {}).get("code") == -32602, f"坏 prompt → -32602 — {r.get('error')}"
    _run(inner())


def test_model回显切换与恢复(live_server):
    async def inner():
        async with websockets.connect(RPC_URL) as ws:
            rpc = Rpc(ws)
            r = await rpc.call("initialize", timeout=10)
            orig = r.get("result", {}).get("model")
            assert orig, f"initialize 回显当前 model — {orig}"
            try:
                r = await rpc.call("model/set", {"model": "probe-model"})
                res = r.get("result") or {}
                assert res.get("model") == "probe-model" and res.get("rebuilt") is True, \
                    f"model/set 回显新 model — {res or r.get('error')}"
                r = await rpc.call("initialize", timeout=10)
                assert r.get("result", {}).get("model") == "probe-model", \
                    f"initialize 跟随切换后的 model — {r.get('result', {}).get('model')}"
                r = await rpc.call("model/set", {"model": ""})
                assert r.get("error", {}).get("code") == -32602, f"空 model → -32602 — {r.get('error')}"
            finally:
                await rpc.call("model/set", {"model": orig})  # 切回原值，不污染后续手工验证
    _run(inner())


def test_mode默认与切换持久(live_server):
    async def inner():
        async with websockets.connect(RPC_URL) as ws:
            rpc = Rpc(ws)
            sid = new_sid("mode")
            r = await rpc.call("mode/get", {"session": sid})
            assert r.get("result", {}).get("mode") == "plan", f"mode/get 默认 plan — {r.get('result')}"
            r = await rpc.call("mode/set", {"session": sid, "mode": "execute"})
            res = r.get("result", {})
            assert res.get("mode") == "execute" and res.get("previous") == "plan" and res.get("notify") is True, \
                f"mode/set → execute（带变更通知） — {res or r.get('error')}"
            r = await rpc.call("mode/get", {"session": sid})
            assert r.get("result", {}).get("mode") == "execute", f"模式跨调用持久 — {r.get('result')}"
            r = await rpc.call("mode/set", {"session": sid, "mode": "execute"})
            assert r.get("result", {}).get("changed") is False, f"同值切换 changed=false 不重发通知 — {r.get('result')}"
            r = await rpc.call("mode/set", {"session": sid, "mode": "fly"})
            assert r.get("error", {}).get("code") == -32602, f"非法 mode → -32602 — {r.get('error')}"
            r = await rpc.call("mode/set", {"session": sid, "mode": "plan"})
            assert r.get("result", {}).get("mode") == "plan" and r.get("result", {}).get("changed") is True, \
                f"切回 plan — {r.get('result')}"
    _run(inner())
