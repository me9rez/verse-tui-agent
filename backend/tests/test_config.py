"""配置加载测试：sandbox 把 VERSE_HOME 指到临时目录，覆盖 config.py 全部分支（离线）。"""
from __future__ import annotations

import contextlib
import io
import json

import config as C


def test_无文件时使用内置默认(sandbox):
    with sandbox({}) as root:
        cfg, tui, src = C.load_config(root / "proj")
    assert cfg["default_model"] == "wb2api/cn:hy3", cfg["default_model"]
    assert cfg["gateway"]["port"] == 8765, cfg["gateway"]["port"]
    assert tui["agent"] == "mock", tui["agent"]
    assert src == [], src


def test_config_toml覆盖default_model并进sources(sandbox):
    with sandbox({"home/config.toml": 'default_model = "my-model"\n'}) as root:
        cfg, _, src = C.load_config(root / "proj")
    assert cfg["default_model"] == "my-model", cfg["default_model"]
    assert any(s.endswith("config.toml") for s in src), src


def test_local_toml覆盖标量且保留未覆盖键(sandbox):
    files = {
        "home/config.toml": 'default_model = "a"\n[gateway]\nport = 1111\n',
        "proj/.verse/local.toml": 'default_model = "b"\n',
    }
    with sandbox(files) as root:
        cfg, _, _ = C.load_config(root / "proj")
    assert cfg["default_model"] == "b", cfg["default_model"]
    assert cfg["gateway"]["port"] == 1111, cfg["gateway"]["port"]


def test_provider表深合并(sandbox):
    files = {
        "home/config.toml": '[providers.x]\nbase_url = "http://a"\napi_key = "k1"\n',
        "proj/.verse/local.toml": '[providers.x]\nbase_url = "http://b"\n',
    }
    with sandbox(files) as root:
        cfg, _, _ = C.load_config(root / "proj")
    assert cfg["providers"]["x"]["base_url"] == "http://b", cfg["providers"]["x"]
    assert cfg["providers"]["x"]["api_key"] == "k1", cfg["providers"]["x"]


def test_tui_toml覆盖默认且保留未覆盖键(sandbox):
    with sandbox({"home/tui.toml": 'agent = "rpc"\nspeed = 2.5\n'}) as root:
        _, tui, _ = C.load_config(root / "proj")
    assert tui["agent"] == "rpc", tui["agent"]
    assert tui["speed"] == 2.5, tui["speed"]
    assert tui["persist"] is True, tui["persist"]


def test_models_overrides深合并与禁止键剔除(sandbox):
    """Kimi 同款 [models.x.overrides]：effective 值 = 顶层字段被 overrides 覆盖，
    但 provider/model/base_url 三键不接受覆盖（身份与端点不可改）。"""
    files = {
        "home/config.toml": (
            '[providers.x]\napi_key = "k"\n'
            '[models.probe]\n'
            'provider = "x"\n'
            'model = "m1"\n'
            'max_context_size = 128000\n'
            'max_input_size = 96000\n'
            'max_output_size = 16384\n'
            'capabilities = ["thinking", "image_in"]\n'
            'support_efforts = ["low", "high"]\n'
            'default_effort = "low"\n'
            'off_effort = "none"\n'
            'display_name = "Probe A"\n'
            '[models.probe.overrides]\n'
            'max_context_size = 200000\n'
            'display_name = "Probe B"\n'
            'provider = "evil"\n'
            'model = "evil-model"\n'
            'base_url = "http://evil"\n'
        ),
    }
    with sandbox(files) as root:
        cfg, _, _ = C.load_config(root / "proj")
        m = cfg["models"]["probe"]
        view = C.sanitize(cfg, C.DEFAULT_TUI)
    assert m["max_context_size"] == 200000, m          # override 生效
    assert m["display_name"] == "Probe B", m           # override 生效
    assert m["provider"] == "x", m                     # 禁止键被剔除，保留顶层
    assert m["model"] == "m1" and "base_url" not in m, m
    assert m["max_input_size"] == 96000 and m["off_effort"] == "none", m
    entry = next(e for e in view["models"] if e["alias"] == "probe")
    assert entry["support_efforts"] == ["low", "high"], entry
    assert entry["capabilities"] == ["thinking", "image_in"], entry
    assert entry["default_effort"] == "low" and entry["max_output_size"] == 16384, entry
    assert entry["display_name"] == "Probe B", entry   # sanitize 下发的是 effective 值


def test_models_无overrides时字段原样透传(sandbox):
    files = {
        "home/config.toml": (
            '[providers.x]\napi_key = "k"\n'
            '[models.plain]\nprovider = "x"\nmodel = "m2"\ndefault_effort = "high"\n'
        ),
    }
    with sandbox(files) as root:
        cfg, _, _ = C.load_config(root / "proj")
    m = cfg["models"]["plain"]
    assert m["default_effort"] == "high", m
    assert m.get("support_efforts", []) == [] and m.get("capabilities", []) == [], m  # 未配字段不物化，消费方 .get 兜底
    assert "overrides" not in json.dumps(C.sanitize(cfg, C.DEFAULT_TUI)), "overrides 子表不下发"


def test_坏toml回退默认并打stderr警告(sandbox):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf), sandbox({"home/config.toml": "default_model = [broken"}) as root:
        cfg, _, _ = C.load_config(root / "proj")
    assert cfg["default_model"] == C.DEFAULTS["default_model"], cfg["default_model"]
    assert "解析失败" in buf.getvalue(), buf.getvalue()[:80]


def test_resolve_provider_key三级回落():
    assert C.resolve_provider_key({"api_key": "sk-direct", "env": {"K": "sk-fb"}}) == "sk-direct"
    assert C.resolve_provider_key({"api_key": "", "env": {"K": "sk-fb"}}) == "sk-fb"
    assert C.resolve_provider_key({"api_key": "", "env": {}}) == ""


def test_sanitize脱敏且保留模型表():
    cfg_s = {
        "default_model": "m", "default_mode": "plan",
        "gateway": {"host": "127.0.0.1", "port": 8765},
        "providers": {"x": {"type": "openai", "base_url": "u", "api_key": "sk-secret"}},
        "models": {"m": {"provider": "x", "model": "raw", "max_context_size": 1, "display_name": "M"}},
    }
    s = C.sanitize(cfg_s, C.DEFAULT_TUI)
    assert "sk-secret" not in json.dumps(s), json.dumps(s)[:120]
    assert s["providers"][0]["api_key"] == "***set***", s["providers"][0]["api_key"]
    assert s["models"][0]["alias"] == "m" and s["models"][0]["model"] == "raw", s["models"]


def test_未知顶层表透传且default_mode默认plan(sandbox):
    with sandbox({"home/config.toml": '[future_section]\nx = 1\n'}) as root:
        cfg, _, _ = C.load_config(root / "proj")
    assert cfg.get("future_section", {}).get("x") == 1, cfg.get("future_section")
    assert C.DEFAULTS["default_mode"] == "plan", C.DEFAULTS["default_mode"]
