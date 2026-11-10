import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MessengerCameraDialogProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  onFallbackInput?: () => void;
}

export function MessengerCameraDialog({
  open,
  onClose,
  onCapture,
  onFallbackInput,
}: MessengerCameraDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: "environment" | "user") => {
      stopStream();
      setErrorMsg(null);
      setStarting(true);

      try {
        // Capacitor 네이티브 환경인 경우 카메라 런타임 권한을 먼저 확인/요청
        const isNative =
          typeof (window as any)?.Capacitor?.isNativePlatform === "function" &&
          (window as any).Capacitor.isNativePlatform();
        if (isNative) {
          try {
            const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
            const perm = await BarcodeScanner.checkPermissions();
            if (perm.camera !== "granted") {
              await BarcodeScanner.requestPermissions();
            }
          } catch {
            // WebChromeClient.onPermissionRequest 에서 자체 처리 가능하므로 무시
          }
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("UNSUPPORTED_MEDIA_DEVICES");
        }

        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (err: any) {
        const name = err?.name || "";
        if (err?.message === "UNSUPPORTED_MEDIA_DEVICES") {
          setErrorMsg("이 기기 브라우저에서는 직접 카메라 미리보기를 지원하지 않습니다.");
        } else if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          setErrorMsg("카메라 권한이 허용되지 않았습니다. 휴대폰 설정에서 카메라 권한을 허용해 주세요.");
        } else if (name === "NotReadableError") {
          setErrorMsg("다른 앱에서 카메라를 사용 중입니다. 잠시 후 다시 시도해 주세요.");
        } else {
          setErrorMsg("카메라를 시작할 수 없습니다.");
        }
      } finally {
        setStarting(false);
      }
    },
    [stopStream],
  );

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    void startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [open, facingMode, startCamera, stopStream]);

  const handleToggleFacing = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  const handleTakePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error("카메라 화면이 아직 준비되지 않았습니다.");
      return;
    }
    setCapturing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");

      if (facingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("사진 파일 생성에 실패했습니다.");

      const fileName = `camera_${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
      const file = new File([blob], fileName, { type: "image/jpeg" });
      stopStream();
      onCapture(file);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "사진 촬영에 실패했습니다.");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md w-[95vw] p-0 overflow-hidden bg-black border-neutral-800 text-white rounded-2xl">
        <DialogTitle className="sr-only">카메라 사진 촬영</DialogTitle>
        <div className="relative flex flex-col h-[75vh] max-h-[640px] bg-black">
          {/* 상단 바 */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/70 z-10">
            <span className="text-sm font-semibold">현장 사진 촬영</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleToggleFacing}
                disabled={starting || capturing}
                className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                title="전면/후면 카메라 전환"
                aria-label="전면/후면 카메라 전환"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 text-white hover:bg-white/20 rounded-full"
                title="닫기"
                aria-label="카메라 닫기"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 뷰파인더 영역 */}
          <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${
                facingMode === "user" ? "scale-x-[-1]" : ""
              }`}
            />

            {starting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white text-sm">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <span>카메라를 켜는 중...</span>
              </div>
            )}

            {errorMsg && !starting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-black/85">
                <p className="text-sm text-neutral-200 leading-relaxed">{errorMsg}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void startCamera(facingMode)}
                  >
                    다시 시도
                  </Button>
                  {onFallbackInput && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        onClose();
                        onFallbackInput();
                      }}
                    >
                      기본 카메라/갤러리 열기
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 하단 촬영 셔터 바 */}
          <div className="flex items-center justify-center py-4 bg-black/80 shrink-0">
            <button
              type="button"
              onClick={() => void handleTakePhoto()}
              disabled={starting || capturing || !!errorMsg}
              className="h-16 w-16 rounded-full border-4 border-white bg-white/20 active:scale-95 transition flex items-center justify-center disabled:opacity-40"
              title="사진 촬영"
              aria-label="사진 촬영"
            >
              {capturing ? (
                <Loader2 className="h-7 w-7 animate-spin text-white" />
              ) : (
                <span className="h-12 w-12 rounded-full bg-white flex items-center justify-center text-black">
                  <Camera className="h-6 w-6" />
                </span>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
