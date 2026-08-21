"""SafeNex Vision Edge 명령행 진입점."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app
from .config import ConfigurationError, load_config, write_example_config


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(prog="vision-edge", description="SafeNex 현장 NVR·AI CCTV Gateway")
    command.add_argument("--config", default="./config/vision-edge.json", help="Gateway JSON configuration path")
    subcommands = command.add_subparsers(dest="command", required=True)
    initialize = subcommands.add_parser("init", help="safe example configuration 생성")
    initialize.add_argument("--state-dir", default="./data", help="Gateway runtime state directory")
    run = subcommands.add_parser("run", help="Gateway local API와 background runtime 실행")
    run.add_argument("--host", help="local API bind host override")
    run.add_argument("--port", type=int, help="local API port override")
    subcommands.add_parser("validate", help="configuration 검증")
    secret_set = subcommands.add_parser("secret-set", help="stdin으로 전달한 비밀값을 암호화 local store에 저장")
    secret_set.add_argument("--reference", required=True, help="configuration에서 참조할 secret key")
    return command


def main() -> None:
    args = parser().parse_args()
    config_path = Path(args.config).expanduser().resolve()

    if args.command == "init":
        if config_path.exists():
            raise SystemExit(f"refusing to overwrite existing config: {config_path}")
        write_example_config(config_path, Path(args.state_dir).expanduser().resolve())
        print(f"example configuration written: {config_path}")
        print("next: configure Fleet URLs, certificate paths and use `vision-edge run`")
        return

    try:
        config = load_config(config_path)
    except ConfigurationError as exc:
        raise SystemExit(str(exc)) from exc

    if args.command == "validate":
        print(f"configuration valid for gateway {config.identity.gateway_id} at site {config.identity.site_id}")
        return

    if args.command == "secret-set":
        import sys

        from .secret_store import SecretStore

        secret_value = sys.stdin.read().strip()
        if not secret_value:
            raise SystemExit("secret value must be supplied through stdin; do not pass it in a command-line argument")
        store = SecretStore(
            Path(config.state_dir).expanduser().resolve(),
            allow_local_key_generation=os.getenv("VISION_EDGE_DEVELOPMENT") == "1",
        )
        store.put(args.reference, secret_value)
        print(f"secret reference stored: {args.reference}")
        return

    host = args.host or config.listen_host
    port = args.port or config.listen_port
    if host not in {"127.0.0.1", "::1", "localhost"} and not os.getenv("VISION_EDGE_LOCAL_ADMIN_KEY"):
        raise SystemExit("VISION_EDGE_LOCAL_ADMIN_KEY is required when binding outside loopback")
    app = create_app(config, config_path)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
