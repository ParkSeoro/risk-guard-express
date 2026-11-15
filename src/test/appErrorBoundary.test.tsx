import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("Cannot read properties of undefined (reading 'hasRole')");
  return <p>본문</p>;
}

describe("AppErrorBoundary", () => {
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

  it("clears the error screen when the route key changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);

    act(() => {
      root?.render(
        <AppErrorBoundary resetKey="/legal-duties">
          <Boom explode />
        </AppErrorBoundary>,
      );
    });
    expect(el.textContent).toContain("화면을 불러오지 못했습니다");

    act(() => {
      root?.render(
        <AppErrorBoundary resetKey="/workers">
          <Boom explode={false} />
        </AppErrorBoundary>,
      );
    });
    expect(el.textContent).toContain("본문");
    expect(el.textContent).not.toContain("화면을 불러오지 못했습니다");
  });
});
