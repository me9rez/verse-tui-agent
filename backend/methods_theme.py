"""主题域的方法实现 —— theme/list · theme/set。

主题文件由**后端**读（前端不读任何配置文件与业务环境变量，AGENTS §5），这两个方法就是它的出口：

  theme/list  重扫 `<VERSE_HOME>/themes/*.json`，连同内置 dark/light 一起返回，
              并附带「当前主题」解析后的完整色板 —— 前端握手后一次调用即可上色。
  theme/set   会话内切换：返回新色板，**不写 tui.toml**（用户拍板不落盘）。
              持久化仍走 tui.toml 的 theme 字段：由用户自己写，后端不代改用户配置。

没有单独的 theme/get：list 已经把解析结果带回来了，多一个方法就多一处要同步的语义。
"""
from __future__ import annotations

from typing import Any

import bootstrap
import config
import rpc_protocol
import theme
from rpc_protocol import Conn


async def h_theme_list(conn: Conn, rid: Any, params: dict) -> None:
    """可用主题（内置 dark/light + 自定义）+ 当前主题解析后的 19 个 token。"""
    current = str(bootstrap.TUI.get("theme") or "")
    await conn.reply(rid, theme.catalog(config.verse_home(), current))


async def h_theme_set(conn: Conn, rid: Any, params: dict) -> None:
    """会话内切换主题。认不出的名字 → -32602（前端据此给出提示，而不是静默不变）。"""
    name = str(params.get("name") or "")
    custom = theme.list_themes(config.verse_home())
    known = {str(t.get("name")) for t in custom} | set(theme.BASES)
    if name not in known:
        await conn.fail(rid, rpc_protocol.INVALID_PARAMS, f"未知主题：{name}")
        return
    resolved, colors = theme.resolve(name, custom)
    await conn.reply(rid, {"name": resolved, "base": theme.base_of(resolved, custom), "colors": colors})
