"""装配域离线单测：模型 ref 解析 + 压缩预算换算（不建 client、不碰网络）。"""
from __future__ import annotations

import pytest

import harness
from config import ConfigError

CFG = {"default_model": "alias-a",
       "models": {"alias-a": {"provider": "p1", "model": "raw-a"},
                  "alias-b": {"provider": "p2", "model": "raw-b"}},
       "providers": {"p1": {"type": "openai"}, "p2": {"type": "openai_responses"}}}


def test_别名解析():
    pname, raw, pdef, mdef = harness.resolve_model(CFG, "alias-b")
    assert (pname, raw) == ("p2", "raw-b") and pdef is CFG["providers"]["p2"] and mdef is CFG["models"]["alias-b"]


def test_裸id绑到默认模型所属provider():
    """向后兼容 model/set 传裸 id：没有别名表时用 default_model 的 provider。"""
    assert harness.resolve_model(CFG, "gpt-x")[:2] == ("p1", "gpt-x")


def test_配置缺失报中文错():
    with pytest.raises(ConfigError) as e1:
        harness.resolve_model({"models": {}, "providers": {}}, "x")   # 没有 default_model 可挂靠
    assert "default_model" in str(e1.value)
    with pytest.raises(ConfigError) as e2:
        harness.resolve_model({"default_model": "a", "models": {"a": {"provider": "ghost"}}, "providers": {}}, "x")
    assert "ghost" in str(e2.value)


def test_压缩预算():
    assert harness.compaction_kwargs({}) == {}, "不配 max_context_size = 完全不启用压缩"
    assert harness.compaction_kwargs({"max_context_size": 100_000}) == {
        "max_context_window_tokens": 100_000,
        "max_output_tokens": harness.DEFAULT_MAX_OUTPUT_TOKENS}, "只配窗口 → 输出用默认预留"
    assert harness.compaction_kwargs(
        {"max_context_size": 200_000, "max_input_size": 120_000, "max_output_size": 8_000}) == {
        "max_context_window_tokens": 128_000, "max_output_tokens": 8_000}, \
        "三件套：window = min(ctx, in + out) 让 input_budget = min(in, ctx - out)"
    assert harness.compaction_kwargs({"max_context_size": 0, "max_input_size": 1_000}) == {}, \
        "窗口为 0/负数 = 不启用（不拿 max_input_size 单独触发压缩）"
