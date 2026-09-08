import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import FeedbackAttachmentThumb from "@/components/feedback/FeedbackAttachmentThumb";

describe("FeedbackAttachmentThumb", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  it("shows a delete control that does not open the file", () => {
    const onRemove = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <FeedbackAttachmentThumb
          url="https://example.com/a.pdf"
          label="조치 전"
          onRemove={onRemove}
        />,
      );
    });
    const del = host.querySelector('button[aria-label="첨부 삭제"]') as HTMLButtonElement | null;
    expect(del).toBeTruthy();
    act(() => {
      del?.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
