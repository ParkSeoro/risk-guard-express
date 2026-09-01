import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
    }),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    profile: { display_name: "테스트", phone: "01012345678" },
  }),
}));

vi.mock("@/hooks/useMobileAccess", () => ({
  useMobileAccess: () => ({
    projectId: "p1",
    role: "worker",
    isMaster: false,
  }),
}));

vi.mock("@/contexts/PreviewContext", () => ({
  usePreviewWriteBlock: () => () => false,
}));

vi.mock("@/lib/tracking/resolveBanSubject", () => ({
  lookupWorkerBanFields: async () => ({ worker_id: null }),
}));

import MobileWorkStop from "@/pages/MobileWorkStop";

describe("MobileWorkStop photo field", () => {
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

  it("requires a camera and album control on the report form", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(<MobileWorkStop />);
    });
    const photo = el.querySelector('[data-testid="work-stop-photo"]');
    expect(photo?.textContent).toMatch(/현장 사진/);
    expect(photo?.textContent).toMatch(/촬영/);
    expect(photo?.textContent).toMatch(/앨범/);
    expect(el.querySelector('input[capture="environment"]')).toBeTruthy();
    expect(el.querySelectorAll('input[type="file"][accept="image/*"]').length).toBe(2);
  });
});
