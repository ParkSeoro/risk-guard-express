from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from vision_edge.app import create_app
from vision_edge.models import GatewayIdentity, LocalConfig


def test_local_health_and_status(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("VISION_EDGE_DEVELOPMENT", "1")
    config = LocalConfig(
        identity=GatewayIdentity(gateway_id="gw-1", tenant_id="tenant-1", site_id="site-1"),
        state_dir=str(tmp_path / "state"),
    )
    with TestClient(create_app(config)) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        status = client.get("/api/v1/status")
        assert status.status_code == 200
        assert status.json()["gateway_id"] == "gw-1"
        dashboard = client.get("/")
        assert dashboard.status_code == 200
        assert "SafeNex Vision Edge" in dashboard.text


def test_local_setup_encrypts_stream_url_and_updates_config(monkeypatch, tmp_path: Path) -> None:
    from vision_edge.config import save_config

    monkeypatch.setenv("VISION_EDGE_DEVELOPMENT", "1")
    config_path = tmp_path / "vision-edge.json"
    config = LocalConfig(
        identity=GatewayIdentity(gateway_id="gw-1", tenant_id="tenant-1", site_id="site-1"),
        state_dir=str(tmp_path / "state"),
    )
    save_config(config_path, config)
    with TestClient(create_app(config, config_path)) as client:
        nvr_response = client.post(
            "/api/v1/setup/nvrs",
            json={"nvr_id": "nvr-1", "name": "A동 NVR", "host": "192.168.10.10", "port": 554},
        )
        assert nvr_response.status_code == 200
        camera_response = client.post(
            "/api/v1/setup/cameras",
            json={
                "camera_id": "camera-1",
                "name": "A동 고소작업 구역",
                "nvr_id": "nvr-1",
                "stream_url": "rtsp://operator:password@192.168.10.10/stream",
            },
        )
        assert camera_response.status_code == 200
        assert camera_response.json()["stream_url_stored"] == "encrypted-local-store"

    persisted = config_path.read_text(encoding="utf-8")
    assert "password" not in persisted
    assert "rtsp://" not in persisted
    assert "camera:camera-1:stream" in persisted
