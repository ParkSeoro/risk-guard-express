/**
 * 원본 PDF 위에 값을 합성해 인쇄하는 클라이언트 헬퍼.
 * - pdfjs로 원본 PDF의 각 페이지를 canvas에 렌더
 * - print_overlay 의 박스 좌표에 텍스트/체크/서명 이미지를 합성
 * - 결과 canvas들을 새 창의 HTML로 묶어 window.print()
 */
import * as pdfjsLib from 'pdfjs-dist';
import { PrintOverlay } from './permitFormTypes';

// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

interface RenderOptions {
  pdfUrl: string;
  overlay: PrintOverlay;
  values: Record<string, any>; // field_key → 값
  signatures?: Record<string, { signature?: string; name?: string }>; // role → 이미지
  title?: string;
}

function isChecked(value: any, when: any): boolean {
  if (when === undefined || when === null || when === 'true') return value === true || value === 'true' || value === 'Y' || value === 1;
  return String(value) === String(when);
}

export async function printOverlay({ pdfUrl, overlay, values, signatures = {}, title }: RenderOptions) {
  // 폰트 로딩 보장 (한글 깨짐 방지)
  try {
    await (document as any).fonts?.load?.('16px "Noto Sans KR"');
    await (document as any).fonts?.load?.('bold 16px "Noto Sans KR"');
    await (document as any).fonts?.ready;
  } catch {}

  // 새 창 미리 열기(사용자 제스처 컨텍스트 유지)
  const win = window.open('', '_blank');
  if (!win) {
    alert('팝업이 차단되었습니다. 팝업을 허용해 주세요.');
    return;
  }
  win.document.write(`<html><head><title>${title || '허가서 인쇄'}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" />
    <style>
      @page { size: A4; margin: 0; }
      body { margin: 0; font-family: 'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', sans-serif; }
      .page { page-break-after: always; display: block; width: 100%; }
      img { display:block; width:100%; height:auto; }
    </style>
  </head><body><div id="root">로딩 중...</div></body></html>`);

  const res = await fetch(pdfUrl);
  const buf = await res.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;

  const imgs: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

    const pageBoxes = overlay.pages.find((pg) => pg.page === p)?.boxes || [];
    for (const b of pageBoxes) {
      const x = b.x * canvas.width;
      const y = b.y * canvas.height;
      const w = b.w * canvas.width;
      const h = b.h * canvas.height;

      // 그룹 필드 지원: 'fieldKey.optValue'
      const [baseKey, optValue] = b.field_key.split('.');
      let raw = values[baseKey];
      if (optValue !== undefined) {
        if (Array.isArray(raw)) raw = raw.includes(optValue);
        else if (raw && typeof raw === 'object') raw = !!raw[optValue];
        else raw = raw === optValue;
      }

      ctx.save();
      if (b.render === 'check') {
        if (isChecked(raw, b.check_when)) {
          ctx.strokeStyle = '#000';
          ctx.lineWidth = Math.max(2, h * 0.12);
          ctx.beginPath();
          ctx.moveTo(x + w * 0.1, y + h * 0.55);
          ctx.lineTo(x + w * 0.4, y + h * 0.85);
          ctx.lineTo(x + w * 0.9, y + h * 0.15);
          ctx.stroke();
        }
      } else if (b.render === 'signature') {
        const role = baseKey; // signature 필드의 key를 role로 사용한다고 가정
        const sig = signatures[role];
        if (sig?.signature) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve) => {
            img.onload = () => {
              ctx.drawImage(img, x, y, w, h);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = sig.signature!;
          });
        } else if (sig?.name) {
          ctx.fillStyle = '#000';
          ctx.font = `${Math.max(10, h * 0.5)}px "Malgun Gothic"`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sig.name, x + w / 2, y + h / 2);
        }
      } else if (b.render === 'image') {
        if (typeof raw === 'string' && raw) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve) => {
            img.onload = () => { ctx.drawImage(img, x, y, w, h); resolve(); };
            img.onerror = () => resolve();
            img.src = raw;
          });
        }
      } else {
        // text
        const text = raw == null ? '' : String(raw);
        if (text) {
          const fontPx = (b.font_size || 10) * 2; // scale 2와 일치
          ctx.fillStyle = '#000';
          ctx.font = `${fontPx}px "Malgun Gothic"`;
          ctx.textBaseline = 'middle';
          if (b.align === 'center') {
            ctx.textAlign = 'center';
            ctx.fillText(text, x + w / 2, y + h / 2, w);
          } else if (b.align === 'right') {
            ctx.textAlign = 'right';
            ctx.fillText(text, x + w, y + h / 2, w);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(text, x + 2, y + h / 2, w);
          }
        }
      }
      ctx.restore();
    }
    imgs.push(canvas.toDataURL('image/jpeg', 0.9));
  }

  const html = imgs.map((src) => `<div class="page"><img src="${src}" /></div>`).join('');
  win.document.getElementById('root')!.innerHTML = html;
  // 약간 대기 후 print
  setTimeout(() => {
    try { win.focus(); win.print(); } catch {}
  }, 400);
}
