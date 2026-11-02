import { supabase } from '@/integrations/supabase/client';

export interface CompanyRegistrationInput {
  name: string;
  businessNo?: string;
  type: string;
  contact?: string;
  address?: string;
  projectId: string;
  parentCompanyId?: string | null;
  requesterName: string;
  requesterEmail?: string;
  requesterPhone?: string;
  memo?: string;
}

export async function submitCompanyRegistration(input: CompanyRegistrationInput) {
  const { data, error } = await (supabase as any).rpc('submit_company_registration_request', {
    p_name: input.name,
    p_business_no: input.businessNo || null,
    p_type: input.type,
    p_contact: input.contact || null,
    p_address: input.address || null,
    p_project_id: input.projectId,
    p_parent_company_id: input.parentCompanyId || null,
    p_requester_name: input.requesterName,
    p_requester_email: input.requesterEmail || null,
    p_requester_phone: input.requesterPhone || null,
    p_memo: input.memo || null,
  });
  if (error) return { result: 'error', message: error.message as string };
  return (data || { result: 'error', message: '응답이 없습니다.' }) as {
    result: string;
    message?: string;
    company_id?: string;
    request_id?: string;
    request_kind?: string;
  };
}

export function looseCompanyLabel(name?: string | null): string {
  return String(name || '')
    .toLowerCase()
    .replace(/㈜|㈔|\(\s*주\s*\)|주식회사|유한회사/g, '')
    .replace(/[^0-9a-z가-힣]/g, '');
}
