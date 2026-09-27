"""主题域（纯逻辑，无导入期副作用）—— Kimi Code 同款的 19 个颜色 token + 自定义 JSON 主题。

**为什么主题由后端读**：前端不读任何配置文件与业务环境变量（AGENTS §5 铁律），
所以 `<VERSE_HOME>/themes/*.json` 在这里扫描、校验，再经 `theme/list` 下发给前端。
Kimi 那边是 CLI 自己读 `~/.kimi-code/themes/`，这是本仓库唯一与它不同的结构点。

**为什么照抄 Kimi 的 token 名**：它的名字是「按用途」命名的（链接 / 审批前缀 / diff 槽位…），
用户从 Kimi 抄来的主题文件可以原样放到我们的主题目录里用 —— 名字对齐才有这个便利。
前端再把这些 token 映射到自己的 palette（`src/core/theme.ts`）。

错误哲学照搬 Kimi 的「尽量别打断你」：
  · 色值不合法（不是 `#` + 6 位 hex）→ 跳过该项，回退基准调色板，其余照常生效；
  · 无法识别的 token → 忽略，不影响其它颜色；
  · 文件不存在 / JSON 损坏 / 缺 name / 不是对象 → 跳过该文件（只影响它自己）。

`auto` 模式未实现（用户拍板取 A 方案）：没有终端背景探测，也就没有「解析成哪一个」的问题。
自定义主题想要浅色，写 `"base": "light"`（Kimi 同款语义）即可。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

# 内置基准调色板：值与 Kimi Code 文档的 dark / light 两列逐项一致。
# 这是「默认主题」的唯一来源；前端 src/core/theme.ts 里的 DEFAULT_THEME 必须与 DARK 同值
#（离线/未握手时用它兜底，gateway 连不上也照常出图）。
DARK: dict[str, str] = {
    "primary": "#4FA8FF",
    "accent": "#5BC0BE",
    "text": "#E0E0E0",
    "textStrong": "#F5F5F5",
    "textDim": "#888888",
    "textMuted": "#6B6B6B",
    "border": "#5A5A5A",
    "borderFocus": "#E8A838",
    "success": "#4EC87E",
    "warning": "#E8A838",
    "error": "#E85454",
    "diffAdded": "#4EC87E",
    "diffRemoved": "#E85454",
    "diffAddedStrong": "#7AD99B",
    "diffRemovedStrong": "#F08585",
    "diffGutter": "#6B6B6B",
    "diffMeta": "#888888",
    "roleUser": "#FFCB6B",
    "shellMode": "#BD93F9",
}

LIGHT: dict[str, str] = {
    "primary": "#1565C0",
    "accent": "#00838F",
    "text": "#1A1A1A",
    "textStrong": "#1A1A1A",
    "textDim": "#454545",
    "textMuted": "#5F5F5F",
    "border": "#737373",
    "borderFocus": "#92660A",
    "success": "#0E7A38",
    "warning": "#92660A",
    "error": "#B91C1C",
    "diffAdded": "#0E7A38",
    "diffRemoved": "#B91C1C",
    "diffAddedStrong": "#0E7A38",
    "diffRemovedStrong": "#B91C1C",
    "diffGutter": "#737373",
    "diffMeta": "#5F5F5F",
    "roleUser": "#9A4A00",
    "shellMode": "#7C3AED",
}

BASES: dict[str, dict[str, str]] = {"dark": DARK, "light": LIGHT}

#: 可被自定义主题覆盖的 token 名（顺序即文档里的顺序）。多出来的键按 Kimi 的做法忽略。
TOKENS: tuple[str, ...] = tuple(DARK)

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

THEME_DIR_NAME = "themes"


def theme_dir(home: Path) -> Path:
    """主题目录：`<VERSE_HOME>/themes`（Kimi 是 `~/.kimi-code/themes`，我们对齐自己的 home）。"""
    return home / THEME_DIR_NAME


def parse_theme(raw: Any, fallback_name: str = "") -> dict[str, Any] | None:
    """校验一个主题 JSON → `{name, displayName, base, colors}`；不合法返回 None（静默跳过）。

    只有 `colors` 里的合法 hex 会被保留 —— 校验在入口做一次，后面所有消费者都不用再防。
    """
    if not isinstance(raw, dict):
        return None
    name = raw.get("name") if isinstance(raw.get("name"), str) else fallback_name
    if not name:
        return None
    base = raw.get("base") if raw.get("base") in BASES else "dark"
    colors: dict[str, str] = {}
    src = raw.get("colors")
    if isinstance(src, dict):
        for key, value in src.items():
            if key in TOKENS and isinstance(value, str) and HEX_RE.match(value):
                colors[key] = value
    display = raw.get("displayName")
    return {
        "name": str(name),
        "displayName": str(display) if isinstance(display, str) and display else str(name),
        "base": base,
        "colors": colors,
    }


def list_themes(home: Path) -> list[dict[str, Any]]:
    """扫 `<home>/themes/*.json`。每次调用重扫目录 —— 新加的主题文件不用重启（Kimi 同款）。"""
    out: list[dict[str, Any]] = []
    directory = theme_dir(home)
    if not directory.is_dir():
        return out
    for path in sorted(directory.glob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            # 坏文件只影响它自己：stderr 留痕，其余主题照常可用（启动不中断）
            print(f"[theme] {path} 解析失败，已跳过：{e}", file=sys.stderr)
            continue
        theme = parse_theme(raw, fallback_name=path.stem)
        if theme is None:
            print(f"[theme] {path} 不是合法主题（缺 name 或结构不对），已跳过", file=sys.stderr)
            continue
        theme["source"] = "custom"
        theme["path"] = str(path.resolve())
        out.append(theme)
    return out


def resolve(name: str, themes: list[dict[str, Any]]) -> tuple[str, dict[str, str]]:
    """主题名 → `(实际生效的名字, 完整 19 token)`。

    找得到自定义主题就用它（`base` 打底 + 覆盖项）；找不到就按内置名处理
    （`dark` / `light`）；完全认不出（含空串）→ 内置 `dark`。
    """
    for theme in themes:
        if theme.get("name") == name:
            base = BASES.get(str(theme.get("base")), DARK)
            return name, {**base, **theme.get("colors", {})}
    if name in BASES:
        return name, dict(BASES[name])
    return "dark", dict(DARK)


def base_of(name: str, themes: list[dict[str, Any]]) -> str:
    """主题名 → 它用的基准（`dark` / `light`）。

    前端要用它决定自有底色（浅色主题必须配浅底，否则压在亮色上的字会变成黑压黑），
    所以 `theme/list` 与 `theme/set` 的应答都带上。
    """
    for theme in themes:
        if theme.get("name") == name:
            return str(theme.get("base") or "dark")
    return name if name in BASES else "dark"


def catalog(home: Path, current: str) -> dict[str, Any]:
    """`theme/list` 的返回体：内置两项 + 自定义主题 + 当前主题的解析结果。"""
    custom = list_themes(home)
    items = [
        {"name": name, "displayName": name, "base": name, "colors": dict(palette),
         "source": "builtin"}
        for name, palette in BASES.items()
    ]
    items.extend(custom)
    name, colors = resolve(current, custom)
    return {
        "current": name,
        "requested": current,
        "base": base_of(name, custom),
        "colors": colors,
        "themes": items,
    }
