from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vision_edge.app import create_app
from vision_edge.config import load_config, write_example_config
from vision_edge.models import GatewayIdentity, LocalConfig
from vision_edge.nvr import OnvifDiscoverer, OnvifDiscoveryCandidate


def test_dashboard_javascript_has_valid_syntax(tmp_path: Path) -> None:
    dashboard = Path(__file__).parents[1] / "src" / "vision_edge" / "static" / "index.html"
    script = dashboard.read_text(encoding="utf-8").split("<script>", 1)[1].split("</script>", 1)[0]
    script_path = tmp_path / "dashboard.js"
    script_path.write_text(script, encoding="utf-8")
    result = subprocess.run(["node", "--check", str(script_path)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_example_configuration_starts_unpaired(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("VISION_EDGE_DEVELOPMENT", "1")
    config_path = tmp_path / "vision-edge.json"
    write_example_config(config_path, tmp_path / "state")
    config = load_config(config_path)
    assert config.identity.fleet_base_url is None
    assert config.fleet_token_url is None

    with TestClient(create_app(config, config_path)) as client:
        assert client.get("/api/v1/status").json()["fleet_configured"] is False


def test_onvif_discovery_response_parsing_and_local_api(monkeypatch, tmp_path: Path) -> None:
    response = b"""<?xml version='1.0'?>
    <e:Envelope xmlns:e='http://www.w3.org/2003/05/soap-envelope' xmlns:d='http://schemas.xmlsoap.org/ws/2005/04/discovery'>
      <e:Body><d:ProbeMatches><d:ProbeMatch><d:XAddrs>http://192.168.10.10/onvif/device_service</d:XAddrs><d:Scopes>onvif://www.onvif.org/name/A-NVR</d:Scopes></d:ProbeMatch></d:ProbeMatches></e:Body>
    </e:Envelope>"""
    parsed = OnvifDiscoverer._parse_response(response)
    assert parsed[0].host == "192.168.10.10"
    assert parsed[0].port == 80

    monkeypatch.setenv("VISION_EDGE_DEVELOPMENT", "1")
    config = LocalConfig(
        identity=GatewayIdentity(gateway_id="gw-1", tenant_id="tenant-1", site_id="site-1"),
        state_dir=str(tmp_path / "state"),
    )
    monkeypatch.setattr(
        OnvifDiscoverer,
        "discover",
        lambda _self, _timeout: [
            OnvifDiscoveryCandidate(
                endpoint="http://192.168.10.10/onvif/device_service",
                host="192.168.10.10",
                port=80,
                scopes=("onvif://www.onvif.org/name/A-NVR",),
            )
        ],
    )
    with TestClient(create_app(config)) as client:
        discovery = client.post("/api/v1/setup/discovery/onvif", json={"timeout_seconds": 1})
        assert discovery.status_code == 200
        assert discovery.json()["scope"] == "local-lan-only"
        assert discovery.json()["candidates"][0]["host"] == "192.168.10.10"
        qr = client.post("/api/v1/setup/onboarding/qr/start", json={})
        assert qr.status_code == 422
        assert client.get("/api/v1/setup/onboarding/status").json() == {"status": "not_started"}


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


def test_camera_monitoring_api_never_exposes_rtsp_secret(monkeypatch, tmp_path: Path) -> None:
    from vision_edge.config import save_config

    monkeypatch.setenv("VISION_EDGE_DEVELOPMENT", "1")
    config_path = tmp_path / "vision-edge.json"
    config = LocalConfig(
        identity=GatewayIdentity(gateway_id="gw-1", tenant_id="tenant-1", site_id="site-1"),
        state_dir=str(tmp_path / "state"),
    )
    save_config(config_path, config)
    with TestClient(create_app(config, config_path)) as client:
        assert client.post(
            "/api/v1/setup/nvrs",
            json={"nvr_id": "nvr-1", "name": "A동 NVR", "host": "192.168.10.10", "port": 554},
        ).status_code == 200
        assert client.post(
            "/api/v1/setup/cameras",
            json={
                "camera_id": "camera-1",
                "name": "A동 출입구",
                "nvr_id": "nvr-1",
                "stream_url": "rtsp://operator:password@192.168.10.10/stream",
            },
        ).status_code == 200

        nvrs = client.get("/api/v1/nvrs")
        cameras = client.get("/api/v1/cameras")
        assert nvrs.status_code == 200
        assert cameras.status_code == 200
        assert cameras.json()["max_local_previews"] == 4
        camera = cameras.json()["cameras"][0]
        assert camera["live_preview_url"] == "/api/v1/cameras/camera-1/live.mjpeg"
        assert "rtsp" not in str(camera).lower()
        assert "password" not in str(camera).lower()

        assert client.get("/api/v1/cameras/missing/live.mjpeg").status_code == 404
        assert client.delete("/api/v1/setup/cameras/camera-1").status_code == 200
        assert client.get("/api/v1/cameras").json()["cameras"] == []
