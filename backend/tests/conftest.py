"""pytest 共享设施：TOML 配置沙盒 + 按需拉起的后端服务。"""
from __future__ import annotations

import contextlib
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
RPC_URL = "ws://127.0.0.1:8765"


def _port_open(port: int = 8765) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


@pytest.fixture
def sandbox():
    """配置沙盒：返回一个 contextmanager 工厂。files 键形如 home/config.toml、proj/.verse/local.toml。"""
    @contextlib.contextmanager
    def _open(files: dict[str, str]):
        old = os.environ.get("VERSE_HOME")
        td = tempfile.TemporaryDirectory()
        root = Path(td.name)
        (root / "home").mkdir()
        for rel, text in files.items():
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        os.environ["VERSE_HOME"] = str(root / "home")
        try:
            yield root
        finally:
            td.cleanup()
            if old is None:
                os.environ.pop("VERSE_HOME", None)
            else:
                os.environ["VERSE_HOME"] = old
    return _open


@pytest.fixture(scope="session")
def live_server():
    """8765 在听 → 复用（手动 pnpm backend 的场景）；否则拉起 rpc_server.py，退出只杀自己起的。"""
    if _port_open():
        yield RPC_URL
        return
    proc = subprocess.Popen([sys.executable, str(BACKEND_DIR / "rpc_server.py")], cwd=BACKEND_DIR)
    for _ in range(40):  # 20s 上限
        if _port_open():
            break
        if proc.poll() is not None:
            raise RuntimeError(f"rpc_server 启动即退出，exit={proc.returncode}")
        time.sleep(0.5)
    else:
        proc.terminate()
        raise RuntimeError("rpc_server 20s 内未监听 8765")
    try:
        yield RPC_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
