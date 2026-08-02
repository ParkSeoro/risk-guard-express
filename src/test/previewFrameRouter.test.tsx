import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import PreviewFrameRouter from "@/components/mobile/PreviewFrameRouter";

function Probe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="path">{loc.pathname}</div>
      <button type="button" data-testid="go" onClick={() => navigate("/app/worker/tasks")}>
        go-tasks
      </button>
    </div>
  );
}

describe("PreviewFrameRouter", () => {
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

  it("overrides location inside BrowserRouter without nested-Router crash", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);

    act(() => {
      root!.render(
        <BrowserRouter>
          <div data-testid="outer">admin</div>
          <PreviewFrameRouter initialPath="/app/worker/today">
            <Routes>
              <Route path="/app/worker/*" element={<Probe />} />
            </Routes>
          </PreviewFrameRouter>
        </BrowserRouter>,
      );
    });

    expect(el.querySelector('[data-testid="path"]')?.textContent).toBe("/app/worker/today");

    act(() => {
      el!.querySelector<HTMLButtonElement>('[data-testid="go"]')?.click();
    });

    expect(el.querySelector('[data-testid="path"]')?.textContent).toBe("/app/worker/tasks");
    expect(el.querySelector('[data-testid="outer"]')?.textContent).toBe("admin");
  });
});
