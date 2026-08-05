import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fitPermitKindPagesToOneSheet } from "@/lib/printPermitBundle";

describe("fitPermitKindPagesToOneSheet", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("scales a tall kind sheet to fit one page height", () => {
    host.innerHTML = `
      <div class="permit-print-form-page">
        <div class="standard-permit-sheet" style="width:198mm;height:2000px;background:#fff"></div>
      </div>
    `;
    fitPermitKindPagesToOneSheet(host, { pageWidthMm: 198, pageHeightMm: 277 });
    const sheet = host.querySelector(".standard-permit-sheet") as HTMLElement;
    const transform = sheet.style.transform || "";
    expect(transform).toMatch(/scale\(/);
    const m = transform.match(/scale\(([\d.]+)\)/);
    expect(m).toBeTruthy();
    const scale = Number(m![1]);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0);
  });
});
