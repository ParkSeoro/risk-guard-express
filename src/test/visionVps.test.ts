import { describe, expect, it } from "vitest";
import {
  visionVpsCameraId,
  visionVpsFromHost,
  visionVpsHlsBase,
  visionVpsPlaybackUrl,
  visionVpsRtmpUrl,
  visionVpsStreamKey,
} from "@/lib/visionVps";

describe("vision VPS helpers", () => {
  it("builds VIGI RTMP and HTTPS HLS from a public IP", () => {
    const relay = visionVpsFromHost("203.0.113.10");
    expect(relay).toEqual({
      host: "203.0.113.10",
      rtmp_url: "rtmp://203.0.113.10:1935/live",
      hls_base: "https://203-0-113-10.sslip.io",
    });
    expect(visionVpsPlaybackUrl(relay!.hls_base, "ab12")).toBe(
      "https://203-0-113-10.sslip.io/live/ab12/index.m3u8",
    );
  });

  it("keeps a domain as the HLS host", () => {
    expect(visionVpsFromHost("https://vision.example.com:8888/cam1")).toEqual({
      host: "vision.example.com",
      rtmp_url: "rtmp://vision.example.com:1935/live",
      hls_base: "https://vision.example.com",
    });
    expect(visionVpsRtmpUrl("vision.example.com")).toBe("rtmp://vision.example.com:1935/live");
    expect(visionVpsHlsBase("vision.example.com")).toBe("https://vision.example.com");
  });

  it("round-trips the stream key on camera_id", () => {
    expect(visionVpsCameraId("ab12cd")).toBe("vps_ab12cd");
    expect(visionVpsStreamKey("vps_ab12cd")).toBe("ab12cd");
    expect(visionVpsStreamKey("mux_ls_1")).toBeNull();
    expect(visionVpsFromHost("")).toBeNull();
  });
});
