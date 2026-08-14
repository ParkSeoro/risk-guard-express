import { supabase } from '@/integrations/supabase/client';
import type { PermitKindId } from '@/lib/permitKinds';
import { PERMIT_KIND_LABEL } from '@/lib/permitKinds';
import {
  buildLocalPermitBriefingFromFacts,
  extractPermitBriefingFacts,
  normalizePermitBriefing,
  type PermitAiBriefing,
} from '../../supabase/functions/_shared/permitBriefing';

export type { PermitAiBriefing };
export {
  applyPermitBriefingLead,
  buildPermitBriefingLead,
  buildPermitBriefingLlmPayload,
  extractPermitBriefingFacts,
  formatPermitBriefingDateKo,
  PERMIT_BRIEFING_SYSTEM_PROMPT,
  buildLocalPermitBriefingFromFacts,
  normalizePermitBriefing,
} from '../../supabase/functions/_shared/permitBriefing';

function briefingFromServer(raw: any, facts: ReturnType<typeof extractPermitBriefingFacts>): PermitAiBriefing {
  if (raw?.work_overview) {
    return {
      work_overview: String(raw.work_overview),
      included_kinds: Array.isArray(raw.included_kinds) && raw.included_kinds.length
        ? raw.included_kinds.map(String)
        : facts.kindLabels,
      top_risks: Array.isArray(raw.top_risks) ? raw.top_risks.map(String).filter(Boolean).slice(0, 3) : [],
      required_controls: Array.isArray(raw.required_controls)
        ? raw.required_controls.map(String).filter(Boolean).slice(0, 6)
        : [],
      generated_at: raw.generated_at || new Date().toISOString(),
    };
  }
  return normalizePermitBriefing(raw, facts);
}

export async function generatePermitAiBriefing(input: {
  permitId: string;
  projectId?: string | null;
  formData?: Record<string, unknown>;
  permitKinds?: PermitKindId[];
  kindLabels?: string[];
  workName?: string;
  workDescription?: string;
  workLocation?: string;
  permitDate?: string;
  contractorCompany?: string;
}): Promise<PermitAiBriefing> {
  const kinds = input.permitKinds || [];
  const { data, error } = await supabase.functions.invoke('generate-permit-briefing', {
    body: {
      permit_id: input.permitId,
      project_id: input.projectId || null,
      permit_kinds: kinds,
      kind_labels: input.kindLabels
        || kinds.map((k) => PERMIT_KIND_LABEL[k] || k),
      work_name: input.workName || '',
      work_description: input.workDescription || '',
      work_location: input.workLocation || '',
      permit_date: input.permitDate || '',
      contractor_company: input.contractorCompany || '',
      form_data: input.formData || {},
    },
  });

  const facts = extractPermitBriefingFacts({
    formData: input.formData,
    permitKinds: kinds,
    kindLabels: input.kindLabels,
    workName: input.workName,
    workDescription: input.workDescription,
    workLocation: input.workLocation,
    permitDate: input.permitDate,
    contractorCompany: input.contractorCompany,
  });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.clone().json();
        if (body?.briefing) return briefingFromServer(body.briefing, facts);
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
  const raw = data?.briefing || data;
  return briefingFromServer(raw, facts);
}

/** Offline / AI-failure fallback so submit is not blocked. */
export function buildLocalPermitBriefing(input: {
  formData?: Record<string, unknown> | null;
  permitKinds?: PermitKindId[];
  kindLabels?: string[];
  workName?: string;
  workDescription?: string;
  workLocation?: string;
  permitDate?: string;
  contractorCompany?: string;
  workStartAt?: string;
}): PermitAiBriefing {
  return buildLocalPermitBriefingFromFacts(extractPermitBriefingFacts({
    formData: input.formData,
    permitKinds: input.permitKinds,
    kindLabels: input.kindLabels,
    workName: input.workName,
    workDescription: input.workDescription,
    workLocation: input.workLocation,
    permitDate: input.permitDate,
    contractorCompany: input.contractorCompany,
    workStartAt: input.workStartAt,
  }));
}
