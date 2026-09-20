import { describe, expect, it } from "vitest";
import { MUX_RTMP_SERVER, muxCameraId, muxHlsUrl, muxLiveStreamId } from "@/lib/visionMux";

describe("vision mux helpers", () => {
  it("builds the VIGI RTMP server and HTTPS playlist", () => {
    expect(MUX_RTMP_SERVER).toBe("rtmp://global-live.mux.com:5222/app");
    expect(muxHlsUrl("abc")).toBe("https://stream.mux.com/abc.m3u8");
  });

  it("round-trips the mux live stream id on camera_id", () => {
    expect(muxCameraId("ls_1")).toBe("mux_ls_1");
    expect(muxLiveStreamId("mux_ls_1")).toBe("ls_1");
    expect(muxLiveStreamId("cam1")).toBeNull();
  });
});
