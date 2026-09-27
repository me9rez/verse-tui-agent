"""theme.py 的纯函数测试：内置表 = Kimi 真值、非法输入静默跳过、坏文件不影响别人。

对应 AGENTS「断言事实」：这里断言的是**解析结果本身**（哪些 token 活下来、回退到谁），
不是「函数被调用过」。真模型/真终端都不需要，所以这套在 CI 里恒绿是硬要求。
"""
from __future__ import annotations

import json
from pathlib import Path

import theme


def test_builtin_tables_are_kimi_truth() -> None:
    """19 个 token 齐、两套基准都在、值全是 #rrggbb，并抽查文档里的真值。"""
    assert len(theme.TOKENS) == 19
    assert set(theme.DARK) == set(theme.TOKENS)
    assert set(theme.LIGHT) == set(theme.TOKENS)
    for name, value in {**theme.DARK, **theme.LIGHT}.items():
        assert theme.HEX_RE.match(value), f"{name} 不是 #rrggbb：{value}"
    assert theme.DARK["primary"] == "#4FA8FF"
    assert theme.DARK["border"] == "#5A5A5A"
    assert theme.DARK["shellMode"] == "#BD93F9"
    assert theme.LIGHT["primary"] == "#1565C0"
    assert theme.LIGHT["roleUser"] == "#9A4A00"


def test_parse_theme_rejects_non_theme_input() -> None:
    assert theme.parse_theme(None) is None
    assert theme.parse_theme([]) is None
    assert theme.parse_theme({"colors": {}}) is None
    assert theme.parse_theme({"name": ""}) is None
    # 目录里的文件名只是兜底名：没写 name 也能用
    fallback = theme.parse_theme({"colors": {"primary": "#010203"}}, "ember")
    assert fallback is not None and fallback["name"] == "ember"


def test_parse_theme_filters_each_color_independently() -> None:
    """一个坏色值只丢它自己 —— 其余颜色照常生效（Kimi 的「尽量别打断你」）。"""
    parsed = theme.parse_theme(
        {
            "name": "ember",
            "colors": {
                "primary": "#83A598",  # 合法
                "accent": "red",  # 不是 hex
                "text": "#GGGGGG",  # 长度对但不是 hex
                "textDim": "#12345",  # 5 位
                "nope": "#FFFFFF",  # 未知 token
            },
        }
    )
    assert parsed is not None
    assert parsed["colors"] == {"primary": "#83A598"}
    assert parsed["base"] == "dark"


def test_parse_theme_base_and_display_name() -> None:
    parsed = theme.parse_theme({"name": "solar", "base": "light", "displayName": "Solarized"})
    assert parsed is not None
    assert parsed["base"] == "light"
    assert parsed["displayName"] == "Solarized"
    # base 只认 dark/light（本仓库不做 auto）：别的值回退 dark
    auto = theme.parse_theme({"name": "x", "base": "auto"})
    assert auto is not None and auto["base"] == "dark"
    # displayName 缺省回落 name
    plain = theme.parse_theme({"name": "x"})
    assert plain is not None and plain["displayName"] == "x"


def test_list_themes_skips_broken_files_without_taking_others_down(tmp_path: Path) -> None:
    directory = theme.theme_dir(tmp_path)
    directory.mkdir()
    (directory / "good.json").write_text(
        json.dumps({"name": "good", "colors": {"primary": "#010203"}}), encoding="utf-8"
    )
    (directory / "broken.json").write_text("{ 这不是 JSON", encoding="utf-8")
    (directory / "noname.json").write_text(json.dumps({"colors": {}}), encoding="utf-8")
    # 文件名兜底名生效（Kimi 同款：文件名就是主题名）
    (directory / "fallback.json").write_text(
        json.dumps({"colors": {"primary": "#040506"}}), encoding="utf-8"
    )
    found = theme.list_themes(tmp_path)
    # 文件名即主题名（Kimi 同款）：noname.json 没写 name 字段，用文件名兜底，是合法的
    assert sorted(t["name"] for t in found) == ["fallback", "good", "noname"]
    assert all(t["source"] == "custom" for t in found)
    # 只有坏 JSON 被丢下；没有 name 的那个色板为空（全部回退 dark），但主题本身可用
    assert sorted(t["name"] for t in found if t["colors"]) == ["fallback", "good"]
    assert found[0]["path"].endswith(".json")


def test_list_themes_missing_dir_is_empty(tmp_path: Path) -> None:
    assert theme.list_themes(tmp_path / "nope") == []


def test_theme_dir_is_home_subdir() -> None:
    assert theme.theme_dir(Path("C:/x")) == Path("C:/x") / "themes"


def test_resolve_overrides_only_what_the_file_wrote() -> None:
    custom = [
        {
            "name": "ember",
            "displayName": "ember",
            "base": "dark",
            "colors": {"primary": "#83A598"},
            "source": "custom",
        }
    ]
    name, colors = theme.resolve("ember", custom)
    assert name == "ember"
    assert colors["primary"] == "#83A598"  # 覆盖生效
    assert colors["accent"] == theme.DARK["accent"]  # 没写的回退基准
    assert set(colors) == set(theme.TOKENS)  # 视图永远是完整的 19 个


def test_resolve_light_base_changes_uncovered_tokens() -> None:
    custom = [
        {
            "name": "solar",
            "displayName": "solar",
            "base": "light",
            "colors": {"primary": "#000080"},
            "source": "custom",
        }
    ]
    _, colors = theme.resolve("solar", custom)
    assert colors["primary"] == "#000080"
    assert colors["text"] == theme.LIGHT["text"]
    assert colors["text"] != theme.DARK["text"]


def test_resolve_builtin_names_and_unknown_fallback() -> None:
    assert theme.resolve("light", [])[0] == "light"
    assert theme.resolve("dark", [])[0] == "dark"
    assert theme.resolve("nope", [])[0] == "dark"
    assert theme.resolve("", [])[0] == "dark"
    assert theme.resolve("nope", [])[1] == theme.DARK


def test_base_of() -> None:
    custom = [{"name": "solar", "base": "light", "colors": {}, "displayName": "solar"}]
    assert theme.base_of("solar", custom) == "light"
    assert theme.base_of("light", []) == "light"
    assert theme.base_of("dark", []) == "dark"
    assert theme.base_of("nope", []) == "dark"


def test_catalog_shape_carries_resolved_colors_and_builtins(tmp_path: Path) -> None:
    cat = theme.catalog(tmp_path, "")
    assert cat["current"] == "dark"  # 没配主题 → 内置 dark
    assert cat["requested"] == ""
    assert cat["base"] == "dark"
    assert [t["name"] for t in cat["themes"]] == ["dark", "light"]
    assert {t["source"] for t in cat["themes"]} == {"builtin"}
    assert set(cat["colors"]) == set(theme.TOKENS)


def test_catalog_uses_configured_custom_theme(tmp_path: Path) -> None:
    directory = theme.theme_dir(tmp_path)
    directory.mkdir()
    (directory / "ember.json").write_text(
        json.dumps({"name": "ember", "colors": {"primary": "#83A598"}}), encoding="utf-8"
    )
    cat = theme.catalog(tmp_path, "ember")
    assert cat["current"] == "ember"
    assert cat["colors"]["primary"] == "#83A598"
    assert [t["name"] for t in cat["themes"]] == ["dark", "light", "ember"]
    assert cat["themes"][2]["source"] == "custom"
    # 配置里写了不存在的主题名：requested 保留原样、current 回落 dark（前端据此提示）
    missing = theme.catalog(tmp_path, "ghost")
    assert missing["current"] == "dark"
    assert missing["requested"] == "ghost"
