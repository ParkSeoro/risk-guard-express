import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, MousePointer2, FolderOpen, Navigation } from "lucide-react";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import type { RemoteControlEvent } from "@/lib/remoteSupport";
import { clientPointToNormalized, isSafeNexAppPath } from "@/lib/remoteSupportControl";
import { toast } from "sonner";

const QUICK_PATHS = [
  { label: "대시보드", path: "/app/admin/" },
  { label: "위험성평가", path: "/app/admin/risk-assessment" },
  { label: "작업허가서", path: "/app/admin/work-permits" },
  { label: "작업계획서", path: "/app/admin/work-plans" },
  { label: "결재함", path: "/app/admin/approvals" },
  { label: "근로자", path: "/app/admin/workers" },
  { label: "설정", path: "/app/admin/settings" },
];

const MOVE_THROTTLE_MS = 40;

type Props = {
  requesterName?: string;
  remoteStream: MediaStream | null;
  onSendControl: (event: RemoteControlEvent) => void;
  onEnd: () => void;
};

export function RemoteSupportConsole({
  requesterName,
  remoteStream,
  onSendControl,
  onEnd,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const access = useGlobalProjectAccessOptional();
  const [customPath, setCustomPath] = useState("");
  const [projectId, setProjectId] = useState(access?.selectedProject || "");
  const lastMoveAt = useRef(0);
  const lastNorm = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    if (remoteStream) void el.play().catch(() => undefined);
  }, [remoteStream]);

  // Capture keys while the console stage is focused (not when typing in side panel inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (!lastNorm.current) return;
      // Don't steal browser shortcuts like refresh.
      if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"))) return;
      e.preventDefault();
      onSendControl({
        kind: "key",
        type: e.type === "keyup" ? "keyup" : "keydown",
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      });
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [onSendControl]);

  const resolveNorm = (clientX: number, clientY: number) => {
    const video = videoRef.current;
    if (!video) return null;
    return clientPointToNormalized(video, clientX, clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLVideoElement>) => {
    const norm = resolveNorm(e.clientX, e.clientY);
    if (!norm) return;
    lastNorm.current = norm;
    const now = performance.now();
    if (now - lastMoveAt.current < MOVE_THROTTLE_MS) return;
    lastMoveAt.current = now;
    onSendControl({ kind: "pointer", x: norm.x, y: norm.y, visible: true });
  };

  const onPointerLeave = () => {
    onSendControl({ kind: "pointer", x: 0, y: 0, visible: false });
  };

  const onVideoClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    e.preventDefault();
    const norm = resolveNorm(e.clientX, e.clientY);
    if (!norm) return;
    lastNorm.current = norm;
    onSendControl({ kind: "pointer", x: norm.x, y: norm.y, visible: true });
    onSendControl({
      kind: "click",
      x: norm.x,
      y: norm.y,
      button: e.button,
      detail: e.detail,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
  };

  const onWheel = (e: React.WheelEvent<HTMLVideoElement>) => {
    e.preventDefault();
    const norm = resolveNorm(e.clientX, e.clientY) || lastNorm.current;
    if (!norm) return;
    onSendControl({
      kind: "scroll",
      x: norm.x,
      y: norm.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    });
  };

  const sendNavigate = (path: string) => {
    if (!isSafeNexAppPath(path)) {
      toast.error("SafeNex 앱 경로만 이동할 수 있습니다.");
      return;
    }
    onSendControl({ kind: "navigate", path });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-background/95 backdrop-blur-sm print:hidden flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">원격지원 콘솔</p>
          <p className="text-xs text-muted-foreground truncate">
            {(requesterName || "현장 사용자") +
              " · 영상 위에서 커서·클릭·스크롤로 SafeNex만 조작"}
          </p>
        </div>
        <Button type="button" size="sm" variant="destructive" className="gap-1" onClick={onEnd}>
          <X className="h-4 w-4" />
          종료
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] min-h-0">
        <div
          ref={stageRef}
          className="relative bg-black min-h-[240px] flex items-center justify-center outline-none"
          tabIndex={0}
        >
          {remoteStream ? (
            <video
              ref={videoRef}
              className="max-h-full max-w-full object-contain cursor-none"
              autoPlay
              playsInline
              muted
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
              onClick={onVideoClick}
              onDoubleClick={onVideoClick}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={onWheel}
            />
          ) : (
            <p className="text-sm text-muted-foreground px-4 text-center">
              요청자가 화면공유를 허용하면 영상이 여기에 표시됩니다.
              <br />
              <span className="text-xs">가능하면 브라우저 탭만 공유해 주세요 (좌표가 정확합니다).</span>
            </p>
          )}
          <div className="absolute bottom-2 left-2 text-[11px] text-white/80 bg-black/50 px-2 py-1 rounded flex items-center gap-1 max-w-[90%]">
            <MousePointer2 className="h-3 w-3 shrink-0" />
            마우스 이동·클릭·스크롤이 요청자 SafeNex에 반영됩니다. 다른 PC 앱은 제어되지 않습니다.
          </div>
        </div>

        <aside className="border-l p-3 space-y-4 overflow-auto">
          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1">
              <FolderOpen className="h-3.5 w-3.5" /> 프로젝트 전환
            </Label>
            <Select
              value={projectId}
              onValueChange={(id) => {
                setProjectId(id);
                onSendControl({ kind: "setProject", projectId: id });
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="프로젝트 선택" />
              </SelectTrigger>
              <SelectContent>
                {(access?.projects || []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-1">
              <Navigation className="h-3.5 w-3.5" /> 빠른 이동 (보조)
            </Label>
            <p className="text-[11px] text-muted-foreground">
              주요 조작은 왼쪽 영상에서 사이드바·메뉴를 직접 클릭하세요.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_PATHS.map((item) => (
                <Button
                  key={item.path}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs justify-start"
                  onClick={() => sendNavigate(item.path)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Input
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="/app/admin/..."
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0"
                disabled={!customPath.trim()}
                onClick={() => {
                  sendNavigate(customPath.trim());
                  setCustomPath("");
                }}
              >
                이동
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
