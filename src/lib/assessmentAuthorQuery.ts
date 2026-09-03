import { supabase } from '@/integrations/supabase/client';
import {
  buildAssessmentAuthorCandidates,
  type AssessmentAuthorCandidate,
} from '@/lib/assessmentAuthor';

/** Load site_supervisor candidates. Throws on PostgREST/network errors so callers can clear loading. */
export async function fetchAssessmentAuthorCandidates(
  projectId: string,
  companyIds?: string[] | null,
): Promise<AssessmentAuthorCandidate[]> {
  let query = supabase
    .from('project_members')
    .select('user_id, company_id')
    .eq('project_id', projectId)
    .eq('role_new', 'site_supervisor');
  if (companyIds && companyIds.length > 0) {
    query = query.in('company_id', companyIds);
  }
  const { data: members, error: memberError } = await query;
  if (memberError) throw new Error(memberError.message);

  const rows = members || [];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const memberCompanyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[];

  const [profileRes, companyRes] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('user_id, display_name').in('user_id', userIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string | null }[], error: null }),
    memberCompanyIds.length
      ? supabase.from('companies').select('id, name').in('id', memberCompanyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (companyRes.error) throw new Error(companyRes.error.message);

  return buildAssessmentAuthorCandidates(rows, profileRes.data || [], companyRes.data || []);
}
