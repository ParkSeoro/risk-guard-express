import { describe, expect, it } from "vitest";
import { androidGpsPipelineOwner } from "@/lib/tracking/androidGpsPipeline";

describe("androidGpsPipelineOwner", () => {
  it("gives the WebView tracker the foreground and headless the background", () => {
    expect(androidGpsPipelineOwner(true)).toBe("webview");
    expect(androidGpsPipelineOwner(false)).toBe("headless");
  });
});
