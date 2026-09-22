import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import VisionCameraManageList from "@/components/vision/VisionCameraManageList";

describe("VisionCameraManageList", () => {
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

  it("saves the assigned company", async () => {
    const onSave = vi.fn(async () => undefined);
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <VisionCameraManageList
          cameras={[{ id: "1", name: "정문", playback_url: "http://10.0.0.1/x.m3u8", company_id: null }]}
          companies={[{ id: "co-1", name: "진남토건" }]}
          onSave={onSave}
          onDelete={async () => undefined}
        />,
      );
    });
    const select = el.querySelector('select[aria-label="소속 회사"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(el.textContent).toContain("현장 공용");
    act(() => {
      select.value = "co-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saveBtn = [...el.querySelectorAll("button")].find((b) => b.textContent === "수정");
    await act(async () => {
      saveBtn?.click();
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1" }),
      { name: "정문", playback_url: "http://10.0.0.1/x.m3u8", company_id: "co-1" },
    );
  });

  it("shows edit and delete for each camera", () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <VisionCameraManageList
          cameras={[{ id: "1", name: "정문", playback_url: "http://10.0.0.1:8888/cam1/index.m3u8" }]}
          onSave={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    expect(el.querySelector('[data-testid="vision-camera-manage"]')).toBeTruthy();
    expect(el.textContent).toContain("수정");
    expect(el.textContent).toContain("삭제");
    expect((el.querySelector('input[aria-label="카메라 이름"]') as HTMLInputElement).value).toBe("정문");
  });

  it("calls onSave with the current name", async () => {
    const onSave = vi.fn(async () => undefined);
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(
        <VisionCameraManageList
          cameras={[{ id: "1", name: "정문", playback_url: "http://10.0.0.1/x.m3u8" }]}
          onSave={onSave}
          onDelete={async () => undefined}
        />,
      );
    });
    const saveBtn = [...el.querySelectorAll("button")].find((b) => b.textContent === "수정");
    await act(async () => {
      saveBtn?.click();
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", name: "정문" }),
      { name: "정문", playback_url: "http://10.0.0.1/x.m3u8", company_id: null },
    );
  });
});
