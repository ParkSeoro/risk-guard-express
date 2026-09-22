import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

const softDelete = vi.fn(async () => ({ ok: true }));
const eqCalls: Array<{ table: string; col: string; val: unknown }> = [];

function thenable(result: { data: unknown; error: null }) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (col: string, val: unknown) => {
    eqCalls.push({ table: currentTable, col, val });
    return q;
  };
  q.order = () => q;
  q.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve(result).then(resolve);
  return q;
}

let currentTable = "";
const materials = [
  {
    id: "m1",
    project_id: "p1",
    title: "소방전기 교육",
    work_overview: "고소작업과 전기 위험",
    key_hazards: [],
    accident_cases: [],
    safety_measures: [],
    prohibited_actions: [],
    ppe_requirements: [],
    tbm_summary: "",
    auto_generated: true,
  },
];

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useActiveProject", () => ({
  useActiveProject: () => ({ projectId: "p1", setProjectId: vi.fn() }),
}));
vi.mock("@/hooks/useSoftDelete", () => ({
  useSoftDelete: () => ({ softDelete }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      currentTable = table;
      if (table === "safety_education_materials") {
        return thenable({ data: materials, error: null });
      }
      if (table === "projects") {
        return thenable({ data: [{ id: "p1", name: "현장A" }], error: null });
      }
      return thenable({ data: [], error: null });
    },
  },
}));

import EducationMaterials from "@/pages/EducationMaterials";

describe("EducationMaterials delete", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    softDelete.mockClear();
    eqCalls.length = 0;
  });

  async function mount() {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <EducationMaterials />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("lists 삭제 next to 수정/PDF/PPT and hides deleted rows", async () => {
    await mount();
    expect(el!.textContent).toContain("소방전기 교육");
    expect(el!.textContent).toContain("수정");
    expect(el!.textContent).toContain("PDF");
    expect(el!.textContent).toContain("PPT");
    expect(el!.textContent).toContain("삭제");
    expect(eqCalls).toContainEqual({
      table: "safety_education_materials",
      col: "is_deleted",
      val: false,
    });
  });

  it("soft-deletes the material and reloads the list", async () => {
    await mount();
    const del = [...el!.querySelectorAll("button")].find((b) => b.textContent === "삭제");
    expect(del).toBeTruthy();
    await act(async () => {
      del!.click();
    });
    expect(softDelete).toHaveBeenCalledWith("safety_education_materials", "m1", {
      projectId: "p1",
      label: "소방전기 교육",
    });
  });
});
