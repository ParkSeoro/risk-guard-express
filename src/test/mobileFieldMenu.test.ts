import { describe, expect, it } from "vitest";
import {
  fieldMenuPaths,
  managerFieldSections,
  managerMoreLinks,
  workerMoreLinks,
} from "@/lib/mobileFieldMenu";

describe("manager field / more IA", () => {
  it("puts vision first on 현장 and does not dump worker tools twice", () => {
    const sections = managerFieldSections();
    expect(sections.map((s) => s.key)).toEqual(["watch", "inspect", "people", "site"]);
    expect(sections[0].items[0]).toMatchObject({
      key: "vision",
      to: "/app/worker/vision-events",
    });

    const paths = fieldMenuPaths(sections);
    expect(paths).toContain("/app/worker/vision-events");
    expect(paths).toContain("/app/worker/workers");
    expect(paths).not.toContain("/app/worker/workers?tab=attendance");
    expect(paths).not.toContain("/app/worker/workers?tab=signatures");
    expect(paths.filter((p) => p === "/app/worker/workers")).toHaveLength(1);
  });

  it("keeps 더보기 to settings and account, without vision or worker lists", () => {
    const more = managerMoreLinks(true);
    const keys = more.map((row) => row.key);
    const tos = more.map((row) => row.to);
    expect(keys).toEqual(["alert-settings", "docs", "qr", "account", "manual"]);
    expect(tos).not.toContain("/app/worker/vision-events");
    expect(tos).not.toContain("/app/worker/alerts");
    expect(tos).not.toContain("/app/worker/workers");
    expect(tos).not.toContain("/app/worker/distribution");
  });

  it("leaves worker 더보기 with alerts and location", () => {
    const more = workerMoreLinks(false);
    expect(more.map((row) => row.key)).toEqual([
      "alerts",
      "alert-settings",
      "location",
      "qr",
      "account",
    ]);
  });
});
