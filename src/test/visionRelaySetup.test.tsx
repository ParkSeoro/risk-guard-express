import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import VisionRelaySetup from "@/components/vision/VisionRelaySetup";

describe("VisionRelaySetup", () => {
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

  it("shows three Korean steps and a 4-slot fill button", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(<VisionRelaySetup onCreateSlots={async () => undefined} />);
    });
    expect(el.textContent).toContain("세 번만 하면 됩니다");
    expect(el.textContent).toContain("시작.bat");
    expect(el.textContent).toContain("4칸 만들기");
  });
});
