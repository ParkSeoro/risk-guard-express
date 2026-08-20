"""Vision Edge의 현장 로컬 운영 API 및 상태 화면."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import getnode, uuid4

import httpx
import qrcode  # type: ignore[import-untyped]
import qrcode.image.svg  # type: ignore[import-untyped]
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl, TypeAdapter

from .ai import Detection
from .config import save_config
from .fleet_client import FleetClient
from .models import CameraConfig, LocalConfig, NvrConfig, UpdateManifest
from .nvr import CameraMonitor, FfprobeStreamProbe, MjpegPreview, OnvifDiscoverer
from .runtime import EdgeRuntime
from .secret_store import SecretStore
from .security import MasterCommandVerifier
from .storage import EdgeStore
from .updates import UpdateManifestVerifier


class DetectionTestRequest(BaseModel):
    camera_id: str = Field(min_length=3, max_length=128)
    track_id: str = Field(default="test-person", min_length=1, max_length=128)
    labels: list[str] = Field(min_length=1, max_length=10)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    restricted_zone: bool = False


class NvrSetupRequest(BaseModel):
    nvr_id: str = Field(min_length=3, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    vendor: str = Field(default="generic-onvif", min_length=1, max_length=128)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=554, ge=1, le=65535)


class FleetPairRequest(BaseModel):
    fleet_base_url: str = Field(min_length=10, max_length=2048, pattern=r"^https://")
    pairing_code: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    device_name: str = Field(min_length=2, max_length=120)


class CameraSetupRequest(BaseModel):
    camera_id: str = Field(min_length=3, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    nvr_id: str = Field(min_length=3, max_length=128)
    stream_url: str = Field(min_length=8, max_length=2048)
    expected_fps: float = Field(default=10.0, ge=0.1, le=120.0)
    ai_profile: str = Field(default="ppe-standard-kr-v1", min_length=3, max_length=128)


class QrOnboardingStartRequest(BaseModel):
    fleet_base_url: str | None = Field(default=None, max_length=2048, pattern=r"^https://")
    device_name: str | None = Field(default=None, min_length=2, max_length=120)


class BootstrapKitClaimRequest(BaseModel):
    kit: str = Field(min_length=20, max_length=16_384)
    device_name: str | None = Field(default=None, min_length=2, max_length=120)


class OnvifDiscoveryRequest(BaseModel):
    timeout_seconds: int = Field(default=3, ge=1, le=8)


def build_runtime(config: LocalConfig) -> EdgeRuntime:
    state_dir = Path(config.state_dir).expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    allow_dev_key = os.getenv("VISION_EDGE_DEVELOPMENT") == "1"
    allow_local_key = allow_dev_key or config.allow_local_key_generation
    secret_store = SecretStore(state_dir, allow_local_key_generation=allow_local_key)
    store = EdgeStore(state_dir / "edge.db")
    camera_monitor = CameraMonitor(secret_store, FfprobeStreamProbe(), config.ffprobe_timeout_seconds)
    fleet_client = FleetClient(
        base_url=str(config.identity.fleet_base_url) if config.identity.fleet_base_url else None,
        gateway_id=config.identity.gateway_id,
        certificate_path=config.certificate_path,
        private_key_path=config.private_key_path,
        ca_bundle_path=config.ca_bundle_path,
        token_url=str(config.fleet_token_url) if config.fleet_token_url else None,
        client_id=config.fleet_client_id,
    )
    verifier = MasterCommandVerifier(
        config.identity,
        Path(config.master_public_key_path).expanduser() if config.master_public_key_path else None,
    )
    return EdgeRuntime(
        config=config,
        store=store,
        secret_store=secret_store,
        camera_monitor=camera_monitor,
        fleet_client=fleet_client,
        verifier=verifier,
    )


def create_app(config: LocalConfig, config_path: Path | None = None) -> FastAPI:
    runtime = build_runtime(config)
    background_task: asyncio.Task[None] | None = None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        nonlocal background_task
        await runtime.refresh_camera_health()
        background_task = asyncio.create_task(runtime.background_loop(), name="vision-edge-background-loop")
        try:
            yield
        finally:
            runtime.stop()
            if background_task:
                await background_task
            await runtime.fleet_client.close()
            runtime.store.close()

    app = FastAPI(
        title="SafeNex Vision Edge",
        version="0.3.0",
        description="현장 NVR·AI CCTV의 보안 Edge Gateway",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
    )
    app.state.runtime = runtime

    static_dir = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    def local_admin_guard(request: Request) -> None:
        configured_key = os.getenv("VISION_EDGE_LOCAL_ADMIN_KEY")
        if configured_key and request.headers.get("X-Local-Admin-Key") != configured_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="local admin key is required")
        # A missing admin key is allowed only when the service is bound to loopback by config default.
        if not configured_key and config.listen_host not in {"127.0.0.1", "::1", "localhost"}:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="VISION_EDGE_LOCAL_ADMIN_KEY is required for non-loopback listening",
            )

    def persist_local_config() -> None:
        if config_path is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="configuration path is unavailable in this runtime",
            )
        save_config(config_path, config)

    def ensure_unpaired() -> None:
        if config.fleet_token_url or config.identity.fleet_base_url:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="gateway is already paired; unpair through SafeNex administrator workflow",
            )

    def device_fingerprint() -> str:
        source = f"{getnode()}:{socket.gethostname()}:{config.state_dir}".encode()
        return hashlib.sha256(source).hexdigest()[:32]

    def build_enrollment_csr() -> tuple[str, str]:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        private_pem = private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("utf-8")
        csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"vision-edge-{device_fingerprint()}-{uuid4()}")]))
            .sign(private_key, hashes.SHA256())
        )
        return private_pem, csr.public_bytes(serialization.Encoding.PEM).decode("utf-8")

    async def persist_enrollment(fleet_base_url: str, private_pem: str, enrollment: object) -> dict[str, str]:
        required = {
            "gateway_id",
            "tenant_id",
            "site_id",
            "token_url",
            "client_id",
            "client_certificate_pem",
            "ca_bundle_pem",
            "master_public_key_pem",
        }
        if not isinstance(enrollment, dict) or not required.issubset(enrollment):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="SafeNex enrollment response is incomplete")
        values = {key: enrollment[key] for key in required}
        if not all(isinstance(value, str) and value for value in values.values()):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="SafeNex enrollment response is invalid")

        state_dir = Path(config.state_dir).expanduser().resolve()
        credential_dir = state_dir / "credentials"
        credential_dir.mkdir(parents=True, exist_ok=True)
        private_key_path = credential_dir / "gateway-client.key"
        certificate_path = credential_dir / "gateway-client.crt"
        ca_bundle_path = credential_dir / "fleet-ca.pem"
        master_key_path = credential_dir / "master-ed25519-public.pem"
        for path, content, mode in (
            (private_key_path, private_pem, 0o600),
            (certificate_path, values["client_certificate_pem"], 0o644),
            (ca_bundle_path, values["ca_bundle_pem"], 0o644),
            (master_key_path, values["master_public_key_pem"], 0o644),
        ):
            path.write_text(content, encoding="utf-8")
            os.chmod(path, mode)

        fleet_url = TypeAdapter(HttpUrl).validate_python(fleet_base_url)
        config.identity.gateway_id = values["gateway_id"]
        config.identity.tenant_id = values["tenant_id"]
        config.identity.site_id = values["site_id"]
        config.identity.fleet_base_url = fleet_url
        config.enrollment_fleet_url = fleet_url
        config.certificate_path = str(certificate_path)
        config.private_key_path = str(private_key_path)
        config.ca_bundle_path = str(ca_bundle_path)
        config.fleet_token_url = values["token_url"]
        config.fleet_client_id = values["client_id"]
        config.master_public_key_path = str(master_key_path)
        persist_local_config()
        await runtime.reconfigure_fleet()
        return {
            "gateway_id": config.identity.gateway_id,
            "site_id": config.identity.site_id,
            "status": "paired",
            "fleet_base_url": str(config.identity.fleet_base_url),
        }

    @app.post("/api/v1/setup/fleet/pair", tags=["setup"], dependencies=[Depends(local_admin_guard)])
    async def pair_with_fleet(payload: FleetPairRequest) -> dict[str, str]:
        ensure_unpaired()
        private_pem, csr_pem = build_enrollment_csr()
        claim_url = f"{payload.fleet_base_url.rstrip('/')}/v1/gateway-pairings/claim"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=8.0, read=20.0, write=20.0, pool=8.0)) as client:
                response = await client.post(
                    claim_url,
                    json={
                        "pairing_code": payload.pairing_code,
                        "device_name": payload.device_name,
                        "csr_pem": csr_pem,
                        "requested_at": datetime.now(UTC).isoformat(),
                        "device_fingerprint": device_fingerprint(),
                    },
                )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"SafeNex pairing request failed: {exc}") from exc
        if response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"SafeNex pairing rejected: {response.status_code}",
            )
        return await persist_enrollment(payload.fleet_base_url, private_pem, response.json())

    onboarding_session: dict[str, Any] | None = None

    def enrollment_url(requested_url: str | None) -> str:
        configured = str(config.enrollment_fleet_url) if config.enrollment_fleet_url else None
        fleet_url = requested_url or configured
        if not fleet_url:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Fleet onboarding URL is not configured; install a SafeNex provisioning kit or enter the Fleet URL once",
            )
        TypeAdapter(HttpUrl).validate_python(fleet_url)
        return fleet_url.rstrip("/")

    def qr_data_uri(verification_uri: str) -> str:
        image = qrcode.make(verification_uri, image_factory=qrcode.image.svg.SvgPathImage)
        buffer = io.BytesIO()
        image.save(buffer)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/svg+xml;base64,{encoded}"

    @app.post("/api/v1/setup/onboarding/qr/start", tags=["onboarding"], dependencies=[Depends(local_admin_guard)])
    async def start_qr_onboarding(payload: QrOnboardingStartRequest) -> dict[str, object]:
        nonlocal onboarding_session
        ensure_unpaired()
        fleet_url = enrollment_url(payload.fleet_base_url)
        device_name = payload.device_name or socket.gethostname()
        private_pem, csr_pem = build_enrollment_csr()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=8.0, read=20.0, write=20.0, pool=8.0)) as client:
                response = await client.post(
                    f"{fleet_url}/v1/gateway-device-authorizations",
                    json={
                        "device_name": device_name,
                        "device_fingerprint": device_fingerprint(),
                        "csr_pem": csr_pem,
                        "requested_at": datetime.now(UTC).isoformat(),
                    },
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"SafeNex QR onboarding request failed: {exc}",
            ) from exc
        if response.status_code >= 400:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SafeNex QR onboarding was rejected")
        authorization = response.json()
        required = {"authorization_id", "user_code", "verification_uri", "expires_in", "interval"}
        if not isinstance(authorization, dict) or not required.issubset(authorization):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="SafeNex QR onboarding response is invalid")
        if not all(isinstance(authorization[key], (str, int)) for key in required):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="SafeNex QR onboarding response is invalid")
        expires_in = authorization["expires_in"]
        interval = authorization["interval"]
        if not isinstance(expires_in, int) or not isinstance(interval, int) or expires_in < 30 or interval < 3:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="SafeNex QR onboarding timing is invalid")
        verification_uri = authorization.get("verification_uri_complete", authorization["verification_uri"])
        if not isinstance(verification_uri, str) or not verification_uri.startswith("https://"):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="SafeNex verification URL is invalid")
        expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
        onboarding_session = {
            "authorization_id": authorization["authorization_id"],
            "fleet_url": fleet_url,
            "private_pem": private_pem,
            "device_name": device_name,
            "expires_at": expires_at,
            "interval_seconds": interval,
            "status": "approval_pending",
        }
        return {
            "status": "approval_pending",
            "authorization_id": authorization["authorization_id"],
            "user_code": authorization["user_code"],
            "verification_uri": authorization["verification_uri"],
            "qr_svg_data_uri": qr_data_uri(verification_uri),
            "expires_at": expires_at.isoformat(),
            "poll_after_seconds": interval,
            "device_fingerprint": device_fingerprint(),
        }

    @app.get("/api/v1/setup/onboarding/status", tags=["onboarding"], dependencies=[Depends(local_admin_guard)])
    async def qr_onboarding_status() -> dict[str, object]:
        nonlocal onboarding_session
        if onboarding_session is None:
            return {"status": "not_started"}
        expires_at = onboarding_session["expires_at"]
        if not isinstance(expires_at, datetime) or datetime.now(UTC) >= expires_at:
            onboarding_session = None
            return {"status": "expired"}
        if onboarding_session["status"] == "paired":
            return {"status": "paired", "gateway_id": config.identity.gateway_id, "site_id": config.identity.site_id}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=8.0, read=20.0, write=20.0, pool=8.0)) as client:
                response = await client.post(
                    f"{onboarding_session['fleet_url']}/v1/gateway-device-authorizations/{onboarding_session['authorization_id']}/poll",
                    json={"device_fingerprint": device_fingerprint()},
                )
        except httpx.HTTPError:
            return {"status": "approval_pending", "retryable": True, "expires_at": expires_at.isoformat()}
        if response.status_code == status.HTTP_202_ACCEPTED:
            return {"status": "approval_pending", "expires_at": expires_at.isoformat()}
        if response.status_code >= 400:
            onboarding_session = None
            return {"status": "rejected"}
        result = await persist_enrollment(
            str(onboarding_session["fleet_url"]),
            str(onboarding_session["private_pem"]),
            response.json(),
        )
        onboarding_session["status"] = "paired"
        return {key: value for key, value in result.items()}

    @app.post("/api/v1/setup/onboarding/kit/claim", tags=["onboarding"], dependencies=[Depends(local_admin_guard)])
    async def claim_bootstrap_kit(payload: BootstrapKitClaimRequest) -> dict[str, str]:
        ensure_unpaired()
        try:
            encoded_payload = payload.kit.split(".", 1)[0]
            padded = encoded_payload + "=" * (-len(encoded_payload) % 4)
            kit_body = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
            fleet_url = enrollment_url(kit_body["fleet_base_url"])
            bootstrap_token = kit_body["bootstrap_token"]
            if not isinstance(bootstrap_token, str) or len(bootstrap_token) < 16:
                raise ValueError("invalid bootstrap token")
        except (KeyError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="provisioning kit format is invalid") from exc
        private_pem, csr_pem = build_enrollment_csr()
        device_name = payload.device_name or socket.gethostname()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=8.0, read=20.0, write=20.0, pool=8.0)) as client:
                response = await client.post(
                    f"{fleet_url}/v1/gateway-bootstrap/claim",
                    json={
                        "kit": payload.kit,
                        "device_name": device_name,
                        "device_fingerprint": device_fingerprint(),
                        "csr_pem": csr_pem,
                        "requested_at": datetime.now(UTC).isoformat(),
                    },
                )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"SafeNex kit claim failed: {exc}") from exc
        if response.status_code >= 400:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SafeNex provisioning kit was rejected")
        return await persist_enrollment(fleet_url, private_pem, response.json())

    @app.post("/api/v1/setup/discovery/onvif", tags=["onboarding"], dependencies=[Depends(local_admin_guard)])
    async def discover_onvif(payload: OnvifDiscoveryRequest) -> dict[str, object]:
        candidates = await asyncio.to_thread(OnvifDiscoverer().discover, payload.timeout_seconds)
        return {
            "scope": "local-lan-only",
            "candidates": [candidate.as_dict() for candidate in candidates],
            "next_step": "select a discovered NVR and enter its administrator credential once to enumerate camera profiles",
        }

    @app.post("/api/v1/setup/nvrs", tags=["setup"], dependencies=[Depends(local_admin_guard)])
    async def register_nvr(payload: NvrSetupRequest) -> dict[str, object]:
        if any(item.nvr_id == payload.nvr_id for item in config.nvrs):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="nvr_id already exists")
        nvr = NvrConfig(
            nvr_id=payload.nvr_id,
            name=payload.name,
            vendor=payload.vendor,
            host=payload.host,
            port=payload.port,
            read_only=True,
        )
        config.nvrs.append(nvr)
        persist_local_config()
        return {"nvr": nvr.model_dump(), "read_only": True}

    @app.post("/api/v1/setup/cameras", tags=["setup"], dependencies=[Depends(local_admin_guard)])
    async def register_camera(payload: CameraSetupRequest) -> dict[str, object]:
        if not any(item.nvr_id == payload.nvr_id for item in config.nvrs):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="referenced NVR is not registered")
        if any(item.camera_id == payload.camera_id for item in config.cameras):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="camera_id already exists")
        if not payload.stream_url.startswith(("rtsp://", "rtsps://")):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="only RTSP/RTSPS URLs are supported")
        secret_ref = f"camera:{payload.camera_id}:stream"
        runtime.secret_store.put(secret_ref, payload.stream_url)
        camera = CameraConfig(
            camera_id=payload.camera_id,
            name=payload.name,
            nvr_id=payload.nvr_id,
            stream_url_secret_ref=secret_ref,
            expected_fps=payload.expected_fps,
            ai_profile=payload.ai_profile,
        )
        config.cameras.append(camera)
        persist_local_config()
        return {"camera": camera.model_dump(), "stream_url_stored": "encrypted-local-store"}

    @app.get("/", include_in_schema=False)
    async def dashboard() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    @app.get("/healthz", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/nvrs", tags=["operations"])
    async def nvrs() -> dict[str, object]:
        return {"nvrs": [item.model_dump() for item in config.nvrs]}

    @app.get("/api/v1/cameras", tags=["operations"])
    async def cameras() -> dict[str, object]:
        raw_health = runtime.status().get("camera_health", [])
        health_by_id = {
            str(item.get("camera_id")): item
            for item in raw_health
            if isinstance(item, dict) and isinstance(item.get("camera_id"), str)
        }
        items: list[dict[str, object]] = []
        for camera in config.cameras:
            health = health_by_id.get(camera.camera_id)
            items.append(
                {
                    "camera_id": camera.camera_id,
                    "name": camera.name,
                    "nvr_id": camera.nvr_id,
                    "enabled": camera.enabled,
                    "ai_profile": camera.ai_profile,
                    "state": health.get("state", "unknown") if isinstance(health, dict) else "unknown",
                    "observed_fps": health.get("observed_fps") if isinstance(health, dict) else None,
                    "detail": health.get("detail") if isinstance(health, dict) else None,
                    "live_preview_url": f"/api/v1/cameras/{camera.camera_id}/live.mjpeg",
                }
            )
        return {"cameras": items, "max_local_previews": 4}

    @app.get("/api/v1/cameras/{camera_id}/live.mjpeg", tags=["operations"])
    async def live_preview(camera_id: str) -> StreamingResponse:
        if config.listen_host not in {"127.0.0.1", "::1", "localhost"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="live preview requires loopback binding")
        camera = next((item for item in config.cameras if item.camera_id == camera_id and item.enabled), None)
        if not camera:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="enabled camera not found")
        preview = MjpegPreview(runtime.secret_store, config.ffprobe_timeout_seconds)
        return StreamingResponse(
            preview.stream(camera),
            media_type="multipart/x-mixed-replace; boundary=safenex",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @app.get("/api/v1/status", tags=["operations"])
    async def gateway_status() -> dict[str, object]:
        return runtime.status()

    @app.get("/api/v1/updates/status", tags=["operations"])
    async def update_status() -> dict[str, object]:
        return {
            "current_version": "0.3.0",
            "channel": config.update_channel.value,
            "check_interval_seconds": config.update_check_interval_seconds,
            "wan_profile": config.wan_profile.value,
            "state": runtime.store.get_runtime_value("update_state") or "up_to_date",
            "detail": runtime.store.get_runtime_value("update_detail") or "no verified update manifest has been received",
            "release_id": runtime.store.get_runtime_value("update_release_id"),
            "available_version": runtime.store.get_runtime_value("update_available_version"),
        }

    @app.post("/api/v1/updates/verify", tags=["operations"], dependencies=[Depends(local_admin_guard)])
    async def verify_update_manifest(payload: UpdateManifest) -> dict[str, object]:
        verifier = UpdateManifestVerifier(
            public_key_path=Path(config.update_public_key_path).expanduser() if config.update_public_key_path else None,
            current_version="0.3.0",
            platform="windows-x64" if os.name == "nt" else "linux-amd64",
            channel=config.update_channel.value,
            wan_profile=config.wan_profile,
        )
        decision = verifier.verify(payload)
        runtime.store.set_runtime_value("update_state", decision.state.value)
        runtime.store.set_runtime_value("update_detail", decision.detail)
        runtime.store.set_runtime_value("update_release_id", decision.release_id)
        runtime.store.set_runtime_value("update_available_version", decision.version)
        return {
            "state": decision.state.value,
            "detail": decision.detail,
            "release_id": decision.release_id,
            "available_version": decision.version,
        }

    @app.delete("/api/v1/setup/cameras/{camera_id}", tags=["setup"], dependencies=[Depends(local_admin_guard)])
    async def remove_camera(camera_id: str) -> dict[str, str]:
        index = next((i for i, item in enumerate(config.cameras) if item.camera_id == camera_id), None)
        if index is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="camera not found")
        camera = config.cameras.pop(index)
        runtime.secret_store.delete(camera.stream_url_secret_ref)
        persist_local_config()
        await runtime.refresh_camera_health()
        return {"camera_id": camera_id, "status": "deleted"}

    @app.post("/api/v1/cameras/{camera_id}/test", tags=["operations"], dependencies=[Depends(local_admin_guard)])
    async def test_camera(camera_id: str) -> dict[str, object]:
        camera = next((item for item in config.cameras if item.camera_id == camera_id), None)
        if not camera:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="camera not found")
        health_result = await runtime.camera_monitor.health(camera)
        return health_result.model_dump(mode="json")

    @app.post("/api/v1/ai/test-detections", tags=["operations"], dependencies=[Depends(local_admin_guard)])
    async def test_detections(payload: DetectionTestRequest) -> dict[str, object]:
        camera = next((item for item in config.cameras if item.camera_id == payload.camera_id), None)
        if not camera:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="camera not found")
        detections = [
            Detection(label=label, confidence=payload.confidence, track_id=payload.track_id, bbox=(0.1, 0.1, 0.5, 0.5))
            for label in payload.labels
        ]
        events = runtime.ai_engine.process(payload.camera_id, detections, payload.restricted_zone)
        for event in events:
            runtime.enqueue_event(event)
        return {"event_count": len(events), "events": [event.model_dump(mode="json") for event in events]}

    @app.post("/api/v1/maintenance/flush-events", tags=["operations"], dependencies=[Depends(local_admin_guard)])
    async def flush_events() -> dict[str, object]:
        accepted = await runtime.flush_events()
        return {"accepted_events": accepted, "pending_events": runtime.store.event_spool_depth()}

    @app.get("/api/v1/events/recent", tags=["operations"])
    async def recent_events() -> dict[str, object]:
        return {"events": [event.model_dump(mode="json") for event in runtime.ai_engine.recent_events()]}

    return app
