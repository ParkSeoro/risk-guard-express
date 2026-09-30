import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useState, type ReactNode } from "react";
import RiggingPlanForm from "@/components/rigging/RiggingPlanForm";

function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const [rigging, setRigging] = useState<Record<string, unknown>>({
    sling_material_type: "wire_rope",
    wire_diameter_mm: 75,
    wire_safety_coefficient: 5,
    sling_count: 2,
    sling_angle_deg: 60,
    wire_terminal_method: "압축(25mm 이상)",
    load_weight: 10,
    hook_weight: 1,
    crane_capacity: 200,
    rated_capacity: 200,
    working_radius: 8,
    boom_length: 20,
    shackle_inch: "2-1/2",
    shackle_qty: 2,
    wind_speed_grade: "0~5",
  });
  return (
    <RiggingPlanForm
      rigging={rigging}
      onChange={(key, value) => setRigging((prev) => ({ ...prev, [key]: value }))}
      onDerivedPatch={(patch) => setRigging((prev) => ({ ...prev, ...patch }))}
      onSave={() => {}}
      saving={false}
      readOnly={readOnly}
    />
  );
}

function inputByLabel(label: string): HTMLInputElement {
  const labels = Array.from(document.body.querySelectorAll("label"));
  const match = labels.find((el) => el.textContent === label);
  const input = match?.parentElement?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return input;
}

describe("와이어 제조사 안전하중 입력", () => {
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

  async function mount(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(node);
    });
  }

  it("비어 있으면 지름 표로 판정하고, 값을 넣으면 제조사 하중으로 바뀐다", async () => {
    await mount(<Harness />);

    const catalog = inputByLabel("표 안전하중");
    const manufacturer = inputByLabel("제조사 안전하중");
    expect(catalog.disabled).toBe(true);
    expect(manufacturer.disabled).toBe(false);
    expect(manufacturer.value).toBe("");
    expect(document.body.textContent).toContain("줄걸이 방법");
    expect(document.body.textContent).toContain("디바이스로 두 가지 줄걸이");
    expect(document.body.textContent).toContain("안전하중은 더하지 않습니다");
    expect(document.body.textContent).toContain("지름 표 계산");
    expect(document.body.textContent).toContain("61.3");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(manufacturer, "40");
      manufacturer.dispatchEvent(new Event("input", { bubbles: true }));
      manufacturer.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("제조사 안전하중");
    expect(document.body.textContent).toContain("이 칸은 제조사 안전하중입니다.");
    expect(document.body.textContent).toContain("40.0");
    expect(inputByLabel("표 안전하중").value).not.toBe("40");
  });
});
