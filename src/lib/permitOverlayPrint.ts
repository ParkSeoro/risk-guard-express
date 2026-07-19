/**
 * 원본 PDF 위에 값을 합성해 인쇄하는 클라이언트 헬퍼.
 * - pdfjs로 원본 PDF의 각 페이지를 canvas에 렌더
 * - print_overlay 의 박스 좌표에 텍스트/체크/서명 이미지를 합성
 * - signature_slots 에 지정된 결재자 서명·이름·일자를 자동 렌더
 * - 결과 canvas들을 새 창의 HTML로 묶어 window.print()
 */
import * as pdfjsLib from 'pdfjs-dist';
import { PrintOverlay, SignatureSlot } from './permitFormTypes';

// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.mjs`;

export interface ApprovedSigner {
  role: string;               // signature_slots[i].role 와 매칭
  slotId?: string;            // 특정 슬롯에 고정하고 싶을 때
  name?: string;
  position?: string;          // 직책 (예: "안전관리자")
  signatureImage?: string;    // data URL 또는 https
  approvedAt?: string;        // ISO
  status?: 'approved' | 'pending' | 'rejected';
}

function formatDate(iso: string | undefined, fmt?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  };
  const f = fmt || 'YYYY-MM-DD';
  return f.replace(/YYYY|MM|DD|HH|mm/g, (k) => map[k] || k);
}

interface RenderOptions {
  pdfUrl: string;
  overlay: PrintOverlay;
  values: Record<string, any>;                            // field_key → 값
  signatures?: Record<string, { signature?: string; name?: string }>; // 레거시: role → 이미지
  signatureSlots?: SignatureSlot[];                       // v2: 서명 슬롯 좌표
  approvedSigners?: ApprovedSigner[];                     // v2: 결재자 정보
  title?: string;
}

function isChecked(value: any, when: any): boolean {
  if (when === undefined || when === null || when === 'true') return value === true || value === 'true' || value === 'Y' || value === 1;
  return String(value) === String(when);
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function printOverlay({
  pdfUrl, overlay, values, signatures = {}, signatureSlots = [], approvedSigners = [], title,
}: RenderOptions) {
  try {
    await (document as any).fonts?.load?.('16px "Noto Sans KR"');
    await (document as any).fonts?.load?.('bold 16px "Noto Sans KR"');
    await (document as any).fonts?.ready;
  } catch {}

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

      const [baseKey, optValue] = b.field_key.split('.');
      let raw = values[baseKey];
      if (optValue !== undefined) {
        if (Array.isArray(raw)) raw = raw.includes(optValue);
        else if (raw && typeof raw === 'object') raw = !!raw[optValue];
        else raw = raw === optValue;
      }

      ctx.save();
      if (b.render === 'check') {
        if (isChecked(raw, b.check_when)) drawCheck(ctx, x, y, w, h);
      } else if (b.render === 'signature') {
        const role = baseKey;
        const sig = signatures[role];
        if (sig?.signature) {
          const img = await loadImage(sig.signature);
          if (img) ctx.drawImage(img, x, y, w, h);
        } else if (sig?.name) {
          drawCenterText(ctx, sig.name, x, y, w, h);
        }
      } else if (b.render === 'image') {
        if (typeof raw === 'string' && raw) {
          const img = await loadImage(raw);
          if (img) ctx.drawImage(img, x, y, w, h);
        }
      } else {
        const text = raw == null ? '' : String(raw);
        if (text) drawText(ctx, text, x, y, w, h, b.font_size || 10, b.align || 'left');
      }
      ctx.restore();
    }

    // ─── 서명 슬롯 자동 렌더 ───
    for (const slot of signatureSlots.filter((s) => s.page === p)) {
      const x = slot.x * canvas.width;
      const y = slot.y * canvas.height;
      const w = slot.w * canvas.width;
      const h = slot.h * canvas.height;

      const signer = approvedSigners.find((a) => a.slotId === slot.id)
        || approvedSigners.find((a) => a.role === slot.role);

      ctx.save();
      if (signer?.status === 'approved' && signer.signatureImage) {
        const img = await loadImage(signer.signatureImage);
        if (img) {
          // 서명 이미지는 슬롯 상단 60%에, 이름·일자는 하단
          const sigH = h * (slot.render_name || slot.render_date ? 0.6 : 1);
          ctx.drawImage(img, x, y, w, sigH);
          drawSignerMeta(ctx, signer, slot, x, y + sigH, w, h - sigH);
        } else if (signer.name) {
          drawSignerAll(ctx, signer, slot, x, y, w, h);
        }
      } else if (signer?.status === 'approved') {
        drawSignerAll(ctx, signer, slot, x, y, w, h);
      } else if (signer) {
        // 대기/반려 워터마크
        ctx.fillStyle = 'rgba(150,150,150,0.35)';
        ctx.font = `bold ${Math.max(12, h * 0.35)}px "Noto Sans KR"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(signer.status === 'rejected' ? '반려' : '미결', x + w / 2, y + h / 2);
      }
      ctx.restore();
    }

    imgs.push(canvas.toDataURL('image/jpeg', 0.9));
  }

  const html = imgs.map((src) => `<div class="page"><img src="${src}" /></div>`).join('');
  win.document.getElementById('root')!.innerHTML = html;
  setTimeout(() => { try { win.focus(); win.print(); } catch {} }, 400);
}

function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(2, h * 0.12);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, y + h * 0.55);
  ctx.lineTo(x + w * 0.4, y + h * 0.85);
  ctx.lineTo(x + w * 0.9, y + h * 0.15);
  ctx.stroke();
}

function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number,
  fontPt: number, align: 'left' | 'center' | 'right',
) {
  ctx.fillStyle = '#000';
  ctx.font = `${fontPt * 2}px "Noto Sans KR", "Malgun Gothic"`;
  ctx.textBaseline = 'middle';
  if (align === 'center') {
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + h / 2, w);
  } else if (align === 'right') {
    ctx.textAlign = 'right';
    ctx.fillText(text, x + w, y + h / 2, w);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 2, y + h / 2, w);
  }
}

function drawCenterText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#000';
  ctx.font = `${Math.max(10, h * 0.5)}px "Noto Sans KR", "Malgun Gothic"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2, w);
}

function drawSignerAll(
  ctx: CanvasRenderingContext2D, signer: ApprovedSigner, slot: SignatureSlot,
  x: number, y: number, w: number, h: number,
) {
  const lines: string[] = [];
  if (signer.name) lines.push(signer.name);
  if (slot.render_date && signer.approvedAt) {
    lines.push(new Date(signer.approvedAt).toLocaleDateString('ko-KR'));
  }
  if (lines.length === 0) return;
  const fh = Math.min(h / lines.length, h * 0.5);
  ctx.fillStyle = '#000';
  ctx.font = `${fh * 0.6}px "Noto Sans KR", "Malgun Gothic"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillText(line, x + w / 2, y + fh * (i + 0.5), w);
  });
}
function drawSignerMeta(
  ctx: CanvasRenderingContext2D, signer: ApprovedSigner, slot: SignatureSlot,
  x: number, y: number, w: number, h: number,
) {
  const lines: string[] = [];
  if (slot.render_name && signer.name) lines.push(signer.name);
  if (slot.render_date && signer.approvedAt) {
    lines.push(new Date(signer.approvedAt).toLocaleDateString('ko-KR'));
  }
  if (!lines.length) return;
  const fh = Math.min(h / lines.length, h * 0.6);
  ctx.fillStyle = '#000';
  ctx.font = `${fh * 0.65}px "Noto Sans KR", "Malgun Gothic"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillText(line, x + w / 2, y + fh * (i + 0.5), w);
  });
}
