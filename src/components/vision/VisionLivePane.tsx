import { useEffect, useRef } from "react";
import { Maximize2, WifiOff } from "lucide-react";
import { visionSafePlaybackUrl } from "@/lib/visionFleetApi";

type Props = {
  index: number;
  name?: string;
  cameraId?: string;
  healthState?: string | null;
  playbackUrl?: string | null;
  waitingHint?: string;
};

export default function VisionLivePane({
  index,
  name,
  cameraId,
  healthState,
  playbackUrl,
  waitingHint = "송출 대기 · 고화질 4화면",
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
          const player = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 6,
            maxBufferLength: 4,
            maxMaxBufferLength: 8,
            backBufferLength: 8,
          });
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

  const enterFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    const node = video.parentElement || video;
    const req =
      node.requestFullscreen ||
      (node as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
    void req?.call(node);
  };

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
          <p className="text-[11px] text-white/60">{waitingHint}</p>
        </div>
      )}
      {!waiting && (
        <>
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-2 py-1.5"
            data-testid={`vision-pane-overlay-${index}`}
          >
            <p className="text-xs text-white font-medium truncate">{label}</p>
            <p className="text-[10px] text-white/70 truncate">
              {cameraId || ""} {healthState ? `· ${healthState}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="absolute right-1.5 top-1.5 z-10 h-7 w-7 rounded bg-black/60 text-white hover:bg-black/80"
            aria-label="전체화면"
            data-testid={`vision-pane-fullscreen-${index}`}
            onClick={enterFullscreen}
          >
            <Maximize2 className="mx-auto h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
