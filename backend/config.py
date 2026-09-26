"""Verse 配置 —— 全仓库唯一读 TOML 配置的地方（Kimi Code 同款格式，snake_case）。

文件与优先级（后者覆盖前者；标量替换、表递归深合并）：
  1. 内置默认值（DEFAULTS / DEFAULT_TUI）
  2. $VERSE_HOME/config.toml   （默认 ~/.verse/config.toml，用户级）
  3. <repo>/.verse/local.toml  （项目级，同 schema）
TUI 偏好单独一文件：$VERSE_HOME/tui.toml（默认 ~/.verse/tui.toml）。
唯一环境变量 VERSE_HOME = 换目录（测试隔离也靠它），不参与业务配置。
坏文件：stderr 警告 + 跳过该文件回退默认值，绝不中断启动。
密钥：providers.<name>.api_key 明文存文件；sanitize() 之后才允许下发前端。
"""
from __future__ import annotations

import copy
import os
import sys
import tomllib
from pathlib import Path
from typing import Any


class ConfigError(Exception):
    """配置缺失/非法，携带给人看的中文消息（会变成 -32000 的 error.message）。"""


# Kimi Code 同款 [models.*] 字段白名单（config-files.html#models）。
# overrides 子表禁止覆盖身份与端点三键——Kimi 语义：provider/model/base_url 不接受。
MODEL_FIELDS: set[str] = {
    "provider", "model", "max_context_size", "max_input_size", "max_output_size",
    "capabilities", "support_efforts", "default_effort", "off_effort",
    "base_url", "display_name", "reasoning_key", "adaptive_thinking",
}
OVERRIDE_FORBIDDEN: set[str] = {"provider", "model", "base_url"}


DEFAULTS: dict[str, Any] = {
    "default_model": "wb2api/cn:hy3",
    "default_mode": "plan",
    "gateway": {"host": "127.0.0.1", "port": 8765, "workspace": "", "history": "", "log_level": "INFO"},
    "providers": {},
    "models": {},
}

DEFAULT_TUI: dict[str, Any] = {
    "agent": "mock",
    "speed": 1.0,
    "persist": True,
    "session_dir": "",
    "debug_input": False,
    "shot": {"cols": 110, "rows": 32, "mid_tool": False,
             "prompt": "这个 demo 的流式输出是怎么实现的？"},
    "check": {"timeout_ms": 150000, "prompt": ""},
}


def verse_home() -> Path:
    return Path(os.environ.get("VERSE_HOME") or Path.home() / ".verse")


def _read_toml(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with path.open("rb") as f:
            return tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        print(f"[config] {path} 解析失败，已忽略（回退默认值）：{e}", file=sys.stderr)
        return None


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def effective_model(mdef: dict[str, Any]) -> dict[str, Any]:
    """[models."<alias>"] 应用 overrides 覆盖后的 effective 视图（Kimi 同款语义）。

    有 override 的键用 override，否则用顶层字段；overrides 里的 provider/model/base_url
    被剔除（身份与端点不可覆盖），白名单外的键原样透传（向前兼容新字段）。
    """
    over = mdef.get("overrides")
    if not isinstance(over, dict):
        return copy.deepcopy(mdef)
    base = {k: v for k, v in mdef.items() if k != "overrides"}
    allowed = {k: v for k, v in over.items() if k not in OVERRIDE_FORBIDDEN}
    return _merge(base, allowed)


def load_config(project_root: Path) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """返回 (effective_config, effective_tui, 实际读到的文件绝对路径)。"""
    files: list[str] = []
    cfg = copy.deepcopy(DEFAULTS)
    for p in (verse_home() / "config.toml", project_root / ".verse" / "local.toml"):
        data = _read_toml(p)
        if data is not None:
            cfg = _merge(cfg, data)
            files.append(str(p.resolve()))
    # 三文件合并完统一应用 overrides：rpc_server 等消费者拿到的直接是 effective 值
    for alias, m in list(cfg.get("models", {}).items()):
        if isinstance(m, dict):
            cfg["models"][alias] = effective_model(m)
    tui = copy.deepcopy(DEFAULT_TUI)
    p = verse_home() / "tui.toml"
    data = _read_toml(p)
    if data is not None:
        tui = _merge(tui, data)
        files.append(str(p.resolve()))
    return cfg, tui, files


def resolve_provider_key(p: dict[str, Any]) -> str:
    """api_key 直取；为空则查 Kimi 同款 [providers.X.env] 子表（只读配置文件，不读 shell）。"""
    key = p.get("api_key") or ""
    if key:
        return str(key)
    for v in (p.get("env") or {}).values():
        if isinstance(v, str) and v:
            return v
    return ""


def sanitize(cfg: dict[str, Any], tui: dict[str, Any]) -> dict[str, Any]:
    """下发前端前的脱敏视图：api_key → '***set***'|''，明文永不出现。"""
    providers = [
        {"name": n, "type": str(p.get("type", "openai")), "base_url": str(p.get("base_url", "")),
         "api_key": "***set***" if resolve_provider_key(p) else ""}
        for n, p in sorted(cfg.get("providers", {}).items())
    ]
    models = [
        {"alias": a, "provider": str(m.get("provider", "")), "model": str(m.get("model", "")),
         "max_context_size": int(m.get("max_context_size", 0)),
         "max_input_size": int(m.get("max_input_size", 0)),
         "max_output_size": int(m.get("max_output_size", 0)),
         "capabilities": [str(c) for c in m.get("capabilities", [])],
         "support_efforts": [str(e) for e in m.get("support_efforts", [])],
         "default_effort": str(m.get("default_effort", "")),
         "off_effort": str(m.get("off_effort", "")),
         "base_url": str(m.get("base_url", "")),
         "display_name": str(m.get("display_name") or m.get("model", "")),
         "reasoning_key": str(m.get("reasoning_key", "")),
         "adaptive_thinking": m.get("adaptive_thinking")}
        for a, m in sorted(cfg.get("models", {}).items())
    ]
    return {
        "default_model": str(cfg.get("default_model", "")),
        "default_mode": str(cfg.get("default_mode", "plan")),
        "gateway": cfg.get("gateway", {}),
        "providers": providers,
        "models": models,
        "tui": tui,
    }
