/**
 * Print work-permit forms + crew appendix from an isolated iframe.
 *
 * Rules:
 * - Each permit kind = exactly one A4 page (scale-to-fit)
 * - Crew (을지) starts on a new page after all kinds
 * - Escapes AppLayout flex so Chrome honors page breaks
 */

const PAGE_WIDTH_MM = 198;
const PAGE_HEIGHT_MM = 277; // A4 297 − margins

function collectHeadHtml(): string {
  const parts: string[] = [];
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    parts.push(node.outerHTML);
  });
  return parts.join("\n");
}

function unhidePrintNodes(root: HTMLElement) {
  root.classList.remove("hidden");
  root.style.display = "block";
  root.querySelectorAll<HTMLElement>(".hidden").forEach((el) => {
    if (el.classList.contains("print:hidden")) {
      el.style.display = "none";
      return;
    }
    el.classList.remove("hidden");
    el.style.display = "block";
  });
}

/** Scale each kind sheet so it fits on a single A4 printable area. */
export function fitPermitKindPagesToOneSheet(
  root: ParentNode,
  opts?: { pageWidthMm?: number; pageHeightMm?: number },
): void {
  const pageWmm = opts?.pageWidthMm ?? PAGE_WIDTH_MM;
  const pageHmm = opts?.pageHeightMm ?? PAGE_HEIGHT_MM;
  const mmToPx = 96 / 25.4;
  const maxW = pageWmm * mmToPx;
  const maxH = pageHmm * mmToPx;

  root.querySelectorAll<HTMLElement>(".permit-print-form-page").forEach((page) => {
    page.style.display = "block";
    page.style.width = `${pageWmm}mm`;
    page.style.height = `${pageHmm}mm`;
    page.style.overflow = "hidden";
    page.style.breakAfter = "page";
    page.style.pageBreakAfter = "always";
    page.style.breakInside = "avoid";
    page.style.pageBreakInside = "avoid";
    page.style.position = "relative";

    const sheet =
      (page.querySelector(".standard-permit-sheet") as HTMLElement | null) ||
      (page.querySelector(".dig-permit-form") as HTMLElement | null);
    if (!sheet) return;

    sheet.style.transform = "none";
    sheet.style.width = `${pageWmm}mm`;
    sheet.style.maxWidth = `${pageWmm}mm`;
    sheet.style.boxSizing = "border-box";

    const rect = sheet.getBoundingClientRect();
    const cssH = Number.parseFloat(String(sheet.style.height || "")) || 0;
    const cssW = Number.parseFloat(String(sheet.style.width || "")) || 0;
    const h = Math.max(sheet.scrollHeight, sheet.offsetHeight, rect.height, cssH);
    const w = Math.max(sheet.scrollWidth, sheet.offsetWidth, rect.width, cssW || maxW);
    if (!h || !w) return;

    const scale = Math.min(1, (maxH * 0.995) / h, (maxW * 0.995) / w);
    sheet.style.transformOrigin = "top left";
    sheet.style.transform = `scale(${scale})`;
    // Keep layout box of page fixed; scaled content paints inside overflow:hidden
  });
}

export async function printPermitBundle(opts?: {
  title?: string;
  selector?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const selector = opts?.selector || ".permit-print-job";
  const src = document.querySelector(selector) as HTMLElement | null;
  if (!src) return { ok: false, error: "인쇄할 허가서 영역을 찾지 못했습니다." };

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "permit-print");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument;
  const iwin = iframe.contentWindow;
  if (!idoc || !iwin) {
    iframe.remove();
    return { ok: false, error: "인쇄 프레임을 만들 수 없습니다." };
  }

  const title = opts?.title || document.title || "작업허가서";
  idoc.open();
  idoc.write(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${title.replace(/[<>&"]/g, "")}</title>
${collectHeadHtml()}
<style>
  @page { size: A4 portrait; margin: 6mm; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
    height: auto !important;
    overflow: visible !important;
    display: block !important;
  }
  .permit-print-job {
    display: block !important;
  }
  .permit-print-form-page {
    display: block !important;
    width: ${PAGE_WIDTH_MM}mm;
    height: ${PAGE_HEIGHT_MM}mm;
    overflow: hidden !important;
    break-after: page !important;
    page-break-after: always !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .standard-permit-sheet-wrap,
  .standard-permit-sheet {
    display: block !important;
    position: static !important;
    box-shadow: none !important;
    margin: 0 !important;
    padding: 0 !important;
    min-height: auto !important;
    max-height: none !important;
  }
  .permit-crew-print-root {
    display: block !important;
    break-before: page !important;
    page-break-before: always !important;
  }
  .permit-crew-sheet {
    display: block !important;
    break-after: page !important;
    page-break-after: always !important;
  }
  .permit-crew-sheet:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }
  .print\\:hidden, .no-print { display: none !important; }
</style>
</head>
<body></body>
</html>`);
  idoc.close();

  const clone = src.cloneNode(true) as HTMLElement;
  unhidePrintNodes(clone);
  idoc.body.appendChild(clone);

  // Wait a tick for layout, then scale each kind to one sheet
  await new Promise((r) => setTimeout(r, 50));
  fitPermitKindPagesToOneSheet(idoc);

  try {
    await (idoc as any).fonts?.ready;
  } catch {
    /* ignore */
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    iwin.addEventListener("afterprint", done, { once: true });
    setTimeout(done, 60_000);
    setTimeout(() => {
      try {
        iwin.focus();
        iwin.print();
      } catch {
        resolve();
      }
    }, 300);
  });

  iframe.remove();
  return { ok: true };
}
