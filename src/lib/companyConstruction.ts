import { supabase } from '@/integrations/supabase/client';

export interface ConstructionForm {
  construction_name: string;
  construction_type: string;
  construction_period_start: string;
  construction_period_end: string;
  construction_amount: string;
}

export const emptyConstructionForm = (): ConstructionForm => ({
  construction_name: '',
  construction_type: '',
  construction_period_start: '',
  construction_period_end: '',
  construction_amount: '',
});

export function constructionFormFromRow(row: any): ConstructionForm {
  if (!row) return emptyConstructionForm();
  return {
    construction_name: row.construction_name || '',
    construction_type: row.construction_type || '',
    construction_period_start: row.construction_period_start || '',
    construction_period_end: row.construction_period_end || '',
    construction_amount: row.construction_amount ? String(row.construction_amount) : '',
  };
}

export async function upsertProjectConstruction(
  companyId: string,
  projectId: string,
  form: ConstructionForm,
): Promise<string | null> {
  const payload = {
    company_id: companyId,
    project_id: projectId,
    construction_name: form.construction_name.trim(),
    construction_type: form.construction_type.trim(),
    construction_period_start: form.construction_period_start || null,
    construction_period_end: form.construction_period_end || null,
    construction_amount: Number(form.construction_amount) || 0,
  };
  const blank = !payload.construction_name
    && !payload.construction_type
    && !payload.construction_period_start
    && !payload.construction_period_end
    && !payload.construction_amount;
  const { data: existing, error: readErr } = await (supabase as any)
    .from('company_construction_info')
    .select('id')
    .eq('company_id', companyId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (readErr) return readErr.message as string;
  if (!existing && blank) return null;
  const { error } = existing
    ? await (supabase as any).from('company_construction_info').update(payload).eq('id', existing.id)
    : await (supabase as any).from('company_construction_info').insert([payload]);
  return error ? (error.message as string) : null;
}
