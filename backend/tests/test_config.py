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


def test_坏toml回退默认并打stderr警告(sandbox):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        with sandbox({"home/config.toml": "default_model = [broken"}) as root:
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
