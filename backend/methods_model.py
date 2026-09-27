"""模型与思考档位域的方法实现 —— model/set · thinking/get · thinking/set。

两者的语义差别就是本域的分界：
  - model/set 全局重建 harness（plan/todos/mode 重置，磁盘历史保留），有轮次在跑时拒绝；
  - thinking/set 只改运行时档位，下一轮 run options 注入，**不重建 harness**。
"""
from __future__ import annotations

import logging
from typing import Any

import bootstrap
import rpc_protocol
import runtime
import thinking
from config import ConfigError
from rpc_protocol import Conn

log = logging.getLogger("verse-agent-rpc")


async def h_model_set(conn: Conn, rid: Any, params: dict) -> None:
    """切服务端默认模型（重建 client + harness）。"""
    new_model = str(params.get("model") or "").strip()
    if not new_model:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, "model 不能为空")
        return
    if any(t and not t.done() for t in conn.tasks.values()):
        # 本连接有轮次在跑：重建 harness 会把进行中的会话对象抽掉
        await conn.fail(rid, rpc_protocol.SESSION_BUSY, "本连接有轮次在跑，等本轮结束再 model/set")
        return
    try:
        pname = runtime.set_model(new_model)
    except ConfigError as e:
        await conn.fail(rid, rpc_protocol.RUN_FAILED, str(e))
        return
    log.info("model 切换为 %s（harness 已重建，plan/todos/mode 重置，磁盘历史保留）", runtime.RT.model)
    await conn.reply(rid, {"model": runtime.RT.model, "provider": pname, "rebuilt": True})


async def h_thinking_get(conn: Conn, rid: Any, params: dict) -> None:
    """读当前思考档位与模型支持表（模型没配支持表时回默认档位表）。"""
    sup = thinking.support(bootstrap.CFG, runtime.RT.model)
    await conn.reply(rid, {
        "effort": runtime.RT.effort, "model": runtime.RT.model,
        "support_efforts": sup["support_efforts"] or thinking.DEFAULT_EFFORT_LEVELS,
        "default_effort": sup["default_effort"], "off_effort": sup["off_effort"],
        "capabilities": sup["capabilities"]})


async def h_thinking_set(conn: Conn, rid: Any, params: dict) -> None:
    """设思考档位（全局，下一轮生效，不重建 harness）。"""
    val = str(params.get("effort") or "").strip().lower()
    sup = thinking.support(bootstrap.CFG, runtime.RT.model)
    allowed = sup["support_efforts"] or thinking.DEFAULT_EFFORT_LEVELS
    if not val:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, "params.effort 必须是非空字符串")
    elif val != "off" and val not in allowed:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS,
                        f"effort {val!r} 不受支持（可选：{'/'.join([*allowed, 'off'])}）")
    else:
        runtime.RT.effort = val
        log.info("思考档位切换为 %s（model=%s）", runtime.RT.effort or "（未设置）", runtime.RT.model)
        await conn.reply(rid, {"effort": runtime.RT.effort})
