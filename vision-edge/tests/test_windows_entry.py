from __future__ import annotations

import sys
from pathlib import Path

import pytest
import uvicorn

from windows import desktop_entry


def test_agent_entry_disables_uvicorn_console_logging(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_run(*_args: object, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.delenv("PROGRAMDATA", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(uvicorn, "run", fake_run)
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    monkeypatch.setattr(sys, "argv", ["SafeNexVisionEdge.exe", "--agent"])

    desktop_entry.main()

    assert captured["log_config"] is None
    assert captured["access_log"] is False
    assert captured["host"] == "127.0.0.1"


def test_console_uses_embedded_window_without_external_browser(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    opened: list[str] = []

    monkeypatch.delenv("PROGRAMDATA", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(desktop_entry, "health_ready", lambda _url: True)
    monkeypatch.setattr(desktop_entry, "run_console", lambda url: opened.append(url))
    monkeypatch.setattr(sys, "argv", ["SafeNexVisionEdge.exe"])

    desktop_entry.main()

    assert opened == ["http://127.0.0.1:8787"]
