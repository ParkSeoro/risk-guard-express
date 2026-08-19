"""NVR·IP 카메라 읽기 전용 health adapter.

Gateway는 NVR 설정을 쓰지 않으며, ffprobe를 통해 현장 스트림의 연결 가능 여부와
기본 video stream 정보를 확인한다. 실제 ONVIF discovery/vendor write adapter는
호환성 랩 검증 후 별도 plugin으로 추가해야 한다.
"""

from __future__ import annotations

import asyncio
import json
import socket
import time
import xml.etree.ElementTree as element_tree
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urlparse
from uuid import uuid4

from .models import CameraConfig, CameraHealth
from .secret_store import SecretStore, SecretStoreError


@dataclass(frozen=True)
class StreamProbeResult:
    state: str
    fps: float | None
    detail: str | None


class StreamProbe(Protocol):
    async def probe(self, stream_url: str, timeout_seconds: int) -> StreamProbeResult: ...


class FfprobeStreamProbe:
    async def probe(self, stream_url: str, timeout_seconds: int) -> StreamProbeResult:
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-select_streams",
            "v:0",
            stream_url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
        except TimeoutError:
            process.kill()
            await process.communicate()
            return StreamProbeResult("degraded", None, "ffprobe timed out")
        if process.returncode != 0:
            detail = stderr.decode("utf-8", errors="replace").strip().replace(stream_url, "[redacted-stream-url]")
            return StreamProbeResult("offline", None, detail[:300] or "ffprobe failed")
        try:
            payload = json.loads(stdout.decode("utf-8"))
            stream = payload.get("streams", [])[0]
            fps = _parse_rate(stream.get("avg_frame_rate"))
        except (IndexError, ValueError, TypeError, json.JSONDecodeError):
            return StreamProbeResult("degraded", None, "video stream metadata is incomplete")
        return StreamProbeResult("online", fps, None)


def _parse_rate(value: object) -> float | None:
    if not isinstance(value, str) or "/" not in value:
        return None
    numerator, denominator = value.split("/", 1)
    try:
        top, bottom = float(numerator), float(denominator)
    except ValueError:
        return None
    return round(top / bottom, 3) if bottom > 0 else None


@dataclass(frozen=True)
class OnvifDiscoveryCandidate:
    endpoint: str
    host: str
    port: int
    scopes: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "endpoint": self.endpoint,
            "host": self.host,
            "port": self.port,
            "scopes": list(self.scopes),
        }


class OnvifDiscoverer:
    """현장 LAN에 한정해 ONVIF WS-Discovery 후보를 읽기 전용으로 수집한다."""

    multicast_address = ("239.255.255.250", 3702)

    @staticmethod
    def _probe_message() -> bytes:
        message_id = f"uuid:{uuid4()}"
        return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<e:Envelope xmlns:e=\"http://www.w3.org/2003/05/soap-envelope\"
 xmlns:w=\"http://schemas.xmlsoap.org/ws/2004/08/addressing\"
 xmlns:d=\"http://schemas.xmlsoap.org/ws/2005/04/discovery\"
 xmlns:dn=\"http://www.onvif.org/ver10/network/wsdl\">
  <e:Header><w:MessageID>{message_id}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
  <e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>
</e:Envelope>""".encode()

    @staticmethod
    def _parse_response(payload: bytes) -> list[OnvifDiscoveryCandidate]:
        try:
            root = element_tree.fromstring(payload)
        except element_tree.ParseError:
            return []
        namespace = {"d": "http://schemas.xmlsoap.org/ws/2005/04/discovery"}
        candidates: list[OnvifDiscoveryCandidate] = []
        for match in root.findall(".//d:ProbeMatch", namespace):
            xaddrs = match.findtext("d:XAddrs", default="", namespaces=namespace)
            scopes = match.findtext("d:Scopes", default="", namespaces=namespace).split()
            for endpoint in xaddrs.split():
                parsed = urlparse(endpoint)
                if not parsed.hostname:
                    continue
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                candidates.append(
                    OnvifDiscoveryCandidate(
                        endpoint=endpoint,
                        host=parsed.hostname,
                        port=port,
                        scopes=tuple(scopes),
                    )
                )
        return candidates

    def discover(self, timeout_seconds: int = 3) -> list[OnvifDiscoveryCandidate]:
        deadline = time.monotonic() + timeout_seconds
        discovered: dict[str, OnvifDiscoveryCandidate] = {}
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as probe:
            probe.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            probe.settimeout(0.25)
            probe.sendto(self._probe_message(), self.multicast_address)
            while time.monotonic() < deadline:
                try:
                    response, _source = probe.recvfrom(65_535)
                except TimeoutError:
                    continue
                for candidate in self._parse_response(response):
                    discovered[candidate.endpoint] = candidate
        return sorted(discovered.values(), key=lambda item: (item.host, item.port, item.endpoint))


class MjpegPreview:
    """RTSP/RTSPS 스트림을 loopback 전용 MJPEG 미리보기로 변환한다.

    브라우저에는 MJPEG bytes만 전달하고 RTSP URL·NVR credential은 이 프로세스 밖으로
    노출하지 않는다. 다중 화면용 저해상도·저프레임 미리보기이며, NVR의 원본 녹화나
    고해상도 스트림을 대체하지 않는다.
    """

    def __init__(self, secret_store: SecretStore, timeout_seconds: int) -> None:
        self._secret_store = secret_store
        self._timeout_seconds = timeout_seconds

    async def stream(self, camera: CameraConfig) -> AsyncIterator[bytes]:
        try:
            stream_url = self._secret_store.get(camera.stream_url_secret_ref)
        except SecretStoreError as exc:
            raise RuntimeError("camera stream credential is unavailable") from exc

        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            "-rw_timeout",
            str(self._timeout_seconds * 1_000_000),
            "-i",
            stream_url,
            "-an",
            "-vf",
            "fps=4,scale=-2:480",
            "-q:v",
            "6",
            "-f",
            "mpjpeg",
            "-boundary_tag",
            "safenex",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            if process.stdout is None:
                raise RuntimeError("ffmpeg preview pipe was not created")
            while chunk := await process.stdout.read(16_384):
                yield chunk
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=2)
                except TimeoutError:
                    process.kill()
                    await process.wait()


class CameraMonitor:
    def __init__(self, secret_store: SecretStore, stream_probe: StreamProbe, timeout_seconds: int) -> None:
        self._secret_store = secret_store
        self._stream_probe = stream_probe
        self._timeout_seconds = timeout_seconds

    async def health(self, camera: CameraConfig) -> CameraHealth:
        if not camera.enabled:
            return CameraHealth(camera_id=camera.camera_id, state="unknown", detail="camera disabled by local configuration")
        try:
            stream_url = self._secret_store.get(camera.stream_url_secret_ref)
        except SecretStoreError as exc:
            return CameraHealth(camera_id=camera.camera_id, state="offline", detail=str(exc))
        result = await self._stream_probe.probe(stream_url, self._timeout_seconds)
        return CameraHealth(
            camera_id=camera.camera_id,
            state=result.state,  # type: ignore[arg-type]
            last_frame_at=datetime.now(UTC) if result.state == "online" else None,
            observed_fps=result.fps,
            detail=result.detail,
        )

    async def health_all(self, cameras: list[CameraConfig]) -> list[CameraHealth]:
        return list(await asyncio.gather(*(self.health(camera) for camera in cameras)))
