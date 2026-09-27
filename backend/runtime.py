"""运行时状态域 —— 进程级可变状态的唯一归处 + 会话对象复用。

原来是散在 rpc_server 里的模块 global（MODEL/PROVIDER/client/agent/EFFORT）与 _SESSION_CACHE；
拆成多文件后 global 会变成跨模块 footgun（谁都能漏改一处），所以收进 RT 这一个实例：
所有状态读写都写 `runtime.RT.<字段>`，切换模型的唯一写点是 set_model()。

会话对象复用（RT.sessions）：源码事实是 AgentSession 只是 {session_id, state} 轻量容器，
run() 不会从任何 store 里自动水合 state——每轮 new 一个会话对象，provider state
（Todo/plan/agent_mode）每轮都会清零。按 sid 复用同一个对象，harness 才能跨轮记住状态
（与官方 Harness 文档「keep an AgentSession」一致）。内存级：进程重启即丢；
对话历史另有 FileHistoryProvider JSONL，不受影响。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from agent_framework import get_agent_mode, set_agent_mode

import bootstrap
import harness
import thinking
from config import ConfigError

log = logging.getLogger("verse-agent-rpc")


@dataclass
class Runtime:
    """当前模型/provider/client/agent/思考档位 + 每会话的 harness 会话对象。"""

    model: str                              # 当前 model 的权威回显（initialize.result.model）
    provider: str = ""                      # 当前 provider 表名
    client: Any = None
    agent: Any = None
    effort: str = ""                        # 当前思考档位（空 = 不向端点发思考参数）
    sessions: dict[str, Any] = field(default_factory=dict)


RT = Runtime(model=bootstrap.DEFAULT_MODEL_ALIAS)


def ensure_agent() -> None:
    """惰性装配：启动失败后的首个 chat / mode 请求在此重试（ConfigError → -32000）。"""
    # cwd 必须是工作区：工具的文件/命令相对路径都落在 WORKSPACE（init 幂等，重复调用无害）
    bootstrap.init()
    if RT.agent is None:
        RT.client, RT.agent, _, RT.provider = harness.build_agent(
            bootstrap.CFG, RT.model, bootstrap.WORKSPACE, bootstrap.HISTORY_DIR)
        RT.effort = thinking.calibrate(bootstrap.CFG, RT.model, RT.effort)


def agent_or_raise():
    """取已装配的 agent（调用链保证 ensure_agent 先成功）——不变量被破坏时尽早暴露。"""
    if RT.agent is None:
        raise ConfigError("agent 未装配（ensure_agent 应先成功）")
    return RT.agent


def set_model(model_ref: str) -> str:
    """切服务端默认模型：重建 client + harness，返回 provider 表名。

    旧会话对象的 provider state 归属旧 agent，一并丢弃（RT.sessions.clear()）；
    磁盘历史不受影响。装配失败（ConfigError）时 RT 保持原样，不半途改状态。
    """
    client, agent, _, pname = harness.build_agent(
        bootstrap.CFG, model_ref, bootstrap.WORKSPACE, bootstrap.HISTORY_DIR)
    RT.client, RT.agent, RT.model, RT.provider = client, agent, model_ref, pname
    RT.effort = thinking.calibrate(bootstrap.CFG, RT.model, RT.effort)   # 新模型不支持当前档位时回落
    RT.sessions.clear()
    return pname


def session_for(sid: str):
    """按 sid 取/建 harness 会话对象（plan/todos/mode 跨轮持久的地基）。"""
    agent = agent_or_raise()
    sess = RT.sessions.get(sid)
    if sess is None:
        sess = agent.create_session(session_id=sid)
        if bootstrap.DEFAULT_MODE != "plan":
            # 新会话按 config 的 default_mode 起步（notify=False：这是初始值，不是变更，不注入通知）
            try:
                set_agent_mode(sess, bootstrap.DEFAULT_MODE, notify=False)
            except Exception as exc:  # noqa: BLE001 —— 配置值非法不致命，回落框架默认 plan
                log.warning("default_mode=%r 应用失败，回落默认 plan：%s", bootstrap.DEFAULT_MODE, exc)
        RT.sessions[sid] = sess
    return sess


def reset_session(sid: str) -> None:
    """丢弃该会话的服务端内存状态（磁盘历史保留）。"""
    # _sessions 是框架 Agent 未公开的映射，getattr 兜住未来改名（拿不到就当无会话可清）
    sessions = getattr(RT.agent, "_sessions", None)
    if sessions is not None and sid in sessions:
        sessions.pop(sid, None)
    RT.sessions.pop(sid, None)


def get_mode(sess: Any) -> str:
    """该会话的 harness 模式（默认 plan）。get/set 都经此转发，调用方不直接碰框架 API。"""
    return str(get_agent_mode(sess))


def set_mode(sess: Any, mode: str) -> None:
    """切该会话 plan/execute；非法值抛 ValueError（调用方转 -32602）。"""
    set_agent_mode(sess, mode)
