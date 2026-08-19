"""Vision Edge의 현장 로컬 운영 API 및 상태 화면."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .ai import Detection
from .config import save_config
from .fleet_client import FleetClient
from .models import CameraConfig, LocalConfig, NvrConfig
from .nvr import CameraMonitor, FfprobeStreamProbe
from .runtime import EdgeRuntime
from .secret_store import SecretStore
from .security import MasterCommandVerifier
from .storage import EdgeStore


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


class CameraSetupRequest(BaseModel):
    camera_id: str = Field(min_length=3, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    nvr_id: str = Field(min_length=3, max_length=128)
    stream_url: str = Field(min_length=8, max_length=2048)
    expected_fps: float = Field(default=10.0, ge=0.1, le=120.0)
    ai_profile: str = Field(default="ppe-standard-kr-v1", min_length=3, max_length=128)


def build_runtime(config: LocalConfig) -> EdgeRuntime:
    state_dir = Path(config.state_dir).expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    allow_dev_key = os.getenv("VISION_EDGE_DEVELOPMENT") == "1"
    secret_store = SecretStore(state_dir, allow_local_key_generation=allow_dev_key)
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
        version="0.1.0",
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

    @app.get("/api/v1/status", tags=["operations"])
    async def gateway_status() -> dict[str, object]:
        return runtime.status()

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
