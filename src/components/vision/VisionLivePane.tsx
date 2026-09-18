import { useEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { visionSafePlaybackUrl } from "@/lib/visionFleetApi";

type Props = {
  index: number;
  name?: string;
  cameraId?: string;
  healthState?: string | null;
  playbackUrl?: string | null;
};

export default function VisionLivePane({
  index,
  name,
  cameraId,
  healthState,
  playbackUrl,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const safeUrl = visionSafePlaybackUrl(playbackUrl);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!safeUrl) {
      video.removeAttribute("src");
      return;
    }

    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    const attach = async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = safeUrl;
        await video.play().catch(() => undefined);
        return;
      }
      if (/\.m3u8(\?|$)/i.test(safeUrl) || safeUrl.includes("application/vnd.apple.mpegurl")) {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (Hls.isSupported()) {
          const player = new Hls({ maxBufferLength: 12, enableWorker: true });
          player.loadSource(safeUrl);
          player.attachMedia(video);
          hls = player;
          await video.play().catch(() => undefined);
          return;
        }
      }
      video.src = safeUrl;
      await video.play().catch(() => undefined);
    };

    void attach();
    return () => {
      cancelled = true;
      hls?.destroy();
      video.removeAttribute("src");
    };
  }, [safeUrl]);

  const label = name || `카메라 ${index + 1}`;
  const waiting = !safeUrl;

  return (
    <div
      className="relative overflow-hidden rounded-md border bg-black min-h-[160px] aspect-video"
      data-testid={`vision-pane-${index}`}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        playsInline
        autoPlay
        controls={Boolean(safeUrl)}
      />
      {waiting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
          <WifiOff className="h-5 w-5" />
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-white/60">송출 대기 · 고화질 4화면</p>
        </div>
      )}
      {!waiting && (
        <div className="absolute left-0 right-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
          <p className="text-xs text-white font-medium truncate">{label}</p>
          <p className="text-[10px] text-white/70 truncate">
            {cameraId || ""} {healthState ? `· ${healthState}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
