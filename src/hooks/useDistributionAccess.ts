import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { companyDocScopeMode } from "@/lib/companyDocScope";

export function canViewWorkerDistribution(role?: string | null, isMaster?: boolean): boolean {
  return isManagerMobileRole(role || "", isMaster);
}

export function distributionScopeLabel(opts: {
  isMaster?: boolean;
  role?: string | null;
  companyType?: string | null;
  seesAll?: boolean;
}): string {
  if (opts.isMaster || opts.seesAll) return "전체 현장";
  const mode = companyDocScopeMode(opts);
  if (mode === "tree") return "자사·협력사";
  if (mode === "all") return "전체 현장";
  return "자사만";
}

/** Desktop AppLayout project access, or mobile shell project + membership. */
export function useDistributionAccess() {
  const global = useGlobalProjectAccessOptional();
  const mobile = useMobileAccess();
  const { user, hasRole } = useAuth();
  const [mobileProjects, setMobileProjects] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (global) return;
    let cancelled = false;
    (async () => {
      if (hasRole("master") || mobile.isMaster) {
        const { data } = await supabase
          .from("projects")
          .select("id, name")
          .eq("is_deleted", false)
          .order("name")
          .limit(80);
        if (!cancelled) setMobileProjects((data as any) || []);
        return;
      }
      if (!user?.id) {
        if (!cancelled) setMobileProjects([]);
        return;
      }
      const { data } = await supabase
        .from("project_members")
        .select("project_id, projects(id, name, is_deleted)")
        .eq("user_id", user.id)
        .limit(100);
      const list = ((data as any) || [])
        .map((r: any) => r.projects)
        .filter((p: any) => p && !p.is_deleted)
        .map((p: any) => ({ id: p.id, name: p.name }));
      const uniq = new Map<string, { id: string; name: string }>();
      for (const p of list) uniq.set(p.id, p);
      if (!cancelled) setMobileProjects([...uniq.values()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [global, user?.id, hasRole, mobile.isMaster]);

  const isMaster = global?.isMaster ?? mobile.isMaster;
  const userRole = (global?.userRole || mobile.role || "") as string;
  const userCompanyType = global?.userCompanyType ?? mobile.companyType;
  const seesAllCompanies = global?.seesAllCompanies ?? mobile.seesAllCompanies;
  const selectedProject = global?.selectedProject || mobile.projectId || "";
  const setSelectedProject = global?.setSelectedProject || mobile.setProjectId;
  const projects = global?.projects?.length
    ? global.projects.map((p) => ({ id: p.id, name: p.name }))
    : mobileProjects;

  return {
    projects,
    selectedProject,
    setSelectedProject,
    isMaster,
    userRole,
    userCompanyType,
    seesAllCompanies,
    canView: canViewWorkerDistribution(userRole, isMaster),
    scopeLabel: distributionScopeLabel({
      isMaster,
      role: userRole,
      companyType: userCompanyType,
      seesAll: seesAllCompanies,
    }),
    compact: !global,
  };
}
