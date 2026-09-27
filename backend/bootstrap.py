"""运行时引导域 —— 配置装载转发、路径解析、日志（配置读取的唯一实现见 config.py）。

与 config.py 的分工：config.py 负责 TOML 合并/脱敏（纯函数 + 坏文件回退），
这里只负责「进程启动后的一次性动作」：建目录、resolve 路径、chdir(工作区)、配日志。

为什么要 init() 而不是在导入期做这些：拆分后纯域模块（images/thinking/harness/rpc_protocol）
要能被 pytest 离线 import，导入就 chdir 会污染测试进程的 cwd（原来 rpc_server 就是导入即 chdir）。
init() 幂等，rpc_server 启动时调一次；runtime.ensure_agent() 也会兜底调一次，保证
「文件/命令工具的相对路径一定落在 WORKSPACE」这条不变量不依赖调用顺序。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from config import load_config

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

# ── 配置装配：唯一来源是 TOML（见 config.py）────────────────────────
CFG, TUI, CFG_FILES = load_config(REPO_ROOT)   # 只读文件，无副作用
GW = CFG["gateway"]
HOST = str(GW.get("host", "127.0.0.1"))
PORT = int(GW.get("port", 8765))
WORKSPACE = Path(GW["workspace"]) if GW.get("workspace") else REPO_ROOT / ".agent-sandbox"
HISTORY_DIR = Path(GW["history"]) if GW.get("history") else HERE / "history"

DEFAULT_MODEL_ALIAS = str(CFG.get("default_model", ""))
DEFAULT_MODE = str(CFG.get("default_mode", "plan"))

log = logging.getLogger("verse-agent-rpc")

_initialized = False


def init() -> None:
    """幂等引导：建目录 → resolve → 解析后路径写回 config/get 视图 → chdir(WORKSPACE) → 配日志。

    cwd 必须是 WORKSPACE：工具的文件/命令落在工作区，与历史文件分开。
    """
    global _initialized, WORKSPACE, HISTORY_DIR
    if _initialized:
        return
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACE, HISTORY_DIR = WORKSPACE.resolve(), HISTORY_DIR.resolve()
    GW["workspace"], GW["history"] = str(WORKSPACE), str(HISTORY_DIR)  # config/get 展示解析后路径
    os.chdir(WORKSPACE)

    logging.basicConfig(
        level=str(GW.get("log_level", "INFO")).upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # 框架的 ExperimentalWarning 对使用者无意义（FileHistoryProvider 标记为实验特性），只降级不隐藏错误
    logging.getLogger("agent_framework").addFilter(
        type("_F", (logging.Filter,), {"filter": lambda self, r: "ExperimentalWarning" not in r.getMessage()})()
    )
    _initialized = True
