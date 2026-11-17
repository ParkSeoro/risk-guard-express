import { toast } from "sonner";

/**
 * Downloads a cross-origin chat attachment with its original filename.
 * Falls back to opening the URL in a new tab if fetch/CORS fails.
 */
export async function downloadChatAttachment(
  url: string,
  fileName?: string | null,
): Promise<void> {
  const safeName = fileName?.trim() || "safenex-attachment";
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
    window.open(url, "_blank", "noopener,noreferrer");
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
    toast.error("이 환경에서는 이미지 클립보드 복사를 지원하지 않습니다.");
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
    toast.error("이미지 복사에 실패했습니다. 다운로드를 이용해 주세요.");
  }
}
