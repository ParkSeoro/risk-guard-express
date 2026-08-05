/**
 * Print work-permit forms + crew appendix from an isolated iframe.
 *
 * Why: AppLayout (and many shells) use display:flex. Chrome ignores
 * page-break-* inside flex/grid, so the 을지 stuck to the form and rows
 * were clipped. Printing from a block-only iframe restores hard page breaks.
 */

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
  root.querySelectorAll<HTMLElement>(".hidden, .print\\:block, .print\\:hidden").forEach((el) => {
    if (el.classList.contains("print:hidden") || el.classList.contains("print\\:hidden")) {
      el.style.display = "none";
      return;
    }
    el.classList.remove("hidden");
    el.style.display = "block";
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
  @page { size: A4 portrait; margin: 8mm; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
    height: auto !important;
    overflow: visible !important;
    display: block !important;
  }
  body, body * {
    float: none !important;
  }
  /* Flatten any leftover flex from cloned app styles */
  .flex, .flex-1, .flex-col, .inline-flex,
  [class*="flex-"] {
    display: block !important;
  }
  .permit-print-job,
  .permit-print-form-page,
  .permit-crew-print-root,
  .permit-crew-sheet,
  .standard-permit-sheet-wrap,
  .standard-permit-sheet {
    display: block !important;
    position: static !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    box-shadow: none !important;
    transform: none !important;
  }
  .permit-print-form-page {
    break-after: page !important;
    page-break-after: always !important;
  }
  .permit-crew-print-root {
    break-before: page !important;
    page-break-before: always !important;
  }
  .permit-crew-sheet {
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

  try {
    await (idoc as any).fonts?.ready;
  } catch {
    /* ignore */
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    iwin.addEventListener("afterprint", done, { once: true });
    // Fallback if afterprint is skipped
    setTimeout(done, 60_000);
    setTimeout(() => {
      try {
        iwin.focus();
        iwin.print();
      } catch {
        resolve();
      }
    }, 250);
  });

  iframe.remove();
  return { ok: true };
}
