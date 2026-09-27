"""轮次执行域 —— 跑一轮 harness，把每个 AgentResponseUpdate 转成协议事件。

chunk → 事件映射（实测校准）：
  模型的思考（chunk text_reasoning）：wb2api(cn:hy3) 不返回思考字段 → 永远没有 thinking_delta；
    端点若支持 reasoning_details（OpenRouter/vLLM）就会出现。前端要兼容缺席。
  工具调用（chunk function_call）：arguments 是增量分片，等 finish_reason=tool_calls
    拼完整、JSON 解析后才发 tool_start（带完整 params）——跨 chunk 状态留在服务端。
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any

from agent_framework import Content, Message

import bootstrap
import images as images_domain
import runtime
import thinking
from rpc_protocol import Conn

log = logging.getLogger("verse-agent-rpc")

MAX_RUN_SECONDS = 300   # 单轮上限；超时由调用方转成 -32000 的中文超时错误


async def stream_turn(conn: Conn, session: str, prompt: str,
                      images: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """跑一轮 harness，把每个 AgentResponseUpdate 转成事件。返回 result 对象。"""
    sess = runtime.session_for(session)
    agent = runtime.agent_or_raise()

    answer: list[str] = []
    usage: dict[str, Any] | None = None
    pending: dict[str, dict[str, Any]] = {}   # call_id -> {name, args}
    tool_names: dict[str, str] = {}

    async def emit(ev: dict[str, Any]) -> None:
        await conn.event(session, ev)

    # 思考档位按轮注入（thinking/set 改全局档位，下一轮生效；空 = 不发参数）
    run_opts = thinking.run_options(bootstrap.CFG, runtime.RT.provider, runtime.RT.model, runtime.RT.effort)
    # 图片是否降级由当前模型的 client 投影旗标决定（装配时已按 capabilities 决定）
    images_omitted = (len(images)
                      if images and not images_domain.accepts(bootstrap.CFG, runtime.RT.model) else 0)
    if images:
        # 多模态：文本 + 图片内容项合成一条 user 消息（AgentRunInputs 接受 Message，
        # Content.from_data 生成 data URI 内容项，编码交给端点）
        contents: list[Any] = [Content.from_text(prompt)]
        contents += [
            Content.from_data(base64.b64decode(img["data"]), media_type=img["media_type"])
            for img in images
        ]
        turn_input: Any = Message("user", contents)
    else:
        turn_input = prompt
    async for chunk in agent.run(turn_input, session=sess, stream=True, options=run_opts):
        for c in chunk.contents:
            ctype = getattr(c, "type", "")
            if ctype == "text":
                text = getattr(c, "text", "") or ""
                if text:
                    answer.append(text)
                    await emit({"type": "answer_delta", "text": text})
            elif ctype == "text_reasoning":
                # 思考内容与正文严格分离（.text 不含它），只有端点提供时才会走到这
                t = getattr(c, "text", "") or ""
                if t:
                    await emit({"type": "thinking_delta", "text": t})
            elif ctype == "function_call":
                cid = str(getattr(c, "call_id", "") or "")
                entry = pending.setdefault(cid, {"name": "", "args": ""})
                if getattr(c, "name", ""):
                    entry["name"] = c.name
                if getattr(c, "arguments", ""):
                    entry["args"] += c.arguments
            elif ctype == "function_result":
                cid = str(getattr(c, "call_id", "") or "")
                result = getattr(c, "result", "")
                text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                await emit({"type": "tool_line", "id": cid, "text": text[:4000]})
                await emit({"type": "tool_end", "id": cid, "status": "ok"})
            elif ctype == "usage":
                usage = getattr(c, "usage_details", None)

        if chunk.finish_reason == "tool_calls" and pending:
            for cid, p in pending.items():
                try:
                    params = json.loads(p["args"]) if p["args"] else {}
                except (TypeError, ValueError):   # JSONDecodeError ⊂ ValueError；args 异常时按空参数继续
                    params = {}
                    log.warning("tool arguments 非法 call_id=%s", cid)
                if not isinstance(params, dict):
                    params = {"value": params}
                first = next((v for v in params.values() if isinstance(v, str)), "")
                arg = f"{p['name']} {first}" if first else p["name"]
                tool_names[cid] = p["name"]
                await emit({"type": "tool_start", "id": cid, "name": p["name"],
                            "arg": arg[:120], "params": params})
            pending.clear()
            await emit({"type": "thinking_end"})

    return {
        "ok": True,
        "text": "".join(answer),
        "usage": usage,
        # 本轮请求中被降级为文本占位符的图片数（支持图片的模型恒缺省——协议只加不改）
        **({"images_omitted": images_omitted} if images_omitted else {}),
    }
