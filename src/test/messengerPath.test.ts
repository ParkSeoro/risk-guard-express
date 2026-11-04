import { describe, expect, it } from "vitest";
import { messengerHomePath } from "@/lib/messengerPath";

describe("messengerHomePath", () => {
  it("uses the worker shell on a phone and the admin shell on desktop", () => {
    expect(messengerHomePath({ mobileShell: true })).toBe("/app/worker/messenger");
    expect(messengerHomePath({ mobileShell: false })).toBe("/app/admin/messenger");
  });
});
