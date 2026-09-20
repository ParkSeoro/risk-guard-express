import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import VisionVpsSetup from "@/components/vision/VisionVpsSetup";

describe("VisionVpsSetup", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
  });

  it("shows VPS host save and camera add, not the Windows starter", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <VisionVpsSetup
          host="203.0.113.10"
          onHostChange={() => undefined}
          onHostSave={async () => undefined}
          name=""
          onNameChange={() => undefined}
          ingest={null}
          relay={{
            host: "203.0.113.10",
            rtmp_url: "rtmp://203.0.113.10:1935/live",
            hls_base: "https://203-0-113-10.sslip.io",
          }}
          onCreate={async () => undefined}
        />,
      );
    });
    expect(el.querySelector('[data-testid="vision-vps-setup"]')).toBeTruthy();
    expect(el.textContent).toContain("중계 저장");
    expect(el.textContent).toContain("추가");
    expect(el.textContent).toContain("rtmp://203.0.113.10:1935/live");
    expect(el.textContent).not.toContain("시작.bat");
    expect(el.textContent).not.toContain("Mux");
  });
});
