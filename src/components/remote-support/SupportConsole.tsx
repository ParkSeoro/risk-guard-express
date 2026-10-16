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

const QUICK_PATHS = [
  { label: "대시보드", path: "/app/admin/" },
  { label: "위험성평가", path: "/app/admin/risk-assessment" },
  { label: "작업허가서", path: "/app/admin/work-permits" },
  { label: "작업계획서", path: "/app/admin/work-plans" },
  { label: "결재함", path: "/app/admin/approvals" },
  { label: "근로자", path: "/app/admin/workers" },
  { label: "설정", path: "/app/admin/settings" },
];

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
  const access = useGlobalProjectAccessOptional();
  const [customPath, setCustomPath] = useState("");
  const [projectId, setProjectId] = useState(access?.selectedProject || "");

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    if (remoteStream) void el.play().catch(() => undefined);
  }, [remoteStream]);

  const onVideoClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onSendControl({ kind: "pointer", x, y, visible: true });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-background/95 backdrop-blur-sm print:hidden flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">원격지원 콘솔</p>
          <p className="text-xs text-muted-foreground truncate">
            {(requesterName || "현장 사용자") + " · 화면공유 + 앱 공동조작"}
          </p>
        </div>
        <Button type="button" size="sm" variant="destructive" className="gap-1" onClick={onEnd}>
          <X className="h-4 w-4" />
          종료
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] min-h-0">
        <div className="relative bg-black min-h-[240px] flex items-center justify-center">
          {remoteStream ? (
            <video
              ref={videoRef}
              className="max-h-full max-w-full object-contain cursor-crosshair"
              autoPlay
              playsInline
              muted
              onClick={onVideoClick}
            />
          ) : (
            <p className="text-sm text-muted-foreground px-4 text-center">
              요청자가 화면공유를 허용하면 영상이 여기에 표시됩니다.
            </p>
          )}
          <div className="absolute bottom-2 left-2 text-[11px] text-white/80 bg-black/50 px-2 py-1 rounded flex items-center gap-1">
            <MousePointer2 className="h-3 w-3" />
            영상 클릭 시 요청자 화면에 포인터 표시
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
              <Navigation className="h-3.5 w-3.5" /> 메뉴 이동
            </Label>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_PATHS.map((item) => (
                <Button
                  key={item.path}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs justify-start"
                  onClick={() => onSendControl({ kind: "navigate", path: item.path })}
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
                  onSendControl({ kind: "navigate", path: customPath.trim() });
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
