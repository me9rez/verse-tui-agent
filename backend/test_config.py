"""配置加载测试：VERSE_HOME 指到临时目录，覆盖 config.py 全部分支。
跑法（不联网、不起服务）：cd backend && uv run python test_config.py
退出码即结论。
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C

PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS  {name}")
    else:
        FAIL += 1
        print(f"FAIL  {name} — {detail}")


@contextlib.contextmanager
def sandbox(files: dict[str, str]):
    """td/home = VERSE_HOME，td/proj = 项目根；files 键形如 home/config.toml、proj/.verse/local.toml。"""
    old = os.environ.get("VERSE_HOME")
    td = tempfile.TemporaryDirectory()
    root = Path(td.name)
    (root / "home").mkdir()
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    os.environ["VERSE_HOME"] = str(root / "home")
    try:
        yield root
    finally:
        td.cleanup()
        if old is None:
            os.environ.pop("VERSE_HOME", None)
        else:
            os.environ["VERSE_HOME"] = old


def main() -> int:
    with sandbox({}) as root:
        cfg, tui, src = C.load_config(root / "proj")
        check("无文件时使用内置默认",
              cfg["default_model"] == "wb2api/cn:hy3" and cfg["gateway"]["port"] == 8765
              and tui["agent"] == "mock",
              f"default_model={cfg['default_model']} port={cfg['gateway']['port']} agent={tui['agent']}")
        check("无文件时不列 sources", src == [], str(src))

    with sandbox({"home/config.toml": 'default_model = "my-model"\n'}) as root:
        cfg, tui, src = C.load_config(root / "proj")
        check("config.toml 覆盖 default_model", cfg["default_model"] == "my-model", cfg["default_model"])
        check("sources 含 config.toml 绝对路径", any(s.endswith("config.toml") for s in src), str(src))

    with sandbox({"home/config.toml": 'default_model = "a"\n[gateway]\nport = 1111\n',
                  "proj/.verse/local.toml": 'default_model = "b"\n'}) as root:
        cfg, _, _ = C.load_config(root / "proj")
        check("local.toml 覆盖 config.toml 标量", cfg["default_model"] == "b", cfg["default_model"])
        check("local.toml 未覆盖的键保留", cfg["gateway"]["port"] == 1111, str(cfg["gateway"]["port"]))

    with sandbox({"home/config.toml": '[providers.x]\nbase_url = "http://a"\napi_key = "k1"\n',
                  "proj/.verse/local.toml": '[providers.x]\nbase_url = "http://b"\n'}) as root:
        cfg, _, _ = C.load_config(root / "proj")
        check("provider 表深合并",
              cfg["providers"]["x"]["base_url"] == "http://b" and cfg["providers"]["x"]["api_key"] == "k1",
              str(cfg["providers"]["x"]))

    with sandbox({"home/tui.toml": 'agent = "rpc"\nspeed = 2.5\n'}) as root:
        _, tui, _ = C.load_config(root / "proj")
        check("tui.toml 覆盖默认", tui["agent"] == "rpc" and tui["speed"] == 2.5, str(tui["agent"]))
        check("tui.toml 未覆盖的键保留", tui["persist"] is True, str(tui["persist"]))

    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        with sandbox({"home/config.toml": "default_model = [broken"}) as root:
            cfg, _, _ = C.load_config(root / "proj")
    check("坏 TOML 不抛异常且回退默认", cfg["default_model"] == C.DEFAULTS["default_model"], cfg["default_model"])
    check("坏 TOML 有 stderr 警告", "解析失败" in buf.getvalue(), buf.getvalue()[:80])

    check("api_key 直取", C.resolve_provider_key({"api_key": "sk-direct", "env": {"K": "sk-fb"}}) == "sk-direct")
    check("空 api_key 回落 env 子表", C.resolve_provider_key({"api_key": "", "env": {"K": "sk-fb"}}) == "sk-fb")
    check("两者皆空返回空串", C.resolve_provider_key({"api_key": "", "env": {}}) == "")

    cfg_s = {"default_model": "m", "default_mode": "plan",
             "gateway": {"host": "127.0.0.1", "port": 8765},
             "providers": {"x": {"type": "openai", "base_url": "u", "api_key": "sk-secret"}},
             "models": {"m": {"provider": "x", "model": "raw", "max_context_size": 1, "display_name": "M"}}}
    s = C.sanitize(cfg_s, C.DEFAULT_TUI)
    check("sanitize 后无明文 key", "sk-secret" not in json.dumps(s), json.dumps(s)[:120])
    check("sanitize 标记已设 key", s["providers"][0]["api_key"] == "***set***", s["providers"][0]["api_key"])
    check("sanitize 保留模型表",
          s["models"][0]["alias"] == "m" and s["models"][0]["model"] == "raw", str(s["models"]))

    with sandbox({"home/config.toml": '[future_section]\nx = 1\n'}) as root:
        cfg, _, _ = C.load_config(root / "proj")
    check("未知顶层表透传不崩", cfg.get("future_section", {}).get("x") == 1, str(cfg.get("future_section")))
    check("default_mode 默认 plan", C.DEFAULTS["default_mode"] == "plan", C.DEFAULTS["default_mode"])

    print(f"\n{PASS} 通过, {FAIL} 失败")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
