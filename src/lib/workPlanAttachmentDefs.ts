import { supabase } from '@/integrations/supabase/client';
import {
  generateAttachments,
  withKind,
  type AttachmentItem,
  type AttachmentKind,
} from '@/lib/attachmentTemplates';

export type WorkPlanAttachmentDefRow = {
  id?: string;
  project_id: string;
  work_type: string;
  attachment_key: string;
  name: string;
  description: string;
  category: AttachmentKind;
  is_mandatory: boolean;
  is_enabled: boolean;
  is_custom: boolean;
  sort_order: number;
};

export type ResolvedAttachmentItem = AttachmentItem & {
  enabled: boolean;
  isCustom?: boolean;
  fromOverride?: boolean;
};

/** Pure merge: code template ⊕ project defs */
export function mergeAttachmentDefs(
  baseItems: AttachmentItem[],
  defs: Array<Pick<
    WorkPlanAttachmentDefRow,
    'work_type' | 'attachment_key' | 'name' | 'description' | 'category' | 'is_mandatory' | 'is_enabled' | 'is_custom' | 'sort_order'
  >>,
  workType: string,
): ResolvedAttachmentItem[] {
  const applicable = defs.filter((d) => d.work_type === '*' || d.work_type === workType);
  // Specific work_type wins over '*'
  const byKey = new Map<string, (typeof applicable)[number]>();
  for (const d of applicable.filter((x) => x.work_type === '*')) byKey.set(d.attachment_key, d);
  for (const d of applicable.filter((x) => x.work_type === workType)) byKey.set(d.attachment_key, d);

  const result: ResolvedAttachmentItem[] = [];
  const seen = new Set<string>();

  for (const raw of baseItems.map(withKind)) {
    const ov = byKey.get(raw.key);
    seen.add(raw.key);
    if (ov && !ov.is_enabled) continue;
    result.push({
      ...raw,
      name: ov?.name || raw.name,
      description: ov?.description || raw.description,
      kind: (ov?.category as AttachmentKind) || raw.kind,
      required: ov ? !!ov.is_mandatory : !!raw.required,
      enabled: true,
      fromOverride: !!ov,
      isCustom: false,
    });
  }

  // Custom enabled defs for this scope
  const customs = applicable
    .filter((d) => d.is_custom && d.is_enabled && !seen.has(d.attachment_key))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  for (const c of customs) {
    result.push({
      key: c.attachment_key,
      name: c.name || c.attachment_key,
      description: c.description || '',
      category: c.category === 'legal' ? '공통서류' : c.category === 'calc_evidence' ? '계획' : '안전',
      kind: c.category,
      required: !!c.is_mandatory,
      enabled: true,
      isCustom: true,
      fromOverride: true,
    });
  }

  return result;
}

export async function fetchProjectAttachmentDefs(projectId: string): Promise<WorkPlanAttachmentDefRow[]> {
  const { data, error } = await supabase
    .from('work_plan_attachment_defs' as any)
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data as any[]) || []).map((r) => ({
    id: r.id,
    project_id: r.project_id,
    work_type: r.work_type || '*',
    attachment_key: r.attachment_key,
    name: r.name || '',
    description: r.description || '',
    category: (r.category || 'site_proof') as AttachmentKind,
    is_mandatory: !!r.is_mandatory,
    is_enabled: r.is_enabled !== false,
    is_custom: !!r.is_custom,
    sort_order: Number(r.sort_order || 0),
  }));
}

export async function resolveAttachmentsForProject(opts: {
  projectId: string;
  workType: string;
  conditions?: Record<string, string>;
}): Promise<ResolvedAttachmentItem[]> {
  const base = generateAttachments(opts.workType, opts.conditions).map(withKind);
  let defs: WorkPlanAttachmentDefRow[] = [];
  try {
    defs = await fetchProjectAttachmentDefs(opts.projectId);
  } catch {
    defs = [];
  }
  return mergeAttachmentDefs(base, defs, opts.workType);
}

export function slugifyAttachmentKey(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\uac00-\ud7a3-]/gi, '')
    .slice(0, 40);
  return `custom_${base || 'item'}_${Date.now().toString(36).slice(-4)}`;
}
