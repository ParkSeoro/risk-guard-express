"""Windows desktop entry point for the SafeNex Vision Edge installer.

The executable starts a loopback-only Gateway in the current user's application-data
folder and opens the local operations UI once the health endpoint responds.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from vision_edge.app import create_app
from vision_edge.config import load_config, save_config
from vision_edge.models import GatewayIdentity, LocalConfig

APP_NAME = "SafeNex Vision Edge"
DEFAULT_PORT = 8787


def app_data_dir() -> Path:
    root = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(root) / "SafeNex" / "VisionEdge"


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


def wait_and_open(url: str) -> None:
    for _ in range(30):
        try:
            with urllib.request.urlopen(f"{url}/healthz", timeout=0.8) as response:
                if response.status == 200:
                    webbrowser.open(url, new=1)
                    return
        except OSError:
            time.sleep(0.5)


def main() -> None:
    data_dir = app_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    config_path = data_dir / "vision-edge.json"
    config = load_config(config_path) if config_path.exists() else create_default_config(config_path)

    if "--print-config" in sys.argv:
        print(json.dumps({"config_path": str(config_path), "ui_url": f"http://127.0.0.1:{config.listen_port}"}))
        return

    log_path = data_dir / "vision-edge.log"
    logging.basicConfig(
        filename=log_path,
        encoding="utf-8",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    ui_url = f"http://127.0.0.1:{config.listen_port}"
    threading.Thread(target=wait_and_open, args=(ui_url,), daemon=True).start()
    uvicorn.run(
        create_app(config, config_path),
        host=config.listen_host,
        port=config.listen_port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
