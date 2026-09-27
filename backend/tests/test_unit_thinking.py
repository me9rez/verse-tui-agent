"""思考档位域离线单测：支持表 / 校准回落 / 下发编码 / run options 键形。

这些语义原来只能靠 live 套件（test_rpc_protocol.py::test_thinking档位读写校验与持久）覆盖，
拆出纯函数后可以按分支断言到每一格。
"""
from __future__ import annotations

import thinking


def _cfg(supports=None, default="", off="", ptype="openai"):
    m: dict = {"provider": "p"}
    if supports is not None:
        m["support_efforts"] = supports
    if default:
        m["default_effort"] = default
    if off:
        m["off_effort"] = off
    return {"models": {"m": m}, "providers": {"p": {"type": ptype}}}


def test_支持表与默认档():
    sup = thinking.support(_cfg(["low", "high"], default="high", off="none"), "m")
    assert sup["support_efforts"] == ["low", "high"] and sup["default_effort"] == "high"
    assert sup["off_effort"] == "none"
    assert thinking.support(_cfg(), "裸id") == {
        "support_efforts": [], "default_effort": "", "off_effort": "", "capabilities": []}


def test_校准回落():
    cfg = _cfg(["low"], default="low")
    assert thinking.calibrate(cfg, "m", "xhigh") == "low", "不支持当前档位 → 回落 default_effort"
    assert thinking.calibrate(cfg, "m", "low") == "low", "支持则保留"
    assert thinking.calibrate(cfg, "m", "") == "low", "空档位吃到模型默认档"
    assert thinking.calibrate(_cfg(), "m", "high") == "high", "模型没配支持表 → 不动当前档位"


def test_下发编码():
    cfg = _cfg(["low"], off="none")
    assert thinking.wire_value(cfg, "m", "") is None, "空档位 = 不发思考参数（向后兼容）"
    assert thinking.wire_value(cfg, "m", "off") == "none", "off 映射到 off_effort"
    assert thinking.wire_value(_cfg(["low"]), "m", "off") == "none", "没配 off_effort → 端点通用的 none"
    assert thinking.wire_value(cfg, "m", "low") == "low"


def test_run_options键形随provider类型():
    cfg = _cfg(["low"])
    assert thinking.run_options(cfg, "p", "m", "low") == {"reasoning_effort": "low"}
    assert thinking.run_options(_cfg(["low"], ptype="openai_responses"), "p", "m", "low") == \
        {"reasoning": {"effort": "low"}}, "responses 家族用嵌套 reasoning.effort"
    assert thinking.run_options(cfg, "p", "m", "") is None, "档位为空 → 不带 options"
    assert thinking.run_options(cfg, "缺 provider", "m", "low") == {"reasoning_effort": "low"}, \
        "provider 未装配/缺失时按 chat completions 处理"


def test_默认档位表不含max():
    """responses 客户端的 ReasoningOptions.effort 上限是 xhigh；max 只有模型显式配了才透传。"""
    assert thinking.DEFAULT_EFFORT_LEVELS == ["low", "medium", "high", "xhigh"]
