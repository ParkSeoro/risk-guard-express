"""SafeNex Vision Edge의 서명된 release manifest 검증기.

이 모듈은 업데이트 다운로드·설치를 수행하지 않는다. 먼저 서명, freshness,
platform, hash metadata와 현장 WAN 정책을 검증해 안전한 target만 다음 단계로 넘긴다.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .models import UpdateManifest, UpdateState, WanProfile
from .security import VerificationError, canonical_json


@dataclass(frozen=True)
class UpdateDecision:
    state: UpdateState
    detail: str
    release_id: str | None = None
    version: str | None = None


class UpdateManifestVerifier:
    """Pinned release key로 업데이트 metadata만 신뢰하는 fail-closed verifier."""

    def __init__(
        self,
        *,
        public_key_path: Path | None,
        current_version: str,
        platform: str,
        channel: str,
        wan_profile: WanProfile,
    ) -> None:
        self._public_key = self._load_public_key(public_key_path) if public_key_path else None
        self._current_version = current_version
        self._platform = platform
        self._channel = channel
        self._wan_profile = wan_profile

    @staticmethod
    def _load_public_key(path: Path) -> Ed25519PublicKey:
        try:
            key = serialization.load_pem_public_key(path.read_bytes())
        except (OSError, ValueError) as exc:
            raise VerificationError(f"cannot load update public key: {path}") from exc
        if not isinstance(key, Ed25519PublicKey):
            raise VerificationError("update public key must be Ed25519")
        return key

    @staticmethod
    def _decode_signature(value: str) -> bytes:
        padded = value + "=" * (-len(value) % 4)
        try:
            return base64.urlsafe_b64decode(padded.encode("ascii"))
        except Exception as exc:  # pragma: no cover - implementation dependent parser details
            raise VerificationError("update signature is not valid base64url") from exc

    @staticmethod
    def _version_key(value: str) -> tuple[int, int, int]:
        try:
            core = value.split("+", 1)[0].split("-", 1)[0]
            major, minor, patch = core.split(".", 2)
            return int(major), int(minor), int(patch)
        except ValueError as exc:  # pragma: no cover - pydantic checks the public shape
            raise VerificationError("update version is invalid") from exc

    def verify(self, manifest: UpdateManifest, *, now: datetime | None = None) -> UpdateDecision:
        checked_at = now or datetime.now(UTC)
        if not self._public_key:
            return UpdateDecision(UpdateState.REJECTED_SIGNATURE, "update trust root is not configured")
        if manifest.expires_at <= checked_at or manifest.published_at > checked_at:
            return UpdateDecision(UpdateState.REJECTED_STALE, "manifest is expired or not yet valid")
        if manifest.platform != self._platform or manifest.channel != self._channel:
            return UpdateDecision(UpdateState.REJECTED_SIGNATURE, "manifest platform or channel is not approved")
        if manifest.installer_url.scheme != "https":
            return UpdateDecision(UpdateState.REJECTED_SIGNATURE, "installer URL must use HTTPS")
        payload = manifest.model_dump(mode="json", exclude={"signature"})
        try:
            self._public_key.verify(self._decode_signature(manifest.signature), canonical_json(payload))
        except InvalidSignature:
            return UpdateDecision(UpdateState.REJECTED_SIGNATURE, "manifest signature is invalid")
        if self._version_key(manifest.version) < self._version_key(self._current_version):
            return UpdateDecision(UpdateState.REJECTED_ROLLBACK, "manifest would downgrade the Gateway")
        if self._version_key(manifest.version) == self._version_key(self._current_version):
            return UpdateDecision(UpdateState.UP_TO_DATE, "Gateway already has this release", manifest.release_id, manifest.version)
        if self._wan_profile is WanProfile.CELLULAR_METERED and not manifest.security_critical:
            return UpdateDecision(
                UpdateState.BLOCKED_METERED,
                "non-critical download is held on metered cellular uplink",
                manifest.release_id,
                manifest.version,
            )
        return UpdateDecision(UpdateState.AVAILABLE, "verified update is available", manifest.release_id, manifest.version)
