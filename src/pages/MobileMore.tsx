import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole, roleLabelKo } from "@/lib/mobileShell";
import { usePreview } from "@/contexts/PreviewContext";
import { setForceDesktop } from "@/hooks/use-mobile";
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
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function MobileMore() {
  const { signOut, profile, hasRole } = useAuth();
  const { role, isMaster, projectId, setProjectId } = useMobileAccess();
  const preview = usePreview();
  const navigate = useNavigate();
  const effectiveRole = preview.isPreview ? preview.syntheticRole : role;
  const manager = isManagerMobileRole(
    effectiveRole,
    preview.isPreview ? effectiveRole === "master" : isMaster,
  );
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      if (hasRole("master") || preview.isPreview) {
        const { data } = await supabase.from("projects").select("id, name").order("name").limit(50);
        setProjects((data as any) || []);
        return;
      }
      const { data } = await supabase
        .from("project_members")
        .select("project_id, projects(id, name)")
        .limit(50);
      const list = ((data as any) || [])
        .map((r: any) => r.projects)
        .filter(Boolean)
        .map((p: any) => ({ id: p.id, name: p.name }));
      setProjects(list);
    })();
  }, [hasRole, preview.isPreview]);

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

      <Card>
        <CardContent className="p-0 divide-y">
          {(manager
            ? [
                { label: "QR 스캔", to: "/app/worker/scan", icon: ScanLine },
                { label: "근로자 QR", to: "/app/worker/workers", icon: QrCode },
                { label: "계정 정보", to: "/settings/account", icon: User },
                { label: "사용 설명서", to: "/manual", icon: BookOpen },
              ]
            : [
                { label: "QR 스캔", to: "/app/worker/scan", icon: ScanLine },
                { label: "계정 정보", to: "/settings/account", icon: User },
                { label: "사용 설명서", to: "/manual", icon: BookOpen },
              ]
          ).map((row) => (
            <Link
              key={row.to}
              to={row.to}
              className="flex items-center gap-3 px-3 py-3 text-sm hover:bg-muted/50"
            >
              <row.icon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{row.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {!preview.isPreview && manager && (
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
