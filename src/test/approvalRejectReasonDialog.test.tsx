import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import ApprovalRejectReasonDialog from "@/components/approval/ApprovalRejectReasonDialog";

describe("ApprovalRejectReasonDialog", () => {
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

  it("accepts a multi-line reject reason", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let confirmed = "";
    await act(async () => {
      root!.render(
        <ApprovalRejectReasonDialog
          open
          onOpenChange={() => {}}
          onConfirm={(reason) => {
            confirmed = reason;
          }}
        />,
      );
    });

    const textarea = document.body.querySelector("textarea");
    expect(textarea).toBeTruthy();
    expect(Number(textarea?.getAttribute("rows") || 0)).toBeGreaterThanOrEqual(4);

    await act(async () => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      native?.set?.call(textarea, "첫째 줄\n둘째 줄\n셋째 줄");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const submit = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("반려") && !b.disabled);
    expect(submit).toBeTruthy();
    await act(async () => {
      submit!.click();
    });
    expect(confirmed).toBe("첫째 줄\n둘째 줄\n셋째 줄");
  });
});
