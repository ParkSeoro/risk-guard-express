/**
 * Shown when a manager/master has no project selected — keeps them from
 * falling into a confusing empty worker-like experience.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { usePreview } from "@/contexts/PreviewContext";
import { Card, CardContent } from "@/components/ui/card";
import { FolderKanban } from "lucide-react";
import { dedupeProjectsById, projectsFromMembershipRows } from "@/lib/mobileProjects";

export default function MobileProjectPicker({
  title = "프로젝트를 선택하세요",
  hint = "현장 앱 기능을 쓰려면 프로젝트가 필요합니다.",
}: {
  title?: string;
  hint?: string;
}) {
  const { user, hasRole } = useAuth();
  const { projectId, setProjectId } = useMobileAccess();
  const preview = usePreview();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      if (hasRole("master") || preview.isPreview) {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("is_deleted", false)
          .order("name")
          .limit(80);
        setProjects(dedupeProjectsById((data as any) || []));
        return;
      }
      if (!user?.id) {
        setProjects([]);
        return;
      }
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

  return (
    <Card className="border-amber-500/40 bg-amber-500/5" data-testid="mobile-project-picker">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <FolderKanban className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          </div>
        </div>
        <select
          className="w-full h-11 rounded-md border bg-background px-2 text-sm"
          value={projectId || preview.previewProjectId || ""}
          disabled={preview.isPreview}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">프로젝트 선택…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {preview.isPreview && (
          <p className="text-[11px] text-muted-foreground">프리뷰에서는 왼쪽에서 프로젝트를 바꿉니다.</p>
        )}
      </CardContent>
    </Card>
  );
}
