from __future__ import annotations

import sys
from pathlib import Path

import pytest
import uvicorn

from windows import desktop_entry


def test_gui_entry_disables_uvicorn_console_logging(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: dict[str, object] = {}

    def fake_run(*_args: object, **kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(uvicorn, "run", fake_run)
    monkeypatch.setattr(desktop_entry, "wait_and_open", lambda _url: None)
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    monkeypatch.setattr(sys, "argv", ["SafeNexVisionEdge.exe"])

    desktop_entry.main()

    assert captured["log_config"] is None
    assert captured["access_log"] is False
    assert captured["host"] == "127.0.0.1"
