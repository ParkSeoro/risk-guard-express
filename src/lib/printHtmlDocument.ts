/**
 * Print/save HTML documents that embed remote images (Storage PNGs).
 * Must wait for images — otherwise Chrome prints blank attachment pages.
 */

export function waitForDocumentImages(
  doc: Document,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const images = Array.from(doc.images || []);
  if (images.length === 0) return Promise.resolve();

  const pending = images.map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve();
          return;
        }
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }),
  );

  return Promise.race([
    Promise.all(pending).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Hidden iframe print — waits for images, then window.print(). */
export async function printHtmlDocument(
  html: string,
  opts?: { title?: string; settleMs?: number; waitForAfterPrint?: boolean },
): Promise<void> {
  const desiredTitle = opts?.title || "문서";
  const settleMs = opts?.settleMs ?? 300;
  const waitForAfterPrint = opts?.waitForAfterPrint === true;
  const prevTitle = document.title;
  document.title = desiredTitle;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const cleanup = () => {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* already removed */
    }
    document.title = prevTitle;
  };

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      cleanup();
      throw new Error("인쇄 프레임을 만들 수 없습니다.");
    }
    doc.open();
    doc.write(html);
    doc.close();
    try {
      doc.title = desiredTitle;
    } catch {
      /* ignore */
    }

    await waitForDocumentImages(doc);
    await new Promise((r) => setTimeout(r, settleMs));
    const win = iframe.contentWindow;
    win?.focus();
    if (waitForAfterPrint && win) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        win.addEventListener("afterprint", done, { once: true });
        win.print();
        setTimeout(done, 120_000);
      });
      cleanup();
      return;
    }
    win?.print();
    // Keep iframe briefly so the print dialog can snapshot layout.
    setTimeout(cleanup, 1500);
  } catch (e) {
    cleanup();
    throw e;
  }
}
