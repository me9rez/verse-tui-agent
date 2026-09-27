"""配置与能力发现域的方法实现 —— config/get · initialize · ping。

config/get 是密钥唯一可能的出口，所以脱敏由 config.sanitize 独占负责（明文 key 永不下发）；
thinking.effort 是运行时状态（不进 toml），挂在这里是为了前端重连后恢复档位显示。
"""
from __future__ import annotations

from typing import Any

import bootstrap
import rpc_protocol
import runtime
from config import sanitize
from rpc_protocol import Conn


async def h_config_get(conn: Conn, rid: Any, params: dict) -> None:
    """脱敏配置视图 + 实际读到的 toml 绝对路径。"""
    view = sanitize(bootstrap.CFG, bootstrap.TUI)
    view["thinking"] = {"effort": runtime.RT.effort}   # 前端重连后恢复档位显示（不进 toml，非配置）
    await conn.reply(rid, {"config": view, "sources": bootstrap.CFG_FILES})


async def h_initialize(conn: Conn, rid: Any, params: dict) -> None:
    """握手：服务端身份 + 当前 model/provider + 能力清单（客户端据此判断服务端版本）。"""
    await conn.reply(rid, {
        "server": rpc_protocol.SERVER_NAME, "version": rpc_protocol.SERVER_VERSION,
        "provider": runtime.RT.provider, "model": runtime.RT.model,
        "methods": list(rpc_protocol.METHODS)})


async def h_ping(conn: Conn, rid: Any, params: dict) -> None:
    await conn.reply(rid, {"pong": True})
