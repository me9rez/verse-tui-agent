"""投影纯函数测试：确定性占位符 + 事实源只读（离线，无进程/文件副作用）。

对应 .hermes/plans/2026-09-26_115438-image-projection.md 的核心保证：
同一图片在任何请求里投影出逐字节相同的文本（前缀缓存不变）；存储消息永不改动。
"""
from __future__ import annotations

from agent_framework import Content, Message

import projection as P

PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
PNG_URI = f"data:image/png;base64,{PNG_1X1}"


def test_占位符确定性():
    """同一 uri 两次投影逐字节相同；不同图占位符不同；占位符含媒体类型与大小线索。"""
    a = P.image_placeholder(PNG_URI)
    b = P.image_placeholder(PNG_URI)
    assert a == b, (a, b)
    assert "image/png" in a and "sha256:" in a, a
    assert P.image_placeholder(PNG_URI + "AAAA") != a, "不同图片必须得到不同占位符"


def test_dict投影_位置保持与非图片项不动():
    dicts = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "看图"},
            {"type": "image_url", "image_url": {"url": PNG_URI}},
            {"type": "text", "text": "回答两个字"},
        ],
    }]
    out = P.project_openai_message_dicts(dicts)
    parts = out[0]["content"]
    assert len(parts) == 3, parts
    assert parts[0] is dicts[0]["content"][0], "非图片项必须引用原对象"
    assert parts[1]["type"] == "text" and "sha256:" in parts[1]["text"], parts[1]
    assert "data:" not in parts[1]["text"], "占位符里不得残留 base64 载荷"
    assert dicts[0]["content"][1]["type"] == "image_url", "入参（事实源）不得被改动"


def test_dict投影_无图消息恒等():
    dicts = [{"role": "user", "content": "纯文本"}]
    out = P.project_openai_message_dicts(dicts)
    assert out[0] is dicts[0], "无图消息原对象复用"


def test_preparer_旗标控制恒等():
    msg = Message("user", [Content.from_text("hi"), Content.from_data(b"\x89PNG", media_type="image/png")])
    dicts = [{"role": "user", "content": [
        {"type": "text", "text": "hi"},
        {"type": "image_url", "image_url": {"url": PNG_URI}},
    ]}]
    identity = P.make_chat_preparer(False)(msg, dicts)
    assert identity[0] is dicts[0], "image_in 模型恒等投影：原字典放行，不重建"
    projected = P.make_chat_preparer(True)(msg, dicts)[0]
    assert all(p["type"] != "image_url" for p in projected["content"]), "降级后不得残留图片项"


def test_Message投影_事实源只读():
    img = Content.from_data(b"\x89PNG\r\n\x1a\n", media_type="image/png")
    msg = Message("user", [Content.from_text("看图"), img])
    out = P.project_messages_if([msg], project=True)
    assert len(out) == 1 and out[0] is not msg, "含图消息必须新建，不原地改"
    assert msg.contents[1] is img and (img.uri or "").startswith("data:image/png;base64,"), \
        "事实源 Content 必须原样保留（含 data URI）"
    assert out[0].contents[1].type == "text" and "sha256:" in (out[0].contents[1].text or ""), \
        "投影后图片位置变为文本占位符"
    assert out[0].contents[0] is msg.contents[0], "非图片内容项引用原对象"


def test_Message投影_无图消息与恒等路径():
    plain = Message("user", [Content.from_text("hi")])
    out = P.project_messages_if([plain], project=True)
    assert out[0] is plain, "无图消息复用原对象"
    again = P.project_messages_if([plain], project=False)
    assert again[0] is plain, "恒等路径（image_in 模型）原对象放行"
