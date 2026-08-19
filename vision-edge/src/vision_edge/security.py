"""정책·명령의 canonical payload 및 Ed25519 서명 검증."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .models import GatewayCommand, GatewayIdentity, RiskLevel


class VerificationError(RuntimeError):
    pass


def canonical_json(value: dict[str, Any]) -> bytes:
    """서명 대상의 JSON 직렬화를 환경과 무관하게 고정한다."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _b64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except Exception as exc:  # pragma: no cover - exact base64 errors vary
        raise VerificationError("signature is not valid base64url") from exc


class MasterCommandVerifier:
    """Pinned Master Ed25519 public key로 위험 명령을 fail-closed 검증한다."""

    _RISK_REQUIREMENTS: dict[str, RiskLevel] = {
        "diagnostic.collect": RiskLevel.GREEN,
        "camera.test_connection": RiskLevel.GREEN,
        "policy.apply": RiskLevel.YELLOW,
        "runtime.restart": RiskLevel.YELLOW,
        "model.stage": RiskLevel.YELLOW,
        "model.activate": RiskLevel.RED,
        "alarm.test": RiskLevel.RED,
    }

    def __init__(self, identity: GatewayIdentity, public_key_path: Path | None) -> None:
        self._identity = identity
        self._public_key = self._load_public_key(public_key_path) if public_key_path else None

    @staticmethod
    def _load_public_key(path: Path) -> Ed25519PublicKey:
        try:
            key = serialization.load_pem_public_key(path.read_bytes())
        except (OSError, ValueError) as exc:
            raise VerificationError(f"cannot load master public key: {path}") from exc
        if not isinstance(key, Ed25519PublicKey):
            raise VerificationError("master public key must be Ed25519")
        return key

    def verify(self, command: GatewayCommand) -> None:
        if not self._public_key:
            raise VerificationError("master public key is not configured; command execution is disabled")
        if command.target_gateway_id != self._identity.gateway_id:
            raise VerificationError("command target gateway does not match local identity")
        if command.target_tenant_id != self._identity.tenant_id or command.target_site_id != self._identity.site_id:
            raise VerificationError("command tenant or site does not match local identity")
        if command.expires_at <= datetime.now(UTC):
            raise VerificationError("command is expired")
        required_risk = self._RISK_REQUIREMENTS.get(command.command_type)
        if not required_risk or required_risk != command.risk_level:
            raise VerificationError("command risk level does not match allowlist")
        if command.risk_level is RiskLevel.RED and not command.approval_refs:
            raise VerificationError("red command requires approval references")

        signed_payload = command.model_dump(mode="json", exclude={"signature"})
        try:
            self._public_key.verify(_b64url_decode(command.signature), canonical_json(signed_payload))
        except InvalidSignature as exc:
            raise VerificationError("command signature is invalid") from exc

    def verify_desired_state_signature(self, payload: dict[str, Any], signature: str) -> None:
        if not self._public_key:
            raise VerificationError("master public key is not configured; state activation is disabled")
        try:
            self._public_key.verify(_b64url_decode(signature), canonical_json(payload))
        except InvalidSignature as exc:
            raise VerificationError("desired state signature is invalid") from exc
