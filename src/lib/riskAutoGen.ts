import { supabase } from '@/integrations/supabase/client';

export interface GeneratedRiskItem {
  process: string;
  sub_task: string;
  hazard: string;
  hazard_situation: string;
  existing_measure: string;
  improvement_measure: string;
  frequency: number;
  severity: number;
  improved_frequency: number;
  improved_severity: number;
  ppe: string[];
  legal_basis: string[];
  department: string;
  assignee: string;
  status: string;
}

export async function generateRiskItems(processName: string): Promise<GeneratedRiskItem[]> {
  // 1. Fetch matching templates by keyword
  const { data: templates } = await supabase
    .from('risk_templates')
    .select('*');

  const matched = (templates || []).filter(t =>
    processName.includes(t.process_keyword) || t.process_keyword.includes(processName)
  );

  if (matched.length === 0) return [];

  // 2. Fetch legal references for auto-mapping
  const { data: legalRefs } = await supabase
    .from('legal_references')
    .select('*');

  // 3. Fetch assignees for department mapping
  const { data: assignees } = await supabase
    .from('master_assignees')
    .select('*, master_departments(name)');

  // 4. Generate items from templates
  return matched.map(tmpl => {
    // Auto-map legal basis by matching keywords
    const matchedLaws = (legalRefs || [])
      .filter(law =>
        (law.process_mappings || []).some((pm: string) =>
          pm === processName || pm === '전체' || processName.includes(pm)
        ) ||
        (tmpl.legal_keywords || []).some((kw: string) =>
          (law.keywords || []).some((lk: string) => lk.includes(kw) || kw.includes(lk))
        )
      )
      .map(law => `${law.law_name} ${law.article}`);

    // Auto-map assignee by department
    const assignee = (assignees || []).find(a =>
      (a.master_departments as any)?.name === tmpl.department
    );

    return {
      process: processName,
      sub_task: tmpl.sub_task,
      hazard: tmpl.hazard,
      hazard_situation: tmpl.hazard_situation,
      existing_measure: tmpl.existing_measure || '',
      improvement_measure: tmpl.improvement_measure || '',
      frequency: tmpl.frequency,
      severity: tmpl.severity,
      improved_frequency: tmpl.improved_frequency,
      improved_severity: tmpl.improved_severity,
      ppe: tmpl.ppe || [],
      legal_basis: [...new Set(matchedLaws)],
      department: tmpl.department || '',
      assignee: assignee?.name || '',
      status: '미착수',
    };
  });
}
