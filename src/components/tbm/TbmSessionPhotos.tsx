import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { openAttachmentUrl } from "@/lib/attachmentPreview";
import { buildProjectAttachmentPath, uploadAttachmentFile } from "@/lib/compressUploadFile";
import { TBM_MAX_PHOTOS, parseTbmPhotoUrls } from "@/lib/tbmPhotos";

export function TbmSessionPhotos({
  projectId,
  sessionId,
  urls,
  onUrlsChange,
  editable = false,
}: {
  projectId: string;
  sessionId: string;
  urls: unknown;
  onUrlsChange?: (next: string[]) => void;
  editable?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const photos = parseTbmPhotoUrls(urls);

  async function persist(next: string[]) {
    const { error } = await supabase
      .from("tbm_sessions" as any)
      .update({ photo_urls: next } as any)
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
    onUrlsChange?.(next);
  }

  async function onPick(files: FileList | null) {
    if (!editable || !files?.length) return;
    const incoming = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name),
    );
    if (!incoming.length) {
      toast.error("이미지 파일만 첨부할 수 있습니다");
      return;
    }
    const room = TBM_MAX_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error(`실시 사진은 최대 ${TBM_MAX_PHOTOS}장입니다`);
      return;
    }
    setBusy(true);
    try {
      const next = [...photos];
      for (const file of incoming.slice(0, room)) {
        const path = buildProjectAttachmentPath(projectId, "tbm", file.name || "tbm.jpg");
        const uploaded = await uploadAttachmentFile(path, file);
        next.push(uploaded.publicUrl);
      }
      await persist(next);
      toast.success("실시 사진을 저장했습니다");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "사진 업로드에 실패했습니다");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (albumRef.current) albumRef.current.value = "";
    }
  }

  async function removeAt(idx: number) {
    if (!editable) return;
    setBusy(true);
    try {
      await persist(photos.filter((_, i) => i !== idx));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "사진 삭제에 실패했습니다");
    } finally {
      setBusy(false);
    }
  }

  if (!editable && photos.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          실시 사진 {photos.length}/{TBM_MAX_PHOTOS}
        </p>
        {editable && (
          <div className="flex gap-1">
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
            />
            <input
              ref={albumRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || photos.length >= TBM_MAX_PHOTOS}
              onClick={() => cameraRef.current?.click()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              <span className="ml-1">촬영</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || photos.length >= TBM_MAX_PHOTOS}
              onClick={() => albumRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              <span className="ml-1">앨범</span>
            </Button>
          </div>
        )}
      </div>
      {photos.length === 0 ? (
        editable ? (
          <p className="text-[11px] text-muted-foreground">TBM 실시 현장 사진을 최대 {TBM_MAX_PHOTOS}장 첨부하세요.</p>
        ) : null
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((url, i) => (
            <div key={`${url}-${i}`} className="relative aspect-square overflow-hidden rounded border bg-muted">
              <button
                type="button"
                className="h-full w-full"
                onClick={() => openAttachmentUrl(url)}
                aria-label="실시 사진 보기"
              >
                <img src={url} alt="TBM 실시 사진" className="h-full w-full object-cover" />
              </button>
              {editable && (
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded-full bg-background/90 border p-0.5"
                  onClick={() => removeAt(i)}
                  disabled={busy}
                  aria-label="사진 삭제"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
