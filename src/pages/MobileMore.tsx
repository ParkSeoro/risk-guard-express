import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole, roleLabelKo } from "@/lib/mobileShell";
import { usePreview } from "@/contexts/PreviewContext";
import { setForceDesktop } from "@/hooks/use-mobile";
import { isNativeApp } from "@/lib/native/isNativeApp";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  LogOut,
  Monitor,
  QrCode,
  ScanLine,
  User,
  BookOpen,
  Bell,
  Inbox,
  FolderOpen,
  Crosshair,
  MapPin,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import MobileOtaUpdateCard from "@/components/mobile/MobileOtaUpdateCard";
import MasterAlarmSimulator from "@/components/geofence/MasterAlarmSimulator";
import { useSystemRealtimeOptional } from "@/providers/SystemRealtimeProvider";
import { anyMapHasGeoref } from "@/lib/mapBounds";
import { useGpsUi } from "@/lib/tracking/gpsStatusUi";

export default function MobileMore() {
  const { signOut, profile, hasRole, user } = useAuth();
  const { role, isMaster, projectId, setProjectId } = useMobileAccess();
  const preview = usePreview();
  const navigate = useNavigate();
  const realtime = useSystemRealtimeOptional();
  const unread = realtime?.unreadNotifications ?? 0;
  const gpsUi = useGpsUi();
  const effectiveRole = preview.isPreview ? preview.syntheticRole : role;
  const manager = isManagerMobileRole(
    effectiveRole,
    preview.isPreview ? effectiveRole === "master" : isMaster,
  );
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [mapGeorefDone, setMapGeorefDone] = useState(false);

  useEffect(() => {
    (async () => {
      if (hasRole("master") || preview.isPreview) {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("is_deleted", false)
          .order("name")
          .limit(50);
        setProjects(dedupeProjectsById((data as any) || []));
        return;
      }
      if (!user?.id) {
        setProjects([]);
        return;
      }
      // Own memberships only — RLS can otherwise return every peer row on the project.
      const { data } = await supabase
        .from("project_members")
        .select("project_id, projects(id, name, is_deleted)")
        .eq("user_id", user.id)
        .limit(100);
      const list = projectsFromMembershipRows(
        ((data as any) || []).filter((r: any) => r.projects && !r.projects.is_deleted),
      );
      setProjects(list);
    })();
  }, [hasRole, preview.isPreview, user?.id]);

  const effectiveProjectId = projectId || preview.previewProjectId || "";
  useEffect(() => {
    if (!effectiveProjectId) {
      setMapGeorefDone(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("site_maps")
        .select(
          "geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng,geo_transform",
        )
        .eq("project_id", effectiveProjectId)
        .eq("is_deleted", false)
        .limit(8);
      if (!cancelled) setMapGeorefDone(anyMapHasGeoref((data as any) || []));
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveProjectId]);

  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="mobile-more">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-base font-bold">더보기</h1>
          <p className="text-xs text-muted-foreground">
            {profile?.display_name || "사용자"} · {roleLabelKo(effectiveRole)}
          </p>
        </div>
        <Badge variant="secondary">{manager ? "관리자" : "근로자"}</Badge>
      </div>

      {projects.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">프로젝트</div>
            <select
              className="w-full h-10 rounded-md border bg-background px-2 text-sm"
              value={projectId || preview.previewProjectId || ""}
              disabled={preview.isPreview}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">선택…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      <MobileOtaUpdateCard />

      {gpsUi.tracking && (
        <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
          GPS는 홈으로 나가도 유지됩니다. 최근 목록에서 앱을 지우면 추적·알람이 멈춥니다.
        </p>
      )}

      {/* Master field tools — MobileHome is orphaned (redirects to today); live here. */}
      {(isMaster || (preview.isPreview && effectiveRole === "master")) && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">마스터 · 현장 GPS</div>
            <Button
              className="w-full h-11"
              disabled={!projectId && !preview.previewProjectId}
              onClick={() => navigate("/app/worker/map-calibration")}
            >
              <Crosshair className="h-4 w-4 mr-2" /> {mapGeorefDone ? "맵·GPS 재보정" : "맵·GPS 맞추기"}
            </Button>
            <Button
              variant="secondary"
              className="w-full h-11"
              disabled={!projectId && !preview.previewProjectId}
              onClick={() => navigate("/app/worker/geofence-drop")}
            >
              <MapPin className="h-4 w-4 mr-2" /> 내 위치를 위험 구역으로
            </Button>
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
              {mapGeorefDone
                ? "워킹 보정은 완료됐습니다. 도면이 바뀌었거나 알람이 어긋날 때만 다시 맞추세요."
                : "PC에서 도면만 올리면 됩니다. 위성 맵핑은 필수가 아닙니다. 워킹 보정으로 A·B·C 좌표를 잡으세요. (프로젝트를 먼저 선택)"}
            </p>
            <MasterAlarmSimulator projectId={projectId || preview.previewProjectId || ""} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {(manager
            ? [
                { label: "알림 내역", to: "/app/worker/alerts", icon: Inbox, badge: unread },
                { label: "알림 · 알람 설정", to: "/app/worker/notifications", icon: Bell },
                { label: "승인 자료", to: "/app/worker/docs", icon: FolderOpen },
                { label: "QR 스캔", to: "/app/worker/scan", icon: ScanLine },
                { label: "근로자·출입", to: "/app/worker/workers", icon: QrCode },
                { label: "계정 정보", to: "/app/worker/account", icon: User },
                ...(!isNativeApp()
                  ? [{ label: "사용 설명서", to: "/manual", icon: BookOpen }]
                  : []),
              ]
            : [
                { label: "알림 내역", to: "/app/worker/alerts", icon: Inbox, badge: unread },
                { label: "알림 · 알람 설정", to: "/app/worker/notifications", icon: Bell },
                { label: "QR 스캔", to: "/app/worker/scan", icon: ScanLine },
                { label: "계정 정보", to: "/app/worker/account", icon: User },
                ...(!isNativeApp()
                  ? [{ label: "사용 설명서", to: "/manual", icon: BookOpen }]
                  : []),
              ]
          ).map((row) => (
            <Link
              key={row.to}
              to={row.to}
              className="flex items-center gap-3 px-3 py-3 text-sm hover:bg-muted/50"
            >
              <row.icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{row.label}</span>
              {"badge" in row && typeof row.badge === "number" && row.badge > 0 && (
                <Badge variant="destructive" className="text-[10px] h-5 min-w-5 px-1.5">
                  {row.badge > 99 ? "99+" : row.badge}
                </Badge>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {!preview.isPreview && manager && !isNativeApp() && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setForceDesktop(true);
            navigate("/app/admin");
          }}
        >
          <Monitor className="h-4 w-4 mr-2" />
          PC 관리 화면으로
        </Button>
      )}

      {!preview.isPreview && (
        <Button
          variant="ghost"
          className="w-full text-destructive"
          onClick={async () => {
            await signOut();
            navigate("/login");
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          로그아웃
        </Button>
      )}
    </div>
  );
}
