"""현장 NVR·카메라 credential을 암호화해 저장하는 로컬 비밀 저장소."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


class SecretStoreError(RuntimeError):
    """비밀 저장소 접근 또는 무결성 검증 실패."""


class SecretStore:
    """Fernet 기반의 작은 파일형 비밀 저장소.

    운영 환경에서는 ``VISION_EDGE_MASTER_KEY``를 systemd credential 또는 TPM/HSM에서
    주입해야 한다. 개발 환경에서만 명시적으로 허용된 경우 로컬 키를 생성한다.
    """

    def __init__(self, state_dir: Path, allow_local_key_generation: bool = False) -> None:
        self._secret_dir = state_dir / "secrets"
        self._secret_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self._secret_dir, 0o700)
        self._key_path = self._secret_dir / "master.key"
        self._store_path = self._secret_dir / "secrets.enc"
        self._fernet = Fernet(self._load_key(allow_local_key_generation))

    def _load_key(self, allow_local_key_generation: bool) -> bytes:
        environment_key = os.getenv("VISION_EDGE_MASTER_KEY")
        if environment_key:
            return self._validate_key(environment_key.encode("utf-8"))

        if self._key_path.exists():
            return self._validate_key(self._key_path.read_bytes().strip())

        if not allow_local_key_generation:
            raise SecretStoreError(
                "VISION_EDGE_MASTER_KEY is required. Generate a key through the installation workflow "
                "or enable local generation only for development."
            )

        key = Fernet.generate_key()
        self._write_private_file(self._key_path, key)
        return key

    @staticmethod
    def _validate_key(key: bytes) -> bytes:
        try:
            decoded = base64.urlsafe_b64decode(key)
        except Exception as exc:  # pragma: no cover - library-specific base64 error types
            raise SecretStoreError("master key must be a URL-safe base64 Fernet key") from exc
        if len(decoded) != 32:
            raise SecretStoreError("master key has an invalid length")
        return key

    @staticmethod
    def _write_private_file(path: Path, value: bytes) -> None:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        descriptor = os.open(path, flags, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
        os.chmod(path, 0o600)

    def _read_all(self) -> dict[str, str]:
        if not self._store_path.exists():
            return {}
        try:
            plaintext = self._fernet.decrypt(self._store_path.read_bytes())
            parsed = json.loads(plaintext.decode("utf-8"))
        except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SecretStoreError("encrypted secret store cannot be decrypted or is malformed") from exc
        if not isinstance(parsed, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
            raise SecretStoreError("encrypted secret store has an invalid shape")
        return parsed

    def _write_all(self, values: dict[str, str]) -> None:
        serialized = json.dumps(values, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ciphertext = self._fernet.encrypt(serialized)
        temporary = self._store_path.with_suffix(".tmp")
        self._write_private_file(temporary, ciphertext)
        os.replace(temporary, self._store_path)
        os.chmod(self._store_path, 0o600)

    def put(self, reference: str, secret: str) -> None:
        if not reference or not secret:
            raise SecretStoreError("secret reference and value must not be empty")
        values = self._read_all()
        values[reference] = secret
        self._write_all(values)

    def get(self, reference: str) -> str:
        values = self._read_all()
        try:
            return values[reference]
        except KeyError as exc:
            raise SecretStoreError(f"secret reference not found: {reference}") from exc

    def delete(self, reference: str) -> None:
        values = self._read_all()
        if reference in values:
            del values[reference]
            self._write_all(values)

    def references(self) -> list[str]:
        return sorted(self._read_all().keys())

    def health(self) -> dict[str, Any]:
        return {"encrypted": True, "reference_count": len(self.references())}
