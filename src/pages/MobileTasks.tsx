import { Link } from "react-router-dom";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { usePreview } from "@/contexts/PreviewContext";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, ClipboardCheck, AlertOctagon, Users, Wrench, HeartPulse } from "lucide-react";

export default function MobileTasks() {
  const { role, isMaster } = useMobileAccess();
  const preview = usePreview();
  const effectiveRole = preview.isPreview ? preview.syntheticRole : role;
  const manager = isManagerMobileRole(
    effectiveRole,
    preview.isPreview ? effectiveRole === "master" : isMaster,
  );

  const workerItems = [
    { label: "내 조치사항", sub: "배정된 조치 완료", to: "/app/worker/actions", icon: Wrench },
    { label: "TBM 참여", sub: "오늘 브리핑·서명", to: "/app/worker/tbm", icon: Users },
    { label: "사고·아차사고 신고", sub: "즉시 보고", to: "/app/worker/incident", icon: AlertOctagon },
    { label: "건강로그", sub: "오늘 컨디션", to: "/app/worker/daily-health-log", icon: HeartPulse },
  ];

  const managerItems = [
    { label: "안전점검", sub: "현장 점검 등록", to: "/app/worker/inspect", icon: ClipboardCheck },
    { label: "조치 관리", sub: "진행·완료 확인", to: "/app/worker/actions", icon: Wrench },
    { label: "사고 신고", sub: "아차/경미/중대", to: "/app/worker/incident", icon: AlertOctagon },
    { label: "TBM 진행", sub: "QR·참여 관리", to: "/app/worker/tbm", icon: Users },
    { label: "근로자·출입", sub: "QR·출입정지", to: "/app/worker/workers", icon: Users },
  ];

  const items = manager ? managerItems : workerItems;

  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="mobile-tasks">
      <div>
        <h1 className="text-base font-bold">할 일</h1>
        <p className="text-xs text-muted-foreground">
          {manager ? "현장 관리·조치 작업" : "오늘 수행해야 할 작업"}
        </p>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {items.map((it) => (
            <Link
              key={it.to + it.label}
              to={it.to}
              className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50"
            >
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <it.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{it.label}</div>
                <div className="text-xs text-muted-foreground">{it.sub}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
