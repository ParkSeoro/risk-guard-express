import { describe, expect, it, vi } from "vitest";
import {
  classifyPlaylist,
  explainVisionPlayback,
  VISION_OFFLINE,
  visionViewerStatusUrl,
} from "@/lib/visionPlaybackFailure";

const PLAYBACK = "https://example.com/live/ab/index.m3u8";

describe("vision playback failure", () => {
  it("turns a playlist response into a connection reason", () => {
    expect(classifyPlaylist(null, "", true)).toBe("relay");
    expect(classifyPlaylist(503, "", false)).toBe("relay");
    expect(classifyPlaylist(404, "", false)).toBe("camera");
    expect(classifyPlaylist(200, "#EXTM3U\n#EXT-X-ENDLIST\n", false)).toBe("ended");
    expect(classifyPlaylist(200, "#EXTM3U\n#EXTINF:1,\nseg.ts\n", false)).toBe("starting");
    expect(classifyPlaylist(200, "#EXTM3U\n", false)).toBe("camera");
  });

  it("uses the saving kick when the relay says the upload was stopped", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("viewer-status")) {
        return new Response(JSON.stringify({ idle_kick: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
    expect(visionViewerStatusUrl(PLAYBACK)).toBe("https://example.com/live/ab/viewer-status");
    await expect(explainVisionPlayback(PLAYBACK, fetchImpl)).resolves.toEqual(VISION_OFFLINE.reconnecting);
  });
});
