import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

function buildStorageDownloadUrl(url: string, fileName: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("download")) {
      u.searchParams.set("download", fileName);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Downloads a cross-origin chat attachment with its original filename.
 * On Android/iOS Capacitor WebView, <a download> on blob: URLs is ignored,
 * so we open the Supabase Storage `?download=` URL in the OS browser/sheet.
 */
export async function downloadChatAttachment(
  url: string,
  fileName?: string | null,
): Promise<void> {
  const safeName = fileName?.trim() || "safenex-attachment";

  if (Capacitor.isNativePlatform()) {
    const downloadUrl = buildStorageDownloadUrl(url, safeName);
    const opened = window.open(downloadUrl, "_system") || window.open(downloadUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.href = downloadUrl;
    }
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch {
    window.open(buildStorageDownloadUrl(url, safeName), "_blank", "noopener,noreferrer");
  }
}

/**
 * Copies an image attachment to the OS clipboard as image/png.
 */
export async function copyChatImageToClipboard(url: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    toast.error("이 기기에서는 이미지 복사가 지원되지 않습니다. 저장 버튼을 이용해 주세요.");
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const srcBlob = await res.blob();

    let pngBlob: Blob = srcBlob;
    if (srcBlob.type !== "image/png") {
      const imgUrl = URL.createObjectURL(srcBlob);
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image decode failed"));
          img.src = imgUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable");
        ctx.drawImage(img, 0, 0);
        pngBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
            "image/png",
          );
        });
      } finally {
        URL.revokeObjectURL(imgUrl);
      }
    }

    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": pngBlob }),
    ]);
    toast.success("이미지가 클립보드에 복사되었습니다.");
  } catch (err) {
    console.warn("copyChatImageToClipboard failed:", err);
    toast.error("이미지 복사에 실패했습니다. 저장 버튼을 이용해 주세요.");
  }
}
