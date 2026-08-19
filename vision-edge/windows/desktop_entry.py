"""Windows entry point for the SafeNex Vision Edge Agent and Console.

The Agent owns local AI monitoring, encrypted secrets, durable event delivery, and Fleet
synchronization.  The Console is a separate WebView2 window that renders the loopback-only
operations UI without launching an external browser.  Closing the Console never stops a
separately installed Windows Agent service.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn
import webview

from vision_edge.app import create_app
from vision_edge.config import load_config, save_config
from vision_edge.models import GatewayIdentity, LocalConfig

APP_NAME = "SafeNex Vision Edge"
DEFAULT_PORT = 8787


def legacy_app_data_dir() -> Path:
    root = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(root) / "SafeNex" / "VisionEdge"


def app_data_dir() -> Path:
    """Use ProgramData for the Windows service and migrate a legacy user profile once."""

    program_data = os.getenv("PROGRAMDATA")
    if not program_data:
        return legacy_app_data_dir()
    destination = Path(program_data) / "SafeNex" / "VisionEdge"
    legacy = legacy_app_data_dir()
    if not destination.exists() and legacy.exists():
        shutil.copytree(legacy, destination)
    return destination


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(("127.0.0.1", port)) != 0


def choose_port() -> int:
    if port_available(DEFAULT_PORT):
        return DEFAULT_PORT
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def create_default_config(path: Path) -> LocalConfig:
    state_dir = path.parent / "state"
    config = LocalConfig(
        identity=GatewayIdentity(
            gateway_id="gateway-unpaired",
            tenant_id="tenant-unpaired",
            site_id="site-unpaired",
        ),
        listen_host="127.0.0.1",
        listen_port=choose_port(),
        state_dir=str(state_dir),
        allow_local_key_generation=True,
    )
    save_config(path, config)
    return config


def health_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/healthz", timeout=0.8) as response:
            return response.status == 200
    except OSError:
        return False


def wait_for_health(url: str, attempts: int = 30) -> bool:
    for _ in range(attempts):
        if health_ready(url):
            return True
        time.sleep(0.5)
    return False


def configure_logging(data_dir: Path) -> None:
    logging.basicConfig(
        filename=data_dir / "vision-edge.log",
        encoding="utf-8",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def run_agent(config: LocalConfig, config_path: Path) -> None:
    """Run the loopback-only Gateway for a Windows service or Console fallback."""

    uvicorn.run(
        create_app(config, config_path),
        host=config.listen_host,
        port=config.listen_port,
        log_config=None,
        access_log=False,
    )


def ensure_local_agent(config: LocalConfig, config_path: Path, ui_url: str) -> bool:
    """Connect to the installed Agent, or start a local fallback while the Console is open."""

    if health_ready(ui_url):
        return True
    threading.Thread(target=run_agent, args=(config, config_path), daemon=True, name="vision-edge-console-agent").start()
    return wait_for_health(ui_url)


def run_console(ui_url: str) -> None:
    """Open the local operations UI in a native WebView2 window, never an external browser."""

    window = webview.create_window(
        title=APP_NAME,
        url=ui_url,
        width=1440,
        height=900,
        min_size=(1100, 700),
        text_select=True,
    )
    if window is None:
        raise RuntimeError("SafeNex Vision Edge Console window could not be created")
    webview.start(gui="edgechromium", private_mode=True)


def main() -> None:
    data_dir = app_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    config_path = data_dir / "vision-edge.json"
    config = load_config(config_path) if config_path.exists() else create_default_config(config_path)

    if "--print-config" in sys.argv:
        print(json.dumps({"config_path": str(config_path), "ui_url": f"http://127.0.0.1:{config.listen_port}"}))
        return

    configure_logging(data_dir)
    if "--agent" in sys.argv:
        run_agent(config, config_path)
        return

    ui_url = f"http://127.0.0.1:{config.listen_port}"
    if not ensure_local_agent(config, config_path, ui_url):
        raise SystemExit("SafeNex Vision Edge Agent did not become ready; see vision-edge.log")
    run_console(ui_url)


if __name__ == "__main__":
    main()
