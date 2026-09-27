"""Verse Agent Backend 的协议层 —— JSON-RPC 2.0 over WebSocket（本模块 docstring 是协议 SSOT）。

信封构造、错误码、每连接发送口（Conn）都收在这个域里；方法实现按协议域分在
methods_*.py（分发表在 dispatch.py），传输循环在 server.py，配置见 config.py。

════════════════════════════════════════════════════════════════
JSON-RPC 2.0 over WebSocket 协议
════════════════════════════════════════════════════════════════
客户端 → 服务端（请求，带 id）：
  {"jsonrpc":"2.0","id":1,"method":"agent/chat",
   "params":{"session":"<sid>","prompt":"<用户输入>"}}
      可选 params.images = [{"media_type":"image/png","data":"<base64>"}]：
      多模态输入（≤4 张、单图 base64 ≤12MB）。会话存储的是原始图片（唯一事实源）；
      当前模型 capabilities 未声明 image_in 时，请求发出前把图片投影为确定性文本占位符
      （projection.py，逐字节稳定以保前缀缓存），result 附 images_omitted=N。
      图片经 Content.from_data 与文本合成一条 user Message 进 harness。
  {"jsonrpc":"2.0","id":9,"method":"agent/cancel","params":{"session":"<sid>"}}
      → 应答 {"result":{"cancelled":true|false}}；被取消那轮的 chat 请求另收 -32001 终态
  {"jsonrpc":"2.0","id":2,"method":"agent/reset","params":{"session":"<sid>"}}
  {"jsonrpc":"2.0","id":7,"method":"model/set","params":{"model":"<模型 id>"}}
      → 应答 {"result":{"model":"<新 id>","provider":...,"rebuilt":true}}
      → 语义：切服务端默认模型 = 重建 chat client + harness agent（全局生效，
        影响后续所有轮次）；plan/todos 随 harness 重建重置，磁盘历史不受影响。
        有轮次在跑时拒绝（-32003）；空 model → -32602。
        initialize.result.model 是当前 model 的权威回显，客户端据此显示。
  {"jsonrpc":"2.0","id":4,"method":"config/get"}
      → {"result":{"config":<脱敏视图>,"sources":[实际读到的 toml 绝对路径]}}
      → config.providers[].api_key 恒为 "***set***"|"",明文永不下发；
        gateway.workspace/history 为服务端解析后的绝对路径；tui = TUI 偏好生效值。
        config.thinking.effort = 当前思考档位（运行时状态，非 toml 配置，见 thinking/set）。
  {"jsonrpc":"2.0","id":10,"method":"thinking/get"}
      → 应答 {"result":{"effort":"low|medium|high|xhigh|max|off|", "model":"<当前模型>",
             "support_efforts":[...], "default_effort":..., "off_effort":..., "capabilities":[...]}}
      → support_efforts 为空（模型没配）时回默认档位表 low/medium/high/xhigh。
  {"jsonrpc":"2.0","id":11,"method":"thinking/set","params":{"effort":"<档位>"}}
      → 应答 {"result":{"effort":"<生效档位>"}}；空参数/不在 support_efforts → -32602。
      → 语义：思考强度（Kimi [models.*].support_efforts/default_effort/off_effort），全局状态，
        下一轮 chat 生效；与 model/set 不同——不重建 harness，plan/todos 不受影响。
        "off" 映射到模型的 off_effort（没配则发端点通用的 "none"）；EFFORT 空 = 不发思考参数。
  {"jsonrpc":"2.0","id":8,"method":"mode/get","params":{"session":"<sid>"}}
      → 应答 {"result":{"session":"<sid>","mode":"plan"|"execute"}}
  {"jsonrpc":"2.0","id":9,"method":"mode/set","params":{"session":"<sid>","mode":"plan"|"execute"}}
      → 应答 {"result":{"session","mode","previous","changed","notify"}}
      → 语义：harness 的 plan/execute 模式，按会话隔离（AgentModeProvider，state["agent_mode"]，
        默认 plan）。plan = 规划/澄清/求批准，execute = 动手执行——指令级切换，
        下一轮生效；changed=true 时框架自动往下一轮注入 [Mode changed] 通知。
        同值切换 changed=false 且不发通知；非法 mode → -32602；空参数 → -32602。
        依赖服务端会话对象复用（runtime.RT.sessions）；进程重启后模式回到默认。
  {"jsonrpc":"2.0","id":3,"method":"initialize"} / {"method":"ping"}

服务端 → 客户端（一轮进行中的流式事件，通知，无 id）：
  {"jsonrpc":"2.0","method":"agent/event",
   "params":{"session":"<sid>","event":<Event>}}

  Event := {"type":"thinking_delta","text":str}            ← chunk 的 text_reasoning
         | {"type":"thinking_end"}                         ← 一次模型调用结束
         | {"type":"tool_start","id","name","arg","params"} ← arguments 已拼完整并解析
         | {"type":"tool_line","id","text"}                 ← 工具执行输出（截断 4000）
         | {"type":"tool_end","id","status":"ok"|"error"}
         | {"type":"answer_delta","text":str}               ← chunk 的 text 增量

一轮的终态（有 id，恰好一个）：
  成功 {"jsonrpc":"2.0","id":1,"result":{"ok":true,"text":<全文>,"usage":{...}}}
  失败 {"jsonrpc":"2.0","id":1,"error":{"code":...,"message":...}}

  错误码：-32700 解析错误 / -32600 非法请求 / -32601 方法不存在
         -32602 参数非法 / -32000 模型调用失败 / -32001 已取消
         -32003 该会话上一轮还在跑

流式模式 = 「事件通知在前、终态响应在后」：JSON-RPC 规范无流式语义，
客户端按请求 id 把事件归到当前轮，终态到达即该轮结束。
════════════════════════════════════════════════════════════════

配置（唯一来源 = TOML 文件，实现见 config.py；没有任何业务环境变量）：
  $VERSE_HOME/config.toml    默认 ~/.verse/config.toml   providers/models/gateway/默认值
  $VERSE_HOME/tui.toml       默认 ~/.verse/tui.toml      TUI 偏好（agent/speed/persist/shot/check）
  <repo>/.verse/local.toml   项目级覆盖（标量替换、表递归深合并）
  唯一环境变量 VERSE_HOME = 换配置目录，不参与业务配置。坏文件 = 警告+回退默认，不中断启动。
  密钥：providers.<name>.api_key 明文存文件；config/get 只下发 "***set***"|"",明文永不外传。
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

# 错误码常量：值即上面 docstring 里那张表（前端按码分流，test_unit_protocol 守值）
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
RUN_FAILED = -32000
CANCELLED = -32001
SESSION_BUSY = -32003

# 服务端身份：initialize.result 回显，客户端据此判断服务端版本（协议只加不改）
SERVER_NAME = "verse-agent-backend"
SERVER_VERSION = "1.0.0"

# initialize.result.methods 的能力发现清单；必须等于 dispatch.HANDLERS 的键集合
# （test_unit_protocol 守着这条不变量——清单撒谎会让客户端误判服务端能力）
METHODS = ["initialize", "ping", "agent/chat", "agent/cancel", "agent/reset",
           "model/set", "thinking/get", "thinking/set",
           "mode/get", "mode/set", "config/get"]


def event(session: str, ev: dict[str, Any]) -> dict[str, Any]:
    """agent/event 通知信封（无 id）：客户端按请求 id 把它归到当前轮。"""
    return {"jsonrpc": "2.0", "method": "agent/event",
            "params": {"session": session, "event": ev}}


def err(rid: Any, code: int, message: str) -> dict[str, Any]:
    """错误终态信封；一轮恰好一个终态（result 或 error），两者都走 Conn。"""
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


@dataclass
class Conn:
    """一条连接的状态与串行发送口 —— 原 handler 里的局部变量（ws / send_lock / tasks）收成一处。

    事件与终态共用一把锁：帧不会交错损坏（与原来每连接一个 asyncio.Lock 等价）。
    tasks 按 session 索引进行中的轮次，agent/cancel 靠它掐轮、agent/chat 靠它判忙。
    """

    ws: Any
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    tasks: dict[str, asyncio.Task[Any]] = field(default_factory=dict)

    async def send(self, payload: dict[str, Any]) -> None:
        async with self.lock:
            await self.ws.send(json.dumps(payload, ensure_ascii=False))

    async def reply(self, rid: Any, result: dict[str, Any]) -> None:
        await self.send({"jsonrpc": "2.0", "id": rid, "result": result})

    async def fail(self, rid: Any, code: int, message: str) -> None:
        await self.send(err(rid, code, message))

    async def event(self, session: str, ev: dict[str, Any]) -> None:
        await self.send(event(session, ev))
