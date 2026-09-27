"""Verse Agent Backend 入口 —— Vue TUI 的唯一 agent 后端（JSON-RPC 2.0 over WebSocket）。

原 workbuddy_data/file-history-demo 的 rpc_server 迁入本仓库，成为唯一正式后端；
方向：以后所有 agent 能力统一用 Microsoft Agent Framework 在本服务内开发
（见 ../docs/architecture.md）。前端只剩渲染与会话编排，不再实现 agent 逻辑。

监听 ws://127.0.0.1:8765（仅本机）。运行：
    uv sync                       # 首次
    uv run python rpc_server.py   # 或在仓库根 pnpm backend

**协议权威定义（SSOT）在 rpc_protocol.py 的模块 docstring**；配置见 config.py。
本目录按功能域拆分（想加能力先看落在哪个域，别把逻辑堆回入口）：

    rpc_protocol  协议信封 / 错误码 / 每连接串行发送（Conn）
    bootstrap     配置装载转发 + 路径 + 日志 + 幂等 init()
    harness       模型 ref 解析 + 压缩预算 + chat client/harness 装配
    thinking      思考档位（纯函数）      images   图片校验与能力门控（纯函数）
    runtime       RT 单实例状态 + 会话对象复用（plan/todos/mode 跨轮持久的地基）
    turn          一轮执行 + chunk→事件映射
    methods_*     JSON-RPC 方法（agent / model+thinking / session / config 四个域）
    dispatch      方法表 + 连接级约束     server   连接循环 + serve
"""
from __future__ import annotations

import asyncio
import sys

import bootstrap
import runtime
from config import ConfigError
from server import main

bootstrap.init()   # 建目录 + chdir(工作区) + 配日志（原导入期副作用，详见 bootstrap.init）
try:
    runtime.ensure_agent()
    bootstrap.log.info(
        "harness agent ready provider=%s model=%s config=%s history=%s workspace=%s",
        runtime.RT.provider, runtime.RT.model,
        bootstrap.CFG_FILES or "（无，全部默认值）", bootstrap.HISTORY_DIR, bootstrap.WORKSPACE,
    )
except ConfigError as e:
    # 配置缺失/无 key 不再让进程崩掉：config/get 照常可用，首条需要 agent 的请求会重试，
    # 仍失败则回 -32000 + 中文原因（而不是启动时甩一段 SettingNotFoundError 栈）
    bootstrap.log.warning("启动时未装配 agent（config/get 照常可用，需要 agent 的请求会重试）：%s", e)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
