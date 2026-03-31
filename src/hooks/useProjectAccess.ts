import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ProjectRole = 'master' | 'project_admin' | 'safety_manager' | 'contractor' | 'viewer' | 'user';

export interface ProjectAccess {
  projects: { id: string; name: string; site_name: string }[];
  selectedProject: string;
  setSelectedProject: (id: string) => void;
  userCompanyId: string | null;
  userRole: ProjectRole;
  isMaster: boolean;
  isProjectAdmin: boolean;
  isContractor: boolean;
  loading: boolean;
  /** Apply to supabase query builder for company-scoped filtering */
  applyCompanyFilter: (query: any) => any;
  /** Permission checks */
  canCreate: (feature: FeatureKey) => boolean;
  canEdit: (feature: FeatureKey) => boolean;
  canDelete: (feature: FeatureKey) => boolean;
  canApprove: (feature: FeatureKey) => boolean;
}

export type FeatureKey = 'risk_assessment' | 'work_plan' | 'legal_duty' | 'todo' | 'approval';

// Permission matrix: role -> feature -> actions
const PERMISSION_MATRIX: Record<string, Record<FeatureKey, { create: boolean; edit: boolean; delete: boolean; approve: boolean }>> = {
  master: {
    risk_assessment: { create: true, edit: true, delete: true, approve: true },
    work_plan: { create: true, edit: true, delete: true, approve: true },
    legal_duty: { create: true, edit: true, delete: true, approve: false },
    todo: { create: true, edit: true, delete: true, approve: false },
    approval: { create: true, edit: true, delete: false, approve: true },
  },
  project_admin: {
    risk_assessment: { create: true, edit: true, delete: true, approve: true },
    work_plan: { create: true, edit: true, delete: true, approve: true },
    legal_duty: { create: true, edit: true, delete: true, approve: false },
    todo: { create: true, edit: true, delete: true, approve: false },
    approval: { create: true, edit: true, delete: false, approve: true },
  },
  safety_manager: {
    risk_assessment: { create: true, edit: true, delete: false, approve: true },
    work_plan: { create: true, edit: true, delete: false, approve: true },
    legal_duty: { create: true, edit: true, delete: false, approve: false },
    todo: { create: true, edit: true, delete: true, approve: false },
    approval: { create: false, edit: false, delete: false, approve: true },
  },
  contractor: {
    risk_assessment: { create: true, edit: true, delete: false, approve: false },
    work_plan: { create: true, edit: true, delete: false, approve: false },
    legal_duty: { create: false, edit: false, delete: false, approve: false },
    todo: { create: true, edit: true, delete: true, approve: false },
    approval: { create: true, edit: false, delete: false, approve: false },
  },
  viewer: {
    risk_assessment: { create: false, edit: false, delete: false, approve: false },
    work_plan: { create: false, edit: false, delete: false, approve: false },
    legal_duty: { create: false, edit: false, delete: false, approve: false },
    todo: { create: false, edit: false, delete: false, approve: false },
    approval: { create: false, edit: false, delete: false, approve: false },
  },
  user: {
    risk_assessment: { create: true, edit: true, delete: false, approve: false },
    work_plan: { create: true, edit: true, delete: false, approve: false },
    legal_duty: { create: false, edit: false, delete: false, approve: false },
    todo: { create: true, edit: true, delete: true, approve: false },
    approval: { create: true, edit: false, delete: false, approve: false },
  },
};

export function useProjectAccess(): ProjectAccess {
  const { user, hasRole } = useAuth();
  const isMaster = hasRole('master');
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [memberInfo, setMemberInfo] = useState<{ role: ProjectRole; company_id: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, [user]);

  useEffect(() => {
    if (selectedProject && user && !isMaster) {
      loadMemberInfo();
    } else if (isMaster) {
      setMemberInfo({ role: 'master', company_id: null });
    }
  }, [selectedProject, user, isMaster]);

  const loadProjects = async () => {
    if (!user) { setLoading(false); return; }
    
    if (isMaster) {
      const { data } = await supabase.from('projects').select('id, name, site_name').order('created_at', { ascending: false });
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    } else {
      // Get projects the user is a member of
      const { data: members } = await supabase
        .from('project_members')
        .select('project_id, projects(id, name, site_name)')
        .eq('user_id', user.id);
      
      if (members && members.length > 0) {
        const projs = members
          .map(m => (m as any).projects)
          .filter(Boolean);
        setProjects(projs);
        if (projs.length > 0) setSelectedProject(projs[0].id);
      }
    }
    setLoading(false);
  };

  const loadMemberInfo = async () => {
    if (!user || !selectedProject) return;
    const { data } = await supabase
      .from('project_members')
      .select('role, company_id')
      .eq('user_id', user.id)
      .eq('project_id', selectedProject)
      .maybeSingle();
    
    if (data) {
      setMemberInfo({ role: data.role as ProjectRole, company_id: data.company_id });
    }
  };

  const userRole = useMemo(() => {
    if (isMaster) return 'master' as ProjectRole;
    return (memberInfo?.role || 'viewer') as ProjectRole;
  }, [isMaster, memberInfo]);

  const isProjectAdmin = userRole === 'project_admin' || userRole === 'master';
  const isContractor = userRole === 'contractor';
  const userCompanyId = isMaster ? null : (memberInfo?.company_id || null);

  const applyCompanyFilter = <T extends { eq: (col: string, val: string) => T }>(query: T): T => {
    if (isMaster || isProjectAdmin) return query;
    if (userCompanyId) return query.eq('company_id', userCompanyId);
    return query;
  };

  const getPermissions = (feature: FeatureKey) => {
    const roleKey = ['master', 'project_admin', 'safety_manager', 'contractor', 'viewer', 'user'].includes(userRole)
      ? userRole : 'user';
    return PERMISSION_MATRIX[roleKey]?.[feature] || { create: false, edit: false, delete: false, approve: false };
  };

  return {
    projects,
    selectedProject,
    setSelectedProject,
    userCompanyId,
    userRole,
    isMaster,
    isProjectAdmin,
    isContractor,
    loading,
    applyCompanyFilter,
    canCreate: (f) => getPermissions(f).create,
    canEdit: (f) => getPermissions(f).edit,
    canDelete: (f) => getPermissions(f).delete,
    canApprove: (f) => getPermissions(f).approve,
  };
}
