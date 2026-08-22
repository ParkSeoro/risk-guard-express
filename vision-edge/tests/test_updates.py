from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from vision_edge.models import UpdateChannel, UpdateManifest, UpdateState, WanProfile
from vision_edge.security import canonical_json
from vision_edge.updates import UpdateManifestVerifier


def signed_manifest(private_key: Ed25519PrivateKey, **overrides: object) -> UpdateManifest:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "release_id": "ve-0.4.0-win-x64",
        "version": "0.4.0",
        "channel": "production",
        "platform": "windows-x64",
        "installer_url": "https://releases.safenex.example/vision-edge/0.4.0/setup.exe",
        "sha256": "a" * 64,
        "size_bytes": 24_000_000,
        "published_at": now.isoformat(),
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "signature": "x" * 64,
    }
    payload.update(overrides)
    unsigned = UpdateManifest.model_validate(payload)
    signature = base64.urlsafe_b64encode(
        private_key.sign(canonical_json(unsigned.model_dump(mode="json", exclude={"signature"})))
    ).decode("ascii").rstrip("=")
    return unsigned.model_copy(update={"signature": signature})


def verifier(tmp_path: Path, private_key: Ed25519PrivateKey, *, wan_profile: WanProfile = WanProfile.HYBRID) -> UpdateManifestVerifier:
    key_path = tmp_path / "update-public.pem"
    key_path.write_bytes(
        private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return UpdateManifestVerifier(
        public_key_path=key_path,
        current_version="0.3.0",
        platform="windows-x64",
        channel=UpdateChannel.PRODUCTION.value,
        wan_profile=wan_profile,
    )


def test_signed_update_manifest_is_available(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    decision = verifier(tmp_path, private_key).verify(signed_manifest(private_key))
    assert decision.state is UpdateState.AVAILABLE
    assert decision.version == "0.4.0"


def test_tampered_or_downgrade_update_is_rejected(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    verified = signed_manifest(private_key)
    tampered = verified.model_copy(update={"sha256": "b" * 64})
    assert verifier(tmp_path, private_key).verify(tampered).state is UpdateState.REJECTED_SIGNATURE

    downgrade = signed_manifest(private_key, version="0.2.0", release_id="ve-0.2.0-win-x64")
    assert verifier(tmp_path, private_key).verify(downgrade).state is UpdateState.REJECTED_ROLLBACK


def test_non_critical_update_is_held_on_metered_cellular(tmp_path: Path) -> None:
    private_key = Ed25519PrivateKey.generate()
    decision = verifier(tmp_path, private_key, wan_profile=WanProfile.CELLULAR_METERED).verify(
        signed_manifest(private_key)
    )
    assert decision.state is UpdateState.BLOCKED_METERED
