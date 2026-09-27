"""思考档位域（Kimi Code 同款语义）—— 纯函数，收 cfg 不读模块全局。

support_efforts 配了就强校验（列表外 -32602，校验在 methods_model）；没配用默认档位表
（不含 max——responses 客户端的 ReasoningOptions.effort 上限是 xhigh，配了 support_efforts
才按配置透传）。off 是用户-facing 档位：下发时映射到 off_effort（没配则端点通用的 "none"）。
档位是全局运行时状态（对齐 model/set），但切换不重建 harness——每轮 run options 注入，
plan/todos 不受影响。模型没配 default_effort/support_efforts 时档位保持空 = 不发参数。
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("verse-agent-rpc")

DEFAULT_EFFORT_LEVELS = ["low", "medium", "high", "xhigh"]


def support(cfg: dict[str, Any], model_ref: str) -> dict[str, Any]:
    """模型的 thinking 能力视图（effective 模型表；裸 id / 未配置字段给空值）。"""
    mdef = cfg["models"].get(model_ref) or {}
    return {
        "support_efforts": [str(e) for e in mdef.get("support_efforts", [])],
        "default_effort": str(mdef.get("default_effort", "")),
        "off_effort": str(mdef.get("off_effort", "")),
        "capabilities": [str(c) for c in mdef.get("capabilities", [])],
    }


def calibrate(cfg: dict[str, Any], model_ref: str, effort: str) -> str:
    """装配/切模型后校准档位：当前档位仍被支持（或模型没配支持表）就保留，否则回落 default_effort；
    空档位也借此吃到模型默认档。返回生效档位（调用方赋回运行时状态）。"""
    sup = support(cfg, model_ref)
    if effort and sup["support_efforts"] and effort not in sup["support_efforts"]:
        log.info("思考档位 %r 不在模型 %s 的 support_efforts 里，回落 default_effort=%r",
                 effort, model_ref, sup["default_effort"])
        return sup["default_effort"]
    if not effort:
        return sup["default_effort"]
    return effort


def wire_value(cfg: dict[str, Any], model_ref: str, effort: str) -> str | None:
    """档位 → 发给端点的 effort 编码；None = 不发参数（完全向后兼容）。"""
    if not effort:
        return None
    if effort == "off":
        return support(cfg, model_ref)["off_effort"] or "none"
    return effort


def run_options(cfg: dict[str, Any], provider: str, model_ref: str, effort: str) -> dict[str, Any] | None:
    """当前档位 → agent.run 的 options，键形按 provider type 分：responses 用嵌套
    reasoning.effort，chat completions 用顶层 reasoning_effort（库原样透传给 SDK）。"""
    effort_wire = wire_value(cfg, model_ref, effort)
    if effort_wire is None:
        return None
    pdef = cfg["providers"].get(provider) or {}
    if str(pdef.get("type", "openai")).lower() == "openai_responses":
        return {"reasoning": {"effort": effort_wire}}
    return {"reasoning_effort": effort_wire}
