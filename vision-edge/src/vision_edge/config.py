"""Gateway 구성 파일의 로드와 안전한 초기화."""

from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import ValidationError

from .models import GatewayIdentity, LocalConfig


class ConfigurationError(RuntimeError):
    """구성이 존재하지 않거나 스키마에 맞지 않는 경우 발생한다."""


def load_config(path: Path) -> LocalConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ConfigurationError(f"configuration file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigurationError(f"configuration file is not valid JSON: {path}") from exc

    try:
        return LocalConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigurationError(f"configuration validation failed: {exc}") from exc


def save_config(path: Path, config: LocalConfig) -> None:
    """구성을 원자적으로 저장한다. 비밀값은 이 파일에 포함하지 않는다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(config.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def write_example_config(path: Path, state_dir: Path) -> None:
    """비밀과 실제 RTSP URL을 포함하지 않는 안전한 샘플 구성을 작성한다."""

    example = LocalConfig(
        identity=GatewayIdentity(
            gateway_id="gateway-demo-001",
            tenant_id="tenant-demo",
            site_id="site-demo",
        ),
        state_dir=str(state_dir),
    )
    save_config(path, example)
