"""多模态入参域 —— params.images 的形状校验与 capabilities 门控（纯函数，无副作用）。

两类判断严格分开：
  - validate()：入参本身是否合法（形状/base64/张数/大小）→ 不合法回 -32602；
  - accepts()：当前模型收不收原图。**不接受也不拒绝请求**——事实源（会话 JSONL）永远存原图，
    非 image_in 模型在请求发出前由 projection.py 投影为确定性文本占位符，
    所以跨模型切换双向都能成功，请求只回 images_omitted=N。
"""
from __future__ import annotations

import base64
from typing import Any

MAX_IMAGE_B64_BYTES = 12 * 1024 * 1024   # base64 编码后的单图上限（≈9MB 原始 PNG）
MAX_IMAGES_PER_TURN = 4


def validate(images: Any) -> str | None:
    """params.images 校验：合法返回 None，否则回中文错误消息（→ -32602）。

    调用方约定：只在 images is not None 时调用（字段缺席 = 纯文本轮，不是错误）。
    """
    if not isinstance(images, list):
        return "params.images 必须是数组"
    if len(images) > MAX_IMAGES_PER_TURN:
        return f"images 最多 {MAX_IMAGES_PER_TURN} 张"
    for i, img in enumerate(images):
        if not isinstance(img, dict):
            return f"images[{i}] 必须是对象"
        mt = str(img.get("media_type") or "")
        data = img.get("data")
        if not mt.startswith("image/"):
            return f"images[{i}].media_type 必须是 image/*（收到 {mt!r}）"
        if not isinstance(data, str) or not data:
            return f"images[{i}].data 必须是非空 base64 字符串"
        if len(data) > MAX_IMAGE_B64_BYTES:
            return f"images[{i}] 超过单图 12MB 上限"
        try:
            base64.b64decode(data, validate=True)
        except (TypeError, ValueError):
            return f"images[{i}].data 不是合法 base64"
    return None


def accepts(cfg: dict[str, Any], model_ref: str) -> bool:
    """capabilities 门控：模型在 [models] 里声明 image_in 才放行。

    capabilities 未配置的模型保守视为不支持（Kimi 语义是显式追加式标签，
    宁可拒绝也不把图片扔给可能不消费的端点）。
    """
    mdef = cfg["models"].get(model_ref) or {}
    caps = mdef.get("capabilities")
    if not isinstance(caps, list) or not caps:
        return False
    return "image_in" in [str(c) for c in caps]
