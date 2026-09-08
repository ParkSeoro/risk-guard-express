import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

const fetchMock = vi.fn();

vi.mock("@/hooks/useActiveProject", () => ({
  useActiveProject: () => ({ projectId: "p1" }),
}));
vi.mock("@/hooks/useAuditLog", () => ({
  useAuditLog: () => ({ log: vi.fn() }),
}));
vi.mock("@/lib/dailyWorkAck", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dailyWorkAck")>();
  return { ...actual, todaySeoulDate: () => "2026-09-08" };
});
vi.mock("@/lib/laborEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/laborEvidence")>();
  return {
    ...actual,
    fetchSignatureLedger: (...args: unknown[]) => fetchMock(...args),
  };
});

import WorkerSignatureLedgerPanel from "@/components/workers/WorkerSignatureLedgerPanel";

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WorkerSignatureLedgerPanel default range", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    fetchMock.mockReset();
  });

  it("opens on today and does not show 0건 while loading", async () => {
    let resolveRows: (v: unknown[]) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        }),
    );

    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <MemoryRouter>
          <WorkerSignatureLedgerPanel projectId="p1" />
        </MemoryRouter>,
      );
    });

    const from = el.querySelector('[data-testid="signature-ledger-from"]') as HTMLInputElement;
    const to = el.querySelector('[data-testid="signature-ledger-to"]') as HTMLInputElement;
    expect(from.value).toBe("2026-09-08");
    expect(to.value).toBe("2026-09-08");
    expect(el.querySelector('[data-testid="signature-ledger-count"]')?.textContent).toBe(
      "서명 불러오는 중…",
    );
    expect(fetchMock).toHaveBeenCalledWith({
      projectId: "p1",
      workerId: undefined,
      from: "2026-09-08",
      to: "2026-09-08",
    });

    await act(async () => {
      resolveRows([]);
    });
    await flush();
    expect(el.querySelector('[data-testid="signature-ledger-count"]')?.textContent).toBe("서명 0건");
  });
});
