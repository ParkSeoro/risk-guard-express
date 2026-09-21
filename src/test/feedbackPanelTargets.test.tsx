import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const upsert = vi.fn(async () => ({ error: null }));
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      order: async () => ({ data: [], error: null }),
    }),
  }),
  upsert,
  delete: () => ({
    eq: () => ({
      eq: async () => ({ error: null }),
    }),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { display_name: "테스터" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/approval/SubmitApprovalDialog", () => ({
  default: () => null,
}));

import FeedbackPanel from "@/components/FeedbackPanel";

describe("FeedbackPanel auto targets", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    upsert.mockClear();
  });

  it("lets a manager uncheck 자동(관리대상) and save 해당없음", async () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <FeedbackPanel
          runId="run-1"
          projectId="p1"
          isApproved
          riskItems={[
            {
              id: "h1",
              process: "용접",
              sub_task: "용접 작업",
              hazard: "추락",
              improved_risk_grade: "상",
            },
          ]}
          projectMembers={[]}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      const toggle = Array.from(el!.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes("피드백 대상 선택"),
      );
      toggle?.click();
    });

    const box = el!.querySelector('[data-testid="feedback-target-h1"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(true);

    await act(async () => {
      box.click();
    });
    expect(document.querySelector('[data-testid="feedback-exclude-reason"]')).toBeTruthy();

    await act(async () => {
      (document.querySelector('[data-testid="feedback-exclude-해당없음"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(upsert).toHaveBeenCalled();
    const payload = upsert.mock.calls[0]?.[0] as { kind: string; reason: string };
    expect(payload.kind).toBe("exclude");
    expect(payload.reason).toBe("해당없음");
  });
});
