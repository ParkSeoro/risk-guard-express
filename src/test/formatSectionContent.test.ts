import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  formatSectionContent,
  formatSectionPrintHtml,
} from "@/lib/formatSectionContent";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("formatSectionContent", () => {
  it("turns excavation structured JSON into Korean labels, never raw keys", () => {
    const raw = JSON.stringify({
      method: "무전기",
      signal: "무전",
      radio: "CH14",
    });
    const text = formatSectionContent(raw, "contact");
    expect(text).toContain("연락 방법");
    expect(text).toContain("무전기");
    expect(text).toContain("CH14");
    expect(text).not.toContain("{");
    expect(text).not.toContain("soil_type");
  });

  it("does not fall back to raw JSON when every field is empty", () => {
    const raw = JSON.stringify({
      soil_type: "",
      groundwater: "",
      rock_class: "",
      gas_present: "",
    });
    expect(formatSectionContent(raw)).toBe("기재 없음");
  });

  it("prints commander as a Korean table, not a JSON dump", () => {
    const html = formatSectionPrintHtml(
      JSON.stringify({ name: "마종호", qualification: "공사부장", placement: "하부" }),
      esc,
      "commander",
    );
    expect(html).toContain("작업지휘자 성명");
    expect(html).toContain("마종호");
    expect(html).toContain("자격·직책");
    expect(html).not.toContain("{");
    expect(html).not.toContain('"name"');
  });

  it("uses section-scoped labels so method is not always 방법", () => {
    const html = formatSectionPrintHtml(
      JSON.stringify({ method: "급기식", air_volume: "30" }),
      esc,
      "ventilation",
    );
    expect(html).toContain("환기 방식");
    expect(html).toContain("급기식");
    expect(html).not.toContain("{");
  });

  it("renders the excavation preview payload from 사외배관 부지정지", () => {
    const geology = formatSectionPrintHtml(
      '{"soil_type":"","groundwater":"","rock_class":"","gas_present":""}',
      esc,
      "geology",
    );
    const contact = formatSectionPrintHtml(
      '{"method":"무전기","signal":"무전","radio":"CH14"}',
      esc,
      "contact",
    );
    expect(geology).toContain("기재 없음");
    expect(geology).not.toContain("soil_type");
    expect(contact).toContain("연락 방법");
    expect(contact).toContain("무전기");
    expect(contact).not.toMatch(/\{"method"/);
  });
});

describe("print edges never dump structured JSON", () => {
  it("work-plan PDF uses formatSectionPrintHtml for leftover sections", () => {
    const src = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(src).toContain("formatSectionPrintHtml");
    expect(src).not.toMatch(/escapeHtml\(section\.content\)/);
  });

  it("risk-assessment PDF includes worker opinions and accident cases", () => {
    const src = readFileSync("supabase/functions/generate-pdf/index.ts", "utf8");
    expect(src).toContain('from("worker_opinions")');
    expect(src).toContain('from("assessment_accidents")');
    expect(src).toContain("근로자 의견");
    expect(src).toContain("사고사례");
  });
});
