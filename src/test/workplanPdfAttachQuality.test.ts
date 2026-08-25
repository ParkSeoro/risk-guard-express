import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compactRenderedAttachments,
  MAX_RENDERED_ATTACHMENTS_CHARS,
  renderedAttachmentsCharSize,
} from "@/lib/pdfRenderHelpers";

describe("compactRenderedAttachments", () => {
  it("is a no-op under budget", () => {
    const input = { a: ["data:image/png;base64,aaa"] };
    expect(compactRenderedAttachments(input, 10_000)).toEqual(input);
  });

  it("drops trailing pages then whole files to fit budget", () => {
    const big = "x".repeat(5000);
    const input = {
      f1: [big, big, big],
      f2: [big, big],
    };
    const out = compactRenderedAttachments(input, 12_000);
    const size = renderedAttachmentsCharSize(out);
    expect(size).toBeLessThanOrEqual(12_000);
    if (out.f1) expect(out.f1.length).toBeGreaterThan(0);
  });

  it("exports a sane default Edge budget", () => {
    expect(MAX_RENDERED_ATTACHMENTS_CHARS).toBeGreaterThan(500_000);
    expect(MAX_RENDERED_ATTACHMENTS_CHARS).toBeLessThan(6_000_000);
  });
});

describe("darkenLightInk source", () => {
  it("targets light grey ink bands used by form PDFs", () => {
    const src = readFileSync("src/lib/pdfRenderHelpers.ts", "utf8");
    expect(src).toContain("darkenLightInk");
    expect(src).toContain("lum >= 210");
    expect(src).toContain("lum >= 150");
  });
});
