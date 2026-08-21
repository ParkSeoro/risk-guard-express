from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from vision_edge.models import GatewayCommand, GatewayIdentity, RiskLevel
from vision_edge.security import MasterCommandVerifier, VerificationError, canonical_json


def sign_command(private_key: Ed25519PrivateKey, command: GatewayCommand) -> GatewayCommand:
    payload = command.model_dump(mode="json", exclude={"signature"})
    signature = private_key.sign(canonical_json(payload))
    return command.model_copy(update={"signature": base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")})


def make_command(**changes: object) -> GatewayCommand:
    now = datetime.now(UTC)
    base = {
        "command_id": uuid4(),
        "command_type": "diagnostic.collect",
        "target_tenant_id": "tenant-1",
        "target_site_id": "site-1",
        "target_gateway_id": "gw-1",
        "risk_level": RiskLevel.GREEN,
        "issued_at": now,
        "expires_at": now + timedelta(minutes=5),
        "idempotency_key": uuid4(),
        "payload_digest": "a" * 64,
        "payload": {},
        "approval_refs": [],
        "signature": "placeholder",
        "key_id": "master-key-1",
    }
    base.update(changes)
    return GatewayCommand.model_validate(base)


def verifier(tmp_path: Path) -> tuple[MasterCommandVerifier, Ed25519PrivateKey]:
    private_key = Ed25519PrivateKey.generate()
    public_path = tmp_path / "master-public.pem"
    public_path.write_bytes(
        private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return MasterCommandVerifier(GatewayIdentity(gateway_id="gw-1", tenant_id="tenant-1", site_id="site-1"), public_path), private_key


def test_valid_signed_command_is_accepted(tmp_path: Path) -> None:
    command_verifier, private_key = verifier(tmp_path)
    command_verifier.verify(sign_command(private_key, make_command()))


def test_command_for_another_site_is_rejected(tmp_path: Path) -> None:
    command_verifier, private_key = verifier(tmp_path)
    command = sign_command(private_key, make_command(target_site_id="site-other"))
    with pytest.raises(VerificationError, match="tenant or site"):
        command_verifier.verify(command)


def test_red_command_needs_approval_reference(tmp_path: Path) -> None:
    command_verifier, private_key = verifier(tmp_path)
    command = sign_command(
        private_key,
        make_command(command_type="model.activate", risk_level=RiskLevel.RED, approval_refs=[]),
    )
    with pytest.raises(VerificationError, match="approval"):
        command_verifier.verify(command)
