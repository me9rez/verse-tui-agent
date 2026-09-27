"""harness 装配域 —— 模型 ref 解析、上下文压缩预算、chat client + harness agent 构造。

全部是「收参数不读全局」的函数：cfg / workspace / history_dir 由调用方（runtime）传入，
这样纯逻辑（模型解析、预算换算）能离线断言，也让「装配用了哪些路径」在调用点一眼可见。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from agent_framework import (
    FileHistoryProvider,
    FileSystemAgentFileStore,
    create_harness_agent,
)

from config import ConfigError, resolve_provider_key
from images import accepts as model_accepts_images
from projection import ProjectedOpenAIChatClient, make_chat_preparer

DEFAULT_MAX_OUTPUT_TOKENS = 16_384   # max_context_size 配了但 max_output_size 没配时的输出预留


def resolve_model(cfg: dict[str, Any], model_ref: str) -> tuple[str, str, dict, dict]:
    """model ref（[models] 别名，或裸 model id）→ (provider 名, 真实 model id, provider 表, 模型表)。

    模型表是 load_config 应用过 overrides 的 effective 视图；裸 id 没有别名表，返回空 dict
    （向后兼容 model/set 传裸 id——绑到 default_model 所属 provider）。
    """
    mdef = cfg["models"].get(model_ref) or {}
    if not mdef:  # 裸 id：绑到 default_model 所属 provider（向后兼容 model/set 传裸 id）
        d = cfg["models"].get(str(cfg.get("default_model", "")))
        if d is None:
            raise ConfigError(f"default_model {cfg.get('default_model', '')!r} 不在 [models] 里（检查 config.toml）")
        pname, raw = str(d["provider"]), model_ref
    else:
        pname, raw = str(mdef["provider"]), str(mdef["model"])
    pdef = cfg["providers"].get(pname)
    if pdef is None:
        raise ConfigError(f"providers 里没有 {pname!r}（检查 config.toml / local.toml）")
    return pname, raw, pdef, mdef


def compaction_kwargs(mdef: dict[str, Any]) -> dict[str, Any]:
    """Kimi 同款上下文三件套 → harness 压缩预算（ContextWindowCompactionStrategy）。

    不配 max_context_size = 完全不启用压缩（现状行为）。策略的 input_budget = 窗口 - 输出；
    max_input_size（Kimi：压缩/溢出预算优先用它）通过 window = min(ctx, in + out) 让
    input_budget 恰好等于 min(max_input_size, ctx - out)，绝不虚高过真实窗口。
    """
    max_ctx = int(mdef.get("max_context_size") or 0)
    if max_ctx <= 0:
        return {}
    max_out = int(mdef.get("max_output_size") or 0) or DEFAULT_MAX_OUTPUT_TOKENS
    max_in = int(mdef.get("max_input_size") or 0)
    window = min(max_ctx, max_in + max_out) if max_in > 0 else max_ctx
    return {"max_context_window_tokens": window, "max_output_tokens": max_out}


def build_agent(cfg: dict[str, Any], model_ref: str, workspace: Path, history_dir: Path):
    """按 model ref 造 chat client + harness agent（启动、model/set、惰性重建共用）。

    切换 = 整体重建：plan/todos（内存 SessionStore）随之重置，
    对话历史在 FileHistoryProvider 磁盘 JSONL 里不受影响。
    """
    pname, raw, pdef, mdef = resolve_model(cfg, model_ref)
    api_key = resolve_provider_key(pdef)
    if not api_key:
        raise ConfigError(f"provider {pname!r} 没有 api_key（providers.{pname}.api_key 或其 env 子表）")
    # capabilities.image_in 门控的是「请求视图」而非请求成败：不支持图片的模型在
    # 请求发出前把图片投影为确定性文本占位符（projection.py），事实源只读、缓存稳定
    project_images = not model_accepts_images(cfg, model_ref)
    # Kimi 同款：模型级 base_url 优先于 provider 的（[models.x].base_url 覆盖 [providers.y].base_url）
    base_url = str(mdef.get("base_url") or pdef.get("base_url") or "")
    if str(pdef.get("type", "openai")).lower() == "openai_responses":
        # Responses API 无 preparer 钩子：用子类覆写 _prepare_request
        cli = ProjectedOpenAIChatClient(
            project_images=project_images, model=raw, base_url=(base_url or None), api_key=api_key)
    else:
        from agent_framework.openai import (
            OpenAIChatCompletionClient as ClientCls,  # Chat Completions
        )
        cli = ClientCls(
            model=raw, base_url=(base_url or None), api_key=api_key,
            message_preparer=make_chat_preparer(project_images),
        )
    ag = create_harness_agent(
        # 框架 harness 的注解只认 Responses 家族的 Options 协议，Chat Completions 客户端
        # 运行时完全可用但静态判不兼容（Options 类型缺 include/prompt 等字段）——cast 收窄
        cast(Any, cli),
        name="verse-agent",
        # 对话历史：每 session 一个 append-only JSONL，跨连接/跨进程恢复（load_messages=True）
        history_provider=FileHistoryProvider(history_dir),
        # 兼容端点（wb2api/8788 等）没有服务端会话：store=False 让本地文件成为历史唯一来源
        default_options={"store": False},
        **compaction_kwargs(mdef),
        # 文件工具（file_access_read/write/read_lines/replace/replace_lines/ls/grep/delete）：
        # FileAccessProvider 是 opt-in，只有传 file_access_store 才装配（不传 = agent 没有任何文件工具）。
        # 根取 workspace（已 resolve 的绝对路径）；store 自身拒绝 `..` 与绝对路径逃逸、
        # 并拒符号链接，所以模型的文件操作锁在沙箱内。根目录懒创建，构造 store 不碰盘。
        file_access_store=FileSystemAgentFileStore(workspace),
        # 协议没有审批通道（pending approval 会让那一轮永远等不到），且工具已经收敛在 workspace 内
        # → 只读与写工具一律 never_require，不触发审批等待
        file_access_disable_write_tool_approval=True,
        file_access_disable_readonly_tool_approval=True,
        # 关掉 FileMemoryProvider：它的默认 store 是 {cwd}/agent-file-memory（cwd = workspace），
        # 与上面的 FileAccessProvider 构成两套文件事实源 → 记忆统一走文件工具 + 会话历史
        disable_file_memory=True,
        disable_web_search=True,
    )
    return cli, ag, raw, pname
