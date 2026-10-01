import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { VISION_LIVE_IDLE_MS, visionSafePlaybackUrl } from "@/lib/visionFleetApi";
import { explainVisionPlayback, VISION_OFFLINE, type VisionOfflineCopy } from "@/lib/visionPlaybackFailure";
import { captureVisionFrame } from "@/lib/visionFrame";

type Props = {
  index: number;
  name?: string;
  cameraId?: string;
  healthState?: string | null;
  playbackUrl?: string | null;
  waitingHint?: string;
  idleMs?: number;
  /** How long to wait for a real picture before saying the camera is not publishing. */
  connectMs?: number;
};

const ZOOMS = [1, 1.5, 2, 3] as const;
const PAN_STEP = 0.35;
const DEFAULT_CONNECT_MS = 30_000;

type Pan = { x: number; y: number };

function clampUnit(n: number) {
  return Math.max(-1, Math.min(1, n));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function playVideo(video: HTMLVideoElement) {
  try {
    const pending = video.play();
    if (pending && typeof pending.catch === "function") await pending.catch(() => undefined);
  } catch {
    /* autoplay blocked, or jsdom has no media playback */
  }
}

type FullscreenNode = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  captureStream?: () => MediaStream;
};

function currentFullscreenElement() {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

export default function VisionLivePane({
  index,
  name,
  cameraId,
  healthState,
  playbackUrl,
  waitingHint = "송출 대기",
  idleMs = VISION_LIVE_IDLE_MS,
  connectMs = DEFAULT_CONNECT_MS,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [offline, setOffline] = useState(false);
  const [offlineCopy, setOfflineCopy] = useState<VisionOfflineCopy | null>(null);
  const [live, setLive] = useState(false);
  const [held, setHeld] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [retry, setRetry] = useState(0);
  const safeUrl = visionSafePlaybackUrl(playbackUrl);
  const zoom = ZOOMS[zoomIndex];
  const panPct = ((zoom - 1) / 2) * 100;

  useEffect(() => {
    setPaused(false);
    setOffline(false);
    setOfflineCopy(null);
    setHeld(false);
    setLive(false);
    setZoomIndex(0);
    setPan({ x: 0, y: 0 });
  }, [safeUrl]);

  useEffect(() => {
    if (!safeUrl || paused) return;
    const timer = window.setTimeout(() => {
      setHeld(false);
      setPaused(true);
    }, idleMs);
    return () => window.clearTimeout(timer);
  }, [safeUrl, paused, idleMs, retry]);

  useEffect(() => {
    const video = videoRef.current;
    const sync = () => {
      const shell = shellRef.current;
      const media = video as FullscreenVideo | null;
      const current = currentFullscreenElement();
      setFullscreen(Boolean((shell && current === shell) || media?.webkitDisplayingFullscreen));
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    video?.addEventListener("webkitbeginfullscreen", sync);
    video?.addEventListener("webkitendfullscreen", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
      video?.removeEventListener("webkitbeginfullscreen", sync);
      video?.removeEventListener("webkitendfullscreen", sync);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
  }, [muted, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLive(false);
    if (!safeUrl || paused) {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* jsdom does not implement HTMLMediaElement.load */
      }
      return;
    }

    let cancelled = false;
    let generation = 0;
    let reloadTimer = 0;
    let hls: { destroy: () => void } | null = null;
    let deadline = 0;
    let sawPicture = false;
    let extended = false;
    const markOffline = () => {
      if (cancelled || sawPicture) return;
      void explainVisionPlayback(safeUrl).then((reason) => {
        if (cancelled || sawPicture) return;
        if (reason === "starting" && !extended) {
          extended = true;
          deadline = window.setTimeout(markOffline, connectMs);
          return;
        }
        setOfflineCopy(reason === "starting" ? VISION_OFFLINE.picture : reason);
        setOffline(true);
      });
    };
    const onFrame = () => {
      if (cancelled) return;
      if (video.videoWidth <= 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      sawPicture = true;
      setLive(true);
      setOffline(false);
      window.clearTimeout(deadline);
    };
    const scheduleReload = () => {
      if (cancelled || reloadTimer) return;
      reloadTimer = window.setTimeout(() => {
        reloadTimer = 0;
        if (!cancelled) void attach();
      }, 4000);
    };
    const onVideoError = () => {
      if (!cancelled) scheduleReload();
    };

    video.addEventListener("playing", onFrame);
    video.addEventListener("loadeddata", onFrame);
    video.addEventListener("resize", onFrame);
    video.addEventListener("timeupdate", onFrame);
    video.addEventListener("error", onVideoError);
    deadline = window.setTimeout(markOffline, connectMs);

    const attach = async () => {
      const token = ++generation;
      hls?.destroy();
      hls = null;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = safeUrl;
        await playVideo(video);
        return;
      }
      if (/\.m3u8(\?|$)/i.test(safeUrl) || safeUrl.includes("application/vnd.apple.mpegurl")) {
        const { default: Hls } = await import("hls.js");
        if (cancelled || token !== generation) return;
        if (Hls.isSupported()) {
          const player = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            liveSyncDurationCount: 4,
            liveMaxLatencyDurationCount: 10,
            maxBufferLength: 12,
            maxMaxBufferLength: 20,
            backBufferLength: 8,
          });
          player.on(Hls.Events.ERROR, (_event: string, data: { fatal?: boolean; type?: string }) => {
            if (!data?.fatal || cancelled || token !== generation) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              player.startLoad();
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              player.recoverMediaError();
              return;
            }
            scheduleReload();
          });
          player.loadSource(safeUrl);
          player.attachMedia(video);
          hls = player;
          if (cancelled || token !== generation) return;
          await playVideo(video);
          return;
        }
      }
      if (cancelled || token !== generation) return;
      video.src = safeUrl;
      await playVideo(video);
    };

    void attach();
    return () => {
      cancelled = true;
      generation += 1;
      window.clearTimeout(deadline);
      window.clearTimeout(reloadTimer);
      video.removeEventListener("playing", onFrame);
      video.removeEventListener("loadeddata", onFrame);
      video.removeEventListener("resize", onFrame);
      video.removeEventListener("timeupdate", onFrame);
      video.removeEventListener("error", onVideoError);
      hls?.destroy();
      video.srcObject = null;
      const rec = recorderRef.current;
      if (rec && rec.state === "recording") {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
        recorderRef.current = null;
      }
      video.removeAttribute("src");
    };
  }, [safeUrl, paused, retry, connectMs]);

  const toggleFullscreen = async () => {
    const node = shellRef.current;
    const video = videoRef.current as FullscreenVideo | null;
    try {
      if (video?.webkitDisplayingFullscreen) {
        video.webkitExitFullscreen?.();
        return;
      }
      if (currentFullscreenElement()) {
        const doc = document as FullscreenDocument;
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
        return;
      }
      const target = node as FullscreenNode | null;
      if (target?.requestFullscreen) {
        await target.requestFullscreen();
        return;
      }
      if (target?.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
        return;
      }
      if (video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
        return;
      }
      toast.error("이 브라우저에서는 전체화면을 지원하지 않습니다");
    } catch {
      toast.error("전체화면을 바꾸지 못했습니다");
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (held) {
      setHeld(false);
      void playVideo(video);
      return;
    }
    try {
      video.pause();
    } catch {
      /* jsdom has no media playback */
    }
    setHeld(true);
  };

  const toggleMute = () => {
    const next = !muted;
    if (!next && volume === 0) setVolume(1);
    setMuted(next);
  };

  const onVolume = (value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    if (next <= 0) {
      setMuted(true);
      return;
    }
    setVolume(next);
    setMuted(false);
  };

  const takeSnapshot = async () => {
    const video = videoRef.current;
    if (!video) return;
    const frame = await captureVisionFrame(video);
    if (!frame) {
      toast.error("아직 저장할 화면이 없습니다");
      return;
    }
    downloadBlob(frame.blob, `${name || "cctv"}-${Date.now()}.jpg`);
  };

  const toggleRecord = () => {
    const video = videoRef.current as FullscreenVideo | null;
    if (!video) return;
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    if (!video.captureStream || typeof MediaRecorder === "undefined") {
      toast.error("이 브라우저에서는 녹화를 지원하지 않습니다");
      return;
    }
    let stream: MediaStream;
    try {
      stream = video.captureStream();
    } catch {
      toast.error("이 브라우저에서는 녹화를 지원하지 않습니다");
      return;
    }
    const mime = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(
      (type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type),
    );
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      toast.error("이 브라우저에서는 녹화를 지원하지 않습니다");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    rec.onstop = () => {
      setRecording(false);
      recorderRef.current = null;
      if (chunks.length === 0) return;
      downloadBlob(new Blob(chunks, { type: rec.mimeType || "video/webm" }), `${name || "cctv"}-${Date.now()}.webm`);
    };
    try {
      rec.start();
    } catch {
      toast.error("이 브라우저에서는 녹화를 지원하지 않습니다");
      return;
    }
    recorderRef.current = rec;
    setRecording(true);
  };

  const openPip = async () => {
    const video = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!video?.requestPictureInPicture) {
      toast.error("이 브라우저에서는 작은 창을 지원하지 않습니다");
      return;
    }
    try {
      await video.requestPictureInPicture();
    } catch {
      toast.error("작은 창을 열지 못했습니다");
    }
  };

  const nudge = (dx: number, dy: number) => {
    if (zoomIndex === 0) setZoomIndex(1);
    setPan((prev) => ({ x: clampUnit(prev.x + dx), y: clampUnit(prev.y + dy) }));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLVideoElement>) => {
    if (zoom <= 1) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLVideoElement>) => {
    const start = dragRef.current;
    const shell = shellRef.current;
    if (!start || !shell || zoom <= 1) return;
    const rect = shell.getBoundingClientRect();
    const maxX = ((zoom - 1) / 2) * rect.width;
    const maxY = ((zoom - 1) / 2) * rect.height;
    if (maxX <= 0 || maxY <= 0) return;
    setPan({
      x: clampUnit(start.panX + (event.clientX - start.x) / maxX),
      y: clampUnit(start.panY + (event.clientY - start.y) / maxY),
    });
  };

  const label = name || `카메라 ${index + 1}`;
  const waiting = !safeUrl;
  const connecting = Boolean(safeUrl) && !live && !offline && !paused;
  const showChrome = Boolean(safeUrl) && !paused && !offline;
  const status = held ? "일시정지" : live ? "재생 중" : "연결 중";

  return (
    <div
      ref={shellRef}
      className="relative overflow-hidden rounded-md border bg-black min-h-[160px] aspect-video"
      data-testid={`vision-pane-${index}`}
      data-reported-health={healthState || ""}
      data-zoom={zoom}
      data-pan-x={pan.x}
      data-pan-y={pan.y}
      data-live={live ? "1" : "0"}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: `translate(${pan.x * panPct}%, ${pan.y * panPct}%) scale(${zoom})` }}
        muted={muted}
        playsInline
        autoPlay
        controls={false}
        data-vision-frame={live ? "ready" : "empty"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />
      {waiting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
          <WifiOff className="h-5 w-5" />
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-white/60">{waitingHint}</p>
        </div>
      )}
      {connecting && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center text-white"
          data-testid={`vision-pane-connecting-${index}`}
        >
          <span className="relative flex h-14 w-14 items-center justify-center" aria-hidden>
            <span className="absolute inset-0 rounded-full border-2 border-white/25" />
            <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-white" />
            <Camera className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">카메라를 연결하고 있습니다</p>
          <p className="max-w-[260px] text-[12px] leading-relaxed text-white/80">
            사용 방법이 잘못된 것이 아닙니다. 카메라가 서버에 연결될 때까지 잠시 기다립니다.
          </p>
        </div>
      )}
      {!waiting && offline && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center text-white"
          data-testid={`vision-pane-offline-${index}`}
        >
          <WifiOff className="h-5 w-5" />
          <p className="text-sm font-medium">{offlineCopy?.title ?? "송출이 없습니다"}</p>
          <p className="text-[11px] text-white/70">
            {offlineCopy?.detail ?? "카메라가 서버로 영상을 보내지 않고 있습니다"}
          </p>
          <button
            type="button"
            className="mt-1 rounded bg-white/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-white"
            data-testid={`vision-pane-retry-${index}`}
            onClick={() => {
              setOffline(false);
              setOfflineCopy(null);
              setRetry((n) => n + 1);
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      {!waiting && paused && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center text-white"
          data-testid={`vision-pane-idle-${index}`}
        >
          <p className="text-sm font-medium">트래픽 절약을 위해 재생을 멈췄습니다</p>
          <p className="text-[11px] text-white/70">다시 보려면 아래 버튼을 누르거나 페이지를 새로고침하세요</p>
          <button
            type="button"
            className="mt-1 rounded bg-white/90 px-3 py-1.5 text-xs font-medium text-black hover:bg-white"
            data-testid={`vision-pane-resume-${index}`}
            onClick={() => setPaused(false)}
          >
            다시 보기
          </button>
        </div>
      )}
      {showChrome && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-30 bg-gradient-to-b from-black/80 to-transparent px-2 py-1.5"
          data-testid={`vision-pane-overlay-${index}`}
        >
            <p className="text-xs text-white font-medium truncate">{label}</p>
            <p className="text-[10px] text-white/70 truncate">
              {cameraId || ""} · {status}
              {recording ? " · 녹화 중" : ""}
            </p>
        </div>
      )}
      {live && showChrome && (
        <div
          className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent px-1.5 py-1.5"
          data-testid={`vision-pane-controls-${index}`}
        >
            <div className="flex items-center gap-1 overflow-x-auto">
              <IconButton label={held ? "재생" : "일시정지"} testId={`vision-pane-play-${index}`} onClick={togglePlay}>
                {held ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </IconButton>
              <IconButton label={muted ? "소리" : "음소거"} testId={`vision-pane-mute-${index}`} onClick={toggleMute}>
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </IconButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="음량"
                data-testid={`vision-pane-volume-${index}`}
                className="h-1 w-14 accent-white"
                onChange={(event) => onVolume(event.target.value)}
              />
              <IconButton label="스냅샷" testId={`vision-pane-snapshot-${index}`} onClick={() => void takeSnapshot()}>
                <Camera className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label={recording ? "녹화 중지" : "녹화"}
                testId={`vision-pane-record-${index}`}
                pressed={recording}
                onClick={toggleRecord}
              >
                <Circle className={`h-3.5 w-3.5 ${recording ? "fill-red-500 text-red-500" : ""}`} />
              </IconButton>
              <span className="flex-1" />
              <IconButton label="작은 창" testId={`vision-pane-pip-${index}`} onClick={() => void openPip()}>
                <PictureInPicture2 className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label={fullscreen ? "축소" : "전체화면"}
                testId={`vision-pane-fullscreen-${index}`}
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </IconButton>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              <IconButton
                label="화면 확대"
                testId={`vision-pane-zoom-in-${index}`}
                onClick={() => setZoomIndex((n) => Math.min(ZOOMS.length - 1, n + 1))}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="화면 축소"
                testId={`vision-pane-zoom-out-${index}`}
                onClick={() => setZoomIndex((n) => Math.max(0, n - 1))}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </IconButton>
              <span className="mx-0.5 h-4 w-px bg-white/30" />
              <IconButton label="위로" testId={`vision-pane-pan-up-${index}`} onClick={() => nudge(0, -PAN_STEP)}>
                <ChevronUp className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="아래로" testId={`vision-pane-pan-down-${index}`} onClick={() => nudge(0, PAN_STEP)}>
                <ChevronDown className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="왼쪽" testId={`vision-pane-pan-left-${index}`} onClick={() => nudge(-PAN_STEP, 0)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="오른쪽" testId={`vision-pane-pan-right-${index}`} onClick={() => nudge(PAN_STEP, 0)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </IconButton>
            </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  testId,
  pressed,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="h-7 w-7 shrink-0 rounded bg-black/60 text-white hover:bg-black/80"
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="mx-auto flex h-3.5 w-3.5 items-center justify-center">{children}</span>
    </button>
  );
}
