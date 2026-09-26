"""图片消息的请求时投影 —— 会话事实源只读，视图按当前模型能力生成。

设计（见 .hermes/plans/2026-09-26_115438-image-projection.md）：
  - FileHistoryProvider JSONL 里的事实（原始图片 data URI）永不改动；
  - 非 image_in 模型在「请求发出前」把图片内容项替换为确定性文本占位符（原位置原顺序）；
  - 占位符 = f(图片内容本身)：sha256 前 8 位 + media_type + 大小，与位置/轮次/会话无关——
    同一张图在任何请求里投影出逐字节相同的文本，同一模型内逐轮追加，上游 prompt cache 命中；
  - image_in 模型走恒等投影：不重建、不重序列化，请求与它自己历史轮次字节一致。

本模块是纯函数集合（无 config / 文件 / 进程副作用），pytest 可直接 import。
"""
from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import Any

from agent_framework import Content, Message
from agent_framework_openai import OpenAIChatClient, OpenAIChatMessagePreparer


def image_placeholder(uri: str) -> str:
    """图片 → 确定性文本占位符。

    data URI：从 base64 载荷取哈希与大小；外部 URL：对 URL 本身取哈希。
    同一 uri 永远得到同一文本——这是前缀缓存不失效的根基，禁止加入位置/时间等请求态信息。
    """
    if uri.startswith("data:"):
        head, _, b64 = uri.partition(",")
        media = head[5:].split(";", 1)[0] or "image/unknown"
        digest = hashlib.sha256(b64.encode()).hexdigest()[:8]
        size_kb = max(1, len(b64) * 3 // 4 // 1024)
        return f"[图片已省略 {media} sha256:{digest} {size_kb}KB —— 当前模型不支持图片输入]"
    digest = hashlib.sha256(uri.encode()).hexdigest()[:8]
    return f"[图片已省略 sha256:{digest} —— 当前模型不支持图片输入]"


def _is_image_part(part: Any) -> bool:
    """OpenAI Chat Completions 字典里的图片内容项。"""
    return isinstance(part, dict) and part.get("type") == "image_url"


def project_openai_message_dicts(dicts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Chat Completions 请求字典级投影：image_url 项 → text 占位符项，原位置原顺序。

    无图消息原对象直接复用；含图消息浅拷贝替换——入参列表（及 provider 持有的
    原始结构）只读，绝不原地修改。
    """
    out: list[dict[str, Any]] = []
    for d in dicts:
        content = d.get("content") if isinstance(d, dict) else None
        if not (isinstance(content, list) and any(_is_image_part(p) for p in content)):
            out.append(d)
            continue
        parts: list[Any] = []
        for p in content:
            if _is_image_part(p):
                url = str((p.get("image_url") or {}).get("url") or "")
                parts.append({"type": "text", "text": image_placeholder(url)})
            else:
                parts.append(p)
        nd = dict(d)
        nd["content"] = parts
        out.append(nd)
    return out


def make_chat_preparer(project_images: bool) -> OpenAIChatMessagePreparer:
    """装配 Chat Completions 客户端的 message_preparer（agent-framework 官方钩子）。

    project_images=False（image_in 模型）返回恒等 preparer——请求字典原样放行，
    不做任何重建，保证与该模型历史轮次字节一致。
    """
    def preparer(_message: Message, dicts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return project_openai_message_dicts(dicts) if project_images else dicts

    return preparer


def _is_image_content(c: Any) -> bool:
    """framework Content 级的图片判定（data/uri 且顶层 media type 为 image）。"""
    return (
        isinstance(c, Content)
        and c.type in ("data", "uri")
        and c.has_top_level_media_type("image")
    )


def project_messages_if(messages: Sequence[Message], project: bool) -> list[Message]:
    """framework Message 级投影（Responses API 用）：图片 Content → 新 text Content。

    - project=False：原对象原样返回（恒等，不重建）；
    - project=True：无图消息复用原对象；含图消息新建 Message（role 不变），
      图片位置替换为占位符，其余内容项引用原对象——事实源只读。
    """
    if not project:
        return list(messages)
    out: list[Message] = []
    for m in messages:
        if not any(_is_image_content(c) for c in m.contents):
            out.append(m)
            continue
        contents: list[Any] = [
            Content.from_text(image_placeholder(str(c.uri))) if _is_image_content(c) else c
            for c in m.contents
        ]
        out.append(Message(role=m.role, contents=contents))
    return out


class ProjectedOpenAIChatClient(OpenAIChatClient):
    """Responses API 客户端子类：请求前按能力旗标投影图片（非 image_in 模型用）。

    库没有公开的 preparer 钩子，覆写 `_prepare_request`（私有方法，agent-framework
    版本锁在 uv.lock；框架升级时以 projection/rpc 套件兜底）。
    """

    def __init__(self, *, project_images: bool, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._project_images = project_images

    async def _prepare_request(self, messages: Sequence[Message], options: Any) -> Any:
        projected = project_messages_if(messages, self._project_images)
        return await super()._prepare_request(projected, options)
