from __future__ import annotations

from pathlib import Path

import pytest

from vision_edge.ai import OnnxInferenceAdapter, build_inference_adapter, high_severity_push_allowed
from vision_edge.nvr import OnvifDiscoverer, OnvifMediaClient, assert_lan_url, is_lan_host
from vision_edge.relay import stub_publish_url


def test_private_hosts_are_lan_only() -> None:
    assert is_lan_host("192.168.10.10")
    assert is_lan_host("10.0.0.8")
    assert is_lan_host("127.0.0.1")
    assert not is_lan_host("8.8.8.8")
    with pytest.raises(ValueError, match="private LAN"):
        assert_lan_url("http://8.8.8.8/onvif/device_service")


def test_onvif_discovery_drops_public_xaddrs() -> None:
    response = b"""<?xml version='1.0'?>
    <e:Envelope xmlns:e='http://www.w3.org/2003/05/soap-envelope' xmlns:d='http://schemas.xmlsoap.org/ws/2005/04/discovery'>
      <e:Body><d:ProbeMatches>
        <d:ProbeMatch><d:XAddrs>http://8.8.8.8/onvif/device_service</d:XAddrs><d:Scopes>onvif://www.onvif.org/name/Public</d:Scopes></d:ProbeMatch>
        <d:ProbeMatch><d:XAddrs>http://192.168.10.10/onvif/device_service</d:XAddrs><d:Scopes>onvif://www.onvif.org/name/A-NVR</d:Scopes></d:ProbeMatch>
      </d:ProbeMatches></e:Body>
    </e:Envelope>"""
    parsed = OnvifDiscoverer._parse_response(response)
    assert [item.host for item in parsed] == ["192.168.10.10"]


def test_onvif_media_refuses_public_endpoint() -> None:
    with pytest.raises(ValueError, match="private LAN"):
        OnvifMediaClient().get_profiles("http://1.1.1.1/onvif/media_service", "user", "pass")


def test_onnx_adapter_is_noop_without_session() -> None:
    from vision_edge.ai import DisabledInferenceAdapter

    adapter = OnnxInferenceAdapter("/tmp/missing-model.onnx")
    assert adapter.ready is False
    import asyncio

    assert asyncio.run(adapter.detect(b"frame")) == []
    assert isinstance(build_inference_adapter("/no/such/model.onnx"), DisabledInferenceAdapter)
    assert high_severity_push_allowed(measured_fp_fn=False, alarm_interlock_enabled=True) is False
    assert high_severity_push_allowed(measured_fp_fn=True, alarm_interlock_enabled=False) is False
    assert high_severity_push_allowed(measured_fp_fn=True, alarm_interlock_enabled=True) is True


def test_relay_stub_is_https_not_rtsp() -> None:
    url = stub_publish_url("grant-1")
    assert url.startswith("https://")
    assert "rtsp" not in url


def test_fleet_client_configured_with_token_file(tmp_path: Path) -> None:
    from vision_edge.fleet_client import FleetClient

    token = tmp_path / "access.token"
    token.write_text("lab-token", encoding="utf-8")
    client = FleetClient(
        base_url="https://example.supabase.co/functions/v1/vision-fleet",
        gateway_id="gw-1",
        certificate_path=None,
        private_key_path=None,
        ca_bundle_path=None,
        token_url="https://example.supabase.co/functions/v1/vision-fleet/v1/oauth/token",
        client_id="gw-1",
        access_token_path=str(token),
    )
    assert client.configured is True
    assert client._static_token() == "lab-token"


@pytest.mark.asyncio
async def test_siren_command_rejected_until_interlock(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_EDGE_DEVELOPMENT", "1")
    from vision_edge.app import build_runtime
    from vision_edge.models import GatewayCommand, GatewayIdentity, LocalConfig, RiskLevel
    from uuid import uuid4
    from datetime import UTC, datetime, timedelta

    config = LocalConfig(
        identity=GatewayIdentity(gateway_id="gw-1", tenant_id="tenant-1", site_id="site-1"),
        state_dir=str(tmp_path / "state"),
    )
    runtime = build_runtime(config)
    now = datetime.now(UTC)
    command = GatewayCommand.model_validate(
        {
            "command_id": uuid4(),
            "command_type": "siren.play",
            "target_tenant_id": "tenant-1",
            "target_site_id": "site-1",
            "target_gateway_id": "gw-1",
            "risk_level": RiskLevel.RED,
            "issued_at": now,
            "expires_at": now + timedelta(minutes=5),
            "idempotency_key": uuid4(),
            "payload_digest": "a" * 64,
            "payload": {},
            "approval_refs": ["sm-approved"],
            "signature": "placeholder",
            "key_id": "master-key-1",
        }
    )
    ack = await runtime._execute_verified_command(command)
    assert ack.status.value == "rejected"
    assert ack.error_code == "ALARM_INTERLOCK_REQUIRED"
    await runtime.fleet_client.close()
    runtime.store.close()

