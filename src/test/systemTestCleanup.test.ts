import { beforeEach, describe, expect, it, vi } from "vitest";

type Artifact = { ref_table: string; ref_id: string };

const state = vi.hoisted(() => ({
  artifacts: [] as Artifact[],
  softDeleteFails: new Set<string>(),
  calls: [] as Array<{ table: string; op: string; values?: unknown; filters: Record<string, unknown> }>,
}));

function builder(table: string, op: string, values?: unknown) {
  const filters: Record<string, unknown> = {};
  const api = {
    select: () => builder(table, "select"),
    update: (next: unknown) => builder(table, "update", next),
    delete: () => builder(table, "delete"),
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return api;
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      state.calls.push({ table, op, values, filters: { ...filters } });
      const failed = op === "update" && state.softDeleteFails.has(table);
      return Promise.resolve({
        data: op === "select" && table === "system_test_artifacts" ? state.artifacts : null,
        error: failed ? { message: "column is_deleted does not exist" } : null,
      }).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: { success: true }, error: null })),
    from: (table: string) => builder(table, "from"),
  },
}));

import { cleanupRun } from "@/lib/systemTest/runner";

describe("cleanupRun", () => {
  beforeEach(() => {
    state.artifacts = [];
    state.softDeleteFails = new Set();
    state.calls = [];
  });

  it("deactivates a test worker and hides the education items created with it", async () => {
    state.artifacts = [{ ref_table: "workers", ref_id: "worker-1" }];

    await cleanupRun("run-1");

    expect(state.calls).toEqual([
      expect.objectContaining({
        table: "system_test_artifacts",
        op: "select",
        filters: { run_id: "run-1" },
      }),
      expect.objectContaining({
        table: "worker_required_items",
        op: "update",
        values: { is_deleted: true },
        filters: { worker_id: "worker-1" },
      }),
      expect.objectContaining({
        table: "workers",
        op: "update",
        values: { is_active: false },
        filters: { id: "worker-1" },
      }),
    ]);
    expect(state.calls.some((call) => call.op === "delete")).toBe(false);
  });

  it("soft-deletes other tracked tables and does not hard-delete them after the hide RPC succeeds", async () => {
    state.artifacts = [
      { ref_table: "assessment_runs", ref_id: "run-row" },
      { ref_table: "audit_logs", ref_id: "log-1" },
    ];
    state.softDeleteFails.add("audit_logs");

    await cleanupRun("run-2");

    expect(state.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "assessment_runs",
          op: "update",
          values: { is_deleted: true },
          filters: { id: "run-row" },
        }),
        expect.objectContaining({
          table: "audit_logs",
          op: "update",
          values: { is_deleted: true },
          filters: { id: "log-1" },
        }),
      ]),
    );
    expect(state.calls.some((call) => call.op === "delete")).toBe(false);
    expect(state.calls.some((call) => call.table === "workers")).toBe(false);
  });
});
