import { supabase } from '@/integrations/supabase/client';
import type { PermitKindId } from '@/lib/permitKinds';
import { PERMIT_KIND_LABEL } from '@/lib/permitKinds';

export interface PermitAiBriefing {
  work_overview: string;
  included_kinds: string[];
  top_risks: string[];
  required_controls: string[];
  generated_at?: string;
}

export async function generatePermitAiBriefing(input: {
  permitId: string;
  projectId?: string | null;
  formData: Record<string, unknown>;
  permitKinds: PermitKindId[];
  workName?: string;
  workDescription?: string;
  workLocation?: string;
  permitDate?: string;
}): Promise<PermitAiBriefing> {
  const { data, error } = await supabase.functions.invoke('generate-permit-briefing', {
    body: {
      permit_id: input.permitId,
      project_id: input.projectId || null,
      permit_kinds: input.permitKinds,
      kind_labels: input.permitKinds.map((k) => PERMIT_KIND_LABEL[k] || k),
      work_name: input.workName || '',
      work_description: input.workDescription || '',
      work_location: input.workLocation || '',
      permit_date: input.permitDate || '',
      form_data: input.formData || {},
    },
  });

  if (error) {
    // Prefer JSON body when available
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.clone().json();
        if (body?.briefing) return normalizeBriefing(body.briefing, input.permitKinds);
        if (body?.error) throw new Error(typeof body.error === 'string' ? body.error : body.error.message);
      } catch (e) {
        if (e instanceof Error && e.message !== error.message) throw e;
      }
    }
    throw new Error(error.message || 'AI 브리핑 생성 실패');
  }
  if (data?.error) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'AI 브리핑 생성 실패');
  }
  return normalizeBriefing(data?.briefing || data, input.permitKinds);
}

function normalizeBriefing(raw: any, kinds: PermitKindId[]): PermitAiBriefing {
  const top = Array.isArray(raw?.top_risks) ? raw.top_risks.map(String).filter(Boolean).slice(0, 3) : [];
  const controls = Array.isArray(raw?.required_controls)
    ? raw.required_controls.map(String).filter(Boolean).slice(0, 6)
    : [];
  const included = Array.isArray(raw?.included_kinds) && raw.included_kinds.length
    ? raw.included_kinds.map(String)
    : kinds.map((k) => PERMIT_KIND_LABEL[k] || k);
  return {
    work_overview: String(raw?.work_overview || '작업 개요를 확인하세요.'),
    included_kinds: included,
    top_risks: top.length ? top : ['작성된 위험요인을 원본 양식에서 확인하세요.'],
    required_controls: controls.length ? controls : ['필수 안전조치·보호구·가스측정을 원본에서 확인하세요.'],
    generated_at: raw?.generated_at || new Date().toISOString(),
  };
}

/** Offline / AI-failure fallback so submit is not blocked. */
export function buildLocalPermitBriefing(input: {
  formData: Record<string, unknown>;
  permitKinds: PermitKindId[];
  workName?: string;
  workDescription?: string;
  workLocation?: string;
}): PermitAiBriefing {
  const d = input.formData || {};
  const overviewParts = [
    input.workName || (d.work_name as string) || '',
    input.workDescription || (d.work_description as string) || '',
    input.workLocation || (d.work_location as string) || '',
  ].filter(Boolean);
  const risks: string[] = [];
  if (d.hz_confined || input.permitKinds.includes('confined_space')) risks.push('밀폐공간 질식·가스 중독 위험');
  if (d.hz_hot || input.permitKinds.includes('hot_work')) risks.push('화기작업 화재·폭발 위험');
  if (d.hz_excavation || input.permitKinds.includes('excavation')) risks.push('굴착 붕괴·매설물 손상 위험');
  if (d.hz_height) risks.push('고소작업 추락 위험');
  if (d.hz_heavy) risks.push('중장비 협착·충돌 위험');
  while (risks.length < 3) risks.push('현장 특화 위험요인을 원본에서 확인');

  const controls: string[] = [];
  if (d.chk_ppe || d.chk_education) controls.push('보호구 착용 및 안전교육 실시 확인');
  if (d.gas_o2 || d.gas_for_confined || input.permitKinds.includes('confined_space')) {
    controls.push('작업 전 가스농도 측정(O₂/H₂S/CO 등) 및 기록');
  }
  if (d.hw_safety || input.permitKinds.includes('hot_work')) controls.push('소화기 비치·불티비산 방지·화기감시자 배치');
  if (input.permitKinds.includes('excavation')) controls.push('지하매설물 확인·굴착사면 방호·중장비 유도');
  controls.push('작업허가 범위 외 작업 금지 및 TBM 실시');

  return {
    work_overview: overviewParts.join(' · ') || '작업 개요 미입력',
    included_kinds: input.permitKinds.map((k) => PERMIT_KIND_LABEL[k] || k),
    top_risks: risks.slice(0, 3),
    required_controls: controls.slice(0, 5),
    generated_at: new Date().toISOString(),
  };
}
