/**
 * Work-plan packet: original PDF/image attachments concatenated with pdf-lib.
 * Body HTML is a separate print job (native) or converted only for "save one file".
 */
import { PDFDocument, PageSizes, rgb, StandardFonts } from "pdf-lib";
import { supabase } from "@/integrations/supabase/client";
import { classifyAttachmentFile } from "@/lib/attachmentPreview";
import { waitForDocumentImages } from "@/lib/printHtmlDocument";
import {
  fetchRiskTableFromExcelUrl,
  isExcelMime,
  isRiskAssessmentAttachment,
} from "@/lib/workPlanPrintPrep";

export type PacketAttachmentRow = {
  file_url?: string | null;
  mime_type?: string | null;
  name?: string | null;
  attachment_key?: string | null;
};

export type PacketFile = {
  url: string;
  mime: string;
  name: string;
  key: string;
  kind: "pdf" | "image";
};

export function collectPrintableAttachments(
  rows: PacketAttachmentRow[],
  skipKeys: string[] = [],
): PacketFile[] {
  const skip = new Set(skipKeys.map((k) => String(k || "").trim()).filter(Boolean));
  const out: PacketFile[] = [];
  for (const row of rows) {
    const url = String(row.file_url || "").trim();
    if (!url) continue;
    const key = String(row.attachment_key || "").trim();
    if (key && skip.has(key)) continue;
    if (isRiskAssessmentAttachment(row) && isExcelMime(row.mime_type || "", url)) continue;
    const kind = classifyAttachmentFile({ url, mime: row.mime_type, name: row.name });
    if (kind !== "pdf" && kind !== "image") continue;
    out.push({
      url,
      mime: String(row.mime_type || ""),
      name: String(row.name || key || "첨부파일"),
      key,
      kind,
    });
  }
  return out;
}

export function workPlanPacketFileName(title: string): string {
  const safe = String(title || "작업계획서").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80).trim() || "작업계획서";
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${safe}_${yy}${mm}${dd}.pdf`;
}

export async function loadWorkPlanPacketFiles(planId: string): Promise<{
  files: PacketFile[];
  skipKeys: string[];
}> {
  const { data: atts, error } = await supabase
    .from("work_plan_attachments")
    .select("file_url, mime_type, attachment_key, name")
    .eq("work_plan_id", planId)
    .eq("is_deleted", false)
    .order("is_mandatory", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = atts || [];
  const skipKeys: string[] = [];
  const raExcel = rows.find(
    (a) =>
      a.file_url &&
      isRiskAssessmentAttachment(a) &&
      isExcelMime(a.mime_type || "", a.file_url),
  );
  if (raExcel?.file_url) {
    const table = await fetchRiskTableFromExcelUrl(raExcel.file_url);
    if (table) skipKeys.push(String(raExcel.attachment_key || "risk_assessment"));
  }
  return { files: collectPrintableAttachments(rows, skipKeys), skipKeys };
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`첨부 다운로드 실패 (${res.status})`);
  return res.arrayBuffer();
}

async function addNoticePage(packet: PDFDocument, title: string, detail: string) {
  const page = packet.addPage(PageSizes.A4);
  const font = await packet.embedFont(StandardFonts.Helvetica);
  page.drawText(title.slice(0, 80), { x: 48, y: 780, size: 14, font, color: rgb(0.12, 0.16, 0.23) });
  page.drawText(detail.slice(0, 180), { x: 48, y: 752, size: 10, font, color: rgb(0.4, 0.45, 0.52) });
}

async function embedRasterOnA4(packet: PDFDocument, bytes: ArrayBuffer, mime: string) {
  const lower = (mime || "").toLowerCase();
  let image;
  try {
    if (lower.includes("png")) image = await packet.embedPng(bytes);
    else image = await packet.embedJpg(bytes);
  } catch {
    const blob = new Blob([bytes]);
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 그릴 수 없습니다.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const jpeg = await new Promise<ArrayBuffer>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) reject(new Error("JPEG 변환 실패"));
          else void b.arrayBuffer().then(resolve, reject);
        },
        "image/jpeg",
        0.92,
      );
    });
    image = await packet.embedJpg(jpeg);
  }
  const page = packet.addPage(PageSizes.A4);
  const { width: pw, height: ph } = page.getSize();
  const margin = 24;
  const maxW = pw - margin * 2;
  const maxH = ph - margin * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: (pw - w) / 2,
    y: (ph - h) / 2,
    width: w,
    height: h,
  });
}

export async function mergeOriginalAttachmentsPdf(files: PacketFile[]): Promise<Uint8Array | null> {
  if (files.length === 0) return null;
  const packet = await PDFDocument.create();
  let added = 0;
  for (const file of files) {
    try {
      const buf = await fetchBytes(file.url);
      if (file.kind === "pdf") {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const copied = await packet.copyPages(src, src.getPageIndices());
        copied.forEach((p) => packet.addPage(p));
        added += copied.length;
      } else {
        await embedRasterOnA4(packet, buf, file.mime);
        added += 1;
      }
    } catch (e) {
      console.warn("packet attach failed", file.name, e);
      await addNoticePage(
        packet,
        file.name,
        e instanceof Error ? e.message : "원본을 이 묶음에 넣지 못했습니다. 첨부 탭에서 열어 주세요.",
      );
      added += 1;
    }
  }
  if (added === 0) return null;
  return packet.save();
}

/** A4 portrait height for a given CSS width (210×297 mm). */
export function a4PortraitHeightPx(widthPx: number): number {
  return Math.max(1, Math.round(widthPx * (297 / 210)));
}

export function a4SliceCount(contentHeightPx: number, pageHeightPx: number): number {
  if (pageHeightPx <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(1, contentHeightPx) / pageHeightPx));
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error("JPEG 변환 실패"));
        else void b.arrayBuffer().then(resolve, reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

function sliceCanvas(src: HTMLCanvasElement, y: number, height: number): HTMLCanvasElement {
  const h = Math.max(1, Math.min(height, src.height - y));
  const slice = document.createElement("canvas");
  slice.width = src.width;
  slice.height = h;
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("본문 페이지를 자를 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(src, 0, y, src.width, h, 0, 0, src.width, h);
  return slice;
}

/**
 * Body HTML → A4 PDF pages.
 * One html2canvas of the full body, then slice into A4-tall strips (top-aligned).
 * Avoids packing the whole document onto one oversized page.
 */
export async function htmlToPdfBytes(html: string): Promise<Uint8Array> {
  const html2canvas = (await import("html2canvas")).default;
  const width = 794;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    `position:fixed;left:-14000px;top:0;width:${width}px;height:1123px;border:0;opacity:0;pointer-events:none;`;
  document.body.appendChild(iframe);
  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error("본문 PDF 프레임을 만들 수 없습니다.");
    idoc.open();
    idoc.write(html);
    idoc.close();
    await waitForDocumentImages(idoc);
    await new Promise((r) => setTimeout(r, 400));
    const contentH = Math.max(
      idoc.documentElement?.scrollHeight || 0,
      idoc.body?.scrollHeight || 0,
      1123,
    );
    iframe.style.height = `${contentH}px`;
    const canvas = await html2canvas(idoc.body, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      width,
      windowWidth: width,
      height: contentH,
      windowHeight: contentH,
      logging: false,
      onclone: (cloned) => {
        cloned.documentElement.style.background = "#ffffff";
        cloned.body.style.background = "#ffffff";
        cloned.body.style.margin = "0";
        cloned.body.style.width = `${width}px`;
      },
    });

    const pageCssH = a4PortraitHeightPx(width);
    const slicePx = Math.max(1, Math.round(pageCssH * (canvas.width / width)));
    const pages = a4SliceCount(canvas.height, slicePx);
    const packet = await PDFDocument.create();

    for (let i = 0; i < pages; i++) {
      const y = i * slicePx;
      const slice = sliceCanvas(canvas, y, slicePx);
      const jpeg = await canvasToJpeg(slice);
      const image = await packet.embedJpg(jpeg);
      const page = packet.addPage(PageSizes.A4);
      const { width: pw, height: ph } = page.getSize();
      const margin = 18;
      const maxW = pw - margin * 2;
      const maxH = ph - margin * 2;
      const fit = Math.min(maxW / image.width, maxH / image.height);
      const w = image.width * fit;
      const h = image.height * fit;
      page.drawImage(image, {
        x: margin + (maxW - w) / 2,
        y: ph - margin - h,
        width: w,
        height: h,
      });
    }
    return packet.save();
  } finally {
    iframe.remove();
  }
}

export async function concatPdfBytes(parts: Uint8Array[]): Promise<Uint8Array> {
  const packet = await PDFDocument.create();
  for (const part of parts) {
    if (!part?.length) continue;
    const src = await PDFDocument.load(part);
    const copied = await packet.copyPages(src, src.getPageIndices());
    copied.forEach((p) => packet.addPage(p));
  }
  if (packet.getPageCount() === 0) {
    throw new Error("저장할 PDF 페이지가 없습니다.");
  }
  return packet.save();
}

export async function buildWorkPlanPacketPdf(opts: {
  bodyHtml: string;
  files: PacketFile[];
}): Promise<Uint8Array> {
  const body = await htmlToPdfBytes(opts.bodyHtml);
  const atts = await mergeOriginalAttachmentsPdf(opts.files);
  if (!atts) return body;
  return concatPdfBytes([body, atts]);
}

export function downloadPdfBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export async function printPdfBytes(
  bytes: Uint8Array,
  opts?: { title?: string; waitForAfterPrint?: boolean },
): Promise<void> {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = opts?.title || "첨부 원본";
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* already removed */
    }
    URL.revokeObjectURL(url);
  };

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    setTimeout(() => resolve(), 4000);
  });

  const win = iframe.contentWindow;
  if (!win) {
    cleanup();
    throw new Error("PDF 인쇄 프레임을 열 수 없습니다.");
  }

  win.focus();
  if (opts?.waitForAfterPrint) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      win.addEventListener("afterprint", done, { once: true });
      win.print();
      setTimeout(done, 120_000);
    });
    cleanup();
    return;
  }
  win.print();
  setTimeout(cleanup, 2000);
}
