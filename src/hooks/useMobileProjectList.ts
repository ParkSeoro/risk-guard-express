import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePreview } from "@/contexts/PreviewContext";
import { dedupeProjectsById, projectsFromMembershipRows, type MobileProjectOption } from "@/lib/mobileProjects";

export function useMobileProjectList() {
  const { user, hasRole } = useAuth();
  const preview = usePreview();
  const [projects, setProjects] = useState<MobileProjectOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (hasRole("master") || preview.isPreview) {
          const { data } = await supabase
            .from("projects")
            .select("id, name")
            .eq("is_deleted", false)
            .order("name");
          if (!cancelled) setProjects(dedupeProjectsById((data as MobileProjectOption[]) || []));
          return;
        }
        if (!user?.id) {
          if (!cancelled) setProjects([]);
          return;
        }
        const { data } = await supabase
          .from("project_members")
          .select("project_id, projects(id, name, is_deleted)")
          .eq("user_id", user.id)
          .limit(200);
        const list = projectsFromMembershipRows(
          ((data as any) || []).filter((r: any) => r.projects && !r.projects.is_deleted),
        );
        if (!cancelled) setProjects(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRole, preview.isPreview, user?.id]);

  return { projects, loading };
}