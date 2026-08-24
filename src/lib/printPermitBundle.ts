/**
 * Print work-permit forms + crew appendix from an isolated iframe.
 * Escapes AppLayout flex so page breaks work. Does NOT rescale/reshape
 * the DigPermitForm sheet (양식 틀 유지).
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
  root.querySelectorAll<HTMLElement>(".hidden").forEach((el) => {
    if (el.classList.contains("print:hidden")) {
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
  .permit-print-job { display: block !important; }
  .permit-print-form-page {
    display: block !important;
    width: 100%;
    break-after: page !important;
    page-break-after: always !important;
  }
  .standard-permit-sheet-wrap,
  .standard-permit-sheet {
    display: block !important;
    position: static !important;
    box-shadow: none !important;
    margin: 0 auto !important;
    transform: none !important;
  }
  .permit-crew-print-root {
    display: block !important;
    break-before: page !important;
    page-break-before: always !important;
  }
  .permit-crew-sheet {
    display: block !important;
    break-after: auto !important;
    page-break-after: auto !important;
  }
  .permit-crew-sheet + .permit-crew-sheet {
    break-before: page !important;
    page-break-before: always !important;
  }
  .permit-crew-sheet thead { display: table-header-group !important; }
  .permit-crew-sheet tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
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
