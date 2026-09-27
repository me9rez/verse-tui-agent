"""拆分守则的纯净性断言：纯域模块导入不得产生副作用（不换 cwd、不建目录）。

为什么值得测：原来 rpc_server 导入即 mkdir + chdir(工作区) + 可能打网络，于是这些纯逻辑
只能靠起真后端 + 真模型验证（慢、还要 8765）。拆分的前提就是「纯域能离线 import」，
这条断言把前提本身锁住——谁把 chdir/建目录/网络塞回纯域，这里立刻变红。
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# 纯域（无进程副作用）与引导域（只有调用 init() 才动文件系统/cwd）
PURE_MODULES = "rpc_protocol, images, thinking, harness, bootstrap, runtime, turn, dispatch, server"


def _run(code: str, cwd: Path) -> str:
    """在临时 cwd 里跑（PYTHONPATH 指 backend）——这样 cwd 是否被换掉一眼可见。"""
    env = {**os.environ, "PYTHONPATH": str(BACKEND_DIR)}
    proc = subprocess.run([sys.executable, "-c", code], cwd=str(cwd), env=env,
                          capture_output=True, text=True, timeout=180, check=False)
    assert proc.returncode == 0, f"子进程失败：{proc.stderr[-800:]}"
    return proc.stdout.strip()


def test_导入纯域不换cwd也不建工作区():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td).resolve()
        code = (
            f"import {PURE_MODULES}\n"
            "import os\n"
            "print(os.getcwd())\n"
        )
        assert _run(code, tmp) == str(tmp), "导入纯域把 cwd 换掉了（副作用漏进纯域）"
        assert list(tmp.iterdir()) == [], "导入纯域在 cwd 里建了文件/目录"


def test_bootstrap_init才换cwd并建workspace():
    """幂等 init() 是唯一允许换 cwd 的地方：建好 workspace/history 后 cwd 落在 workspace。"""
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td).resolve()
        (tmp / "home").mkdir()
        ws = tmp / "ws"
        (tmp / "home" / "config.toml").write_text(
            f'[gateway]\nworkspace = "{ws.as_posix()}"\nhistory = "{(tmp / "hist").as_posix()}"\n',
            encoding="utf-8")
        env_note = "VERSE_HOME 指向临时 home，避免读到真实配置"
        code = (
            "import os, bootstrap\n"
            "before = os.getcwd()\n"
            "bootstrap.init()\n"
            "bootstrap.init()\n"                      # 幂等：重复调用不炸、不重复换
            "print(before)\n"
            "print(os.getcwd())\n"
            "print(bootstrap.WORKSPACE)\n"
        )
        env = {**os.environ, "PYTHONPATH": str(BACKEND_DIR), "VERSE_HOME": str(tmp / "home")}
        proc = subprocess.run([sys.executable, "-c", code], cwd=str(tmp), env=env,
                              capture_output=True, text=True, timeout=180, check=False)
        assert proc.returncode == 0, f"子进程失败（{env_note}）：{proc.stderr[-800:]}"
        before, after, workspace = proc.stdout.strip().splitlines()
        assert before == str(tmp), "init() 之前不该换 cwd"
        assert Path(after) == Path(workspace) == ws.resolve(), f"init() 后 cwd 应落在 workspace：{after}"
        assert ws.is_dir() and (tmp / "hist").is_dir(), "init() 应建好 workspace 与 history 目录"
