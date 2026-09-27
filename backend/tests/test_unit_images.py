"""多模态入参域离线单测：shape/base64/张数/大小校验 + capabilities 门控。

同一批规则在 live 套件里也有断言（test_rpc_protocol.py::test_images多模态校验 走真连接）——
那里验证协议路径，这里验证纯函数本身，秒级且不联网。
"""
from __future__ import annotations

import images

PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def test_合法图片通过():
    assert images.validate([{"media_type": "image/png", "data": PNG_1X1}]) is None
    assert images.validate([{"media_type": "image/jpeg", "data": PNG_1X1}] * images.MAX_IMAGES_PER_TURN) is None


def test_非法形状逐条拒绝():
    cases = [
        ("不是数组", "no"),
        ("对象不是数组", {"media_type": "image/png", "data": PNG_1X1}),
        ("超过 4 张", [{"media_type": "image/png", "data": PNG_1X1}] * (images.MAX_IMAGES_PER_TURN + 1)),
        ("元素不是对象", ["str"]),
        ("media_type 非 image/*", [{"media_type": "text/plain", "data": PNG_1X1}]),
        ("media_type 缺失", [{"data": PNG_1X1}]),
        ("data 非字符串", [{"media_type": "image/png", "data": 123}]),
        ("data 为空", [{"media_type": "image/png", "data": ""}]),
        ("data 非法 base64", [{"media_type": "image/png", "data": "!!!bad!!!"}]),
        ("超过单图 12MB", [{"media_type": "image/png", "data": "A" * (images.MAX_IMAGE_B64_BYTES + 4)}]),
    ]
    for label, value in cases:
        msg = images.validate(value)
        assert msg, f"{label} 必须被拒（实际返回 {msg!r}）"
        assert isinstance(msg, str) and msg, f"{label} 的错误消息要能直接下发（中文文案）"


def test_图片能力门控():
    """capabilities 是显式追加式标签：没配 = 保守视为不支持（请求前投影降级而不是丢给端点）。"""
    cfg = {"models": {"a": {"capabilities": ["image_in"]},
                      "b": {"capabilities": ["image_out"]},
                      "c": {"capabilities": []},
                      "d": {}}}
    assert images.accepts(cfg, "a") is True
    for alias in ("b", "c", "d", "裸id"):
        assert images.accepts(cfg, alias) is False, f"{alias} 不该被判为支持图片"
