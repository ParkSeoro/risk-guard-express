/** PDF 원본을 인쇄용 PNG로 바꾼다. 결재 미리보기는 이 파일을 부르지 않는다. */

const MAX_EDGE = 1600;

export async function rasterizePdfUrlToPngDataUrls(url: string, maxPages = 8): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
  const total = Math.min(pdf.numPages, maxPages);
  const out: string[] = [];
  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_EDGE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
    out.push(canvas.toDataURL('image/png'));
  }
  return out;
}
