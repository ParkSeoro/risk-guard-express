/**
 * 작업계획서 증빙(첨부) 필수/선택 설정
 * - 마스터 · 프로젝트관리자만 편집
 * - 코드 템플릿 기본값 + 프로젝트 오버라이드 + 커스텀 추가
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { generateAttachments, withKind, type AttachmentKind } from '@/lib/attachmentTemplates';
import { WORK_PLAN_TYPES } from '@/lib/workPlanTemplates';
import {
  fetchProjectAttachmentDefs,
  mergeAttachmentDefs,
  slugifyAttachmentKey,
  type WorkPlanAttachmentDefRow,
} from '@/lib/workPlanAttachmentDefs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList, Plus, Save, Trash2 } from 'lucide-react';

type EditorRow = {
  key: string;
  name: string;
  description: string;
  category: AttachmentKind;
  is_mandatory: boolean;
  is_enabled: boolean;
  is_custom: boolean;
  templateDefaultRequired: boolean;
  dirty: boolean;
  defId?: string;
};

const KIND_LABEL: Record<AttachmentKind, string> = {
  legal: '법정/인허가',
  calc_evidence: '계산·도면',
  site_proof: '현장증빙',
};

export default function SettingsWorkPlanAttachments() {
  const { hasRole, user } = useAuth();
  const access = useGlobalProjectAccess();
  const { toast } = useToast();

  // 마스터·프로젝트관리자·안전관리자 (해당 프로젝트 역할)
  const canEdit =
    hasRole('master')
    || hasRole('project_admin')
    || access.userRole === 'project_admin'
    || access.userRole === 'safety_manager';
  const projectId = access.selectedProject;

  const [workType, setWorkType] = useState('heavy_lifting');
  const [defs, setDefs] = useState<WorkPlanAttachmentDefRow[]>([]);
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMandatory, setNewMandatory] = useState(true);
  const [newKind, setNewKind] = useState<AttachmentKind>('site_proof');

  const workTypeOptions = useMemo(
    () => [
      { id: '*', name: '공통(전 공종)' },
      ...WORK_PLAN_TYPES.map((t) => ({ id: t.id, name: t.name })),
    ],
    [],
  );

  const rebuildRows = useCallback((nextDefs: WorkPlanAttachmentDefRow[], wt: string) => {
    const base = wt === '*'
      ? generateAttachments('heavy_lifting').filter((a) =>
          ['biz_license', 'insurance_cert', 'safety_training', 'risk_assessment', 'work_instruction'].includes(a.key)
            || a.category === '공통서류',
        )
      : generateAttachments(wt);
    const merged = mergeAttachmentDefs(base.map(withKind), nextDefs, wt === '*' ? 'heavy_lifting' : wt);

    // For '*' editor, show common template + custom/overrides scoped to '*'
    const templateKeys = new Set(base.map((b) => b.key));
    const editor: EditorRow[] = [];

    if (wt === '*') {
      for (const b of base.map(withKind)) {
        const ov = nextDefs.find((d) => d.work_type === '*' && d.attachment_key === b.key);
        editor.push({
          key: b.key,
          name: ov?.name || b.name,
          description: ov?.description || b.description,
          category: (ov?.category as AttachmentKind) || b.kind || 'legal',
          is_mandatory: ov ? ov.is_mandatory : !!b.required,
          is_enabled: ov ? ov.is_enabled : true,
          is_custom: false,
          templateDefaultRequired: !!b.required,
          dirty: false,
          defId: ov?.id,
        });
      }
      for (const d of nextDefs.filter((x) => x.work_type === '*' && x.is_custom)) {
        if (templateKeys.has(d.attachment_key)) continue;
        editor.push({
          key: d.attachment_key,
          name: d.name,
          description: d.description,
          category: d.category,
          is_mandatory: d.is_mandatory,
          is_enabled: d.is_enabled,
          is_custom: true,
          templateDefaultRequired: false,
          dirty: false,
          defId: d.id,
        });
      }
    } else {
      for (const m of merged) {
        const ov = nextDefs.find((d) =>
          d.attachment_key === m.key && (d.work_type === wt || d.work_type === '*'),
        );
        // Prefer work-type specific def id
        const specific = nextDefs.find((d) => d.work_type === wt && d.attachment_key === m.key);
        editor.push({
          key: m.key,
          name: m.name,
          description: m.description || '',
          category: m.kind || 'site_proof',
          is_mandatory: !!m.required,
          is_enabled: true,
          is_custom: !!m.isCustom,
          templateDefaultRequired: !!generateAttachments(wt).find((t) => t.key === m.key)?.required,
          dirty: false,
          defId: specific?.id || (ov?.work_type === wt ? ov.id : undefined),
        });
      }
      // disabled overrides for this work type (hidden from merge) — still show so admin can re-enable
      for (const d of nextDefs.filter((x) => x.work_type === wt && !x.is_enabled && !x.is_custom)) {
        if (editor.some((e) => e.key === d.attachment_key)) continue;
        const tpl = generateAttachments(wt).map(withKind).find((t) => t.key === d.attachment_key);
        editor.push({
          key: d.attachment_key,
          name: d.name || tpl?.name || d.attachment_key,
          description: d.description || tpl?.description || '',
          category: d.category,
          is_mandatory: d.is_mandatory,
          is_enabled: false,
          is_custom: false,
          templateDefaultRequired: !!tpl?.required,
          dirty: false,
          defId: d.id,
        });
      }
    }

    setRows(editor);
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await fetchProjectAttachmentDefs(projectId);
      setDefs(data);
      rebuildRows(data, workType);
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast({
        title: '설정 로드 실패',
        description: /relation|does not exist|permission denied|schema cache/i.test(msg)
          ? `${msg} — Supabase에 work_plan_attachment_defs 마이그레이션(GRANT 포함)을 적용했는지 확인하세요.`
          : msg,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, workType, rebuildRows, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    rebuildRows(defs, workType);
  }, [workType, defs, rebuildRows]);

  function patchRow(key: string, patch: Partial<EditorRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));
  }

  async function saveAll() {
    if (!projectId || !canEdit) return;
    const toSave = rows.filter((r) => r.dirty);
    if (!toSave.length) {
      toast({ title: '변경 사항이 없습니다.' });
      return;
    }
    setSaving(true);
    try {
      for (const r of toSave) {
        const payload = {
          project_id: projectId,
          work_type: workType,
          attachment_key: r.key,
          name: r.name,
          description: r.description,
          category: r.category,
          is_mandatory: r.is_mandatory,
          is_enabled: r.is_enabled,
          is_custom: r.is_custom,
          created_by: user?.id || null,
        };
        if (r.defId) {
          const { error } = await supabase.from('work_plan_attachment_defs' as any).update(payload).eq('id', r.defId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('work_plan_attachment_defs' as any).upsert(payload, {
            onConflict: 'project_id,work_type,attachment_key',
          });
          if (error) throw error;
        }
      }
      toast({
        title: '저장됨',
        description: '작업계획서 「첨부」 탭을 다시 열면 필수/선택이 반영됩니다.',
      });
      await load();
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast({
        title: '저장 실패',
        description: /relation|does not exist|permission denied|schema cache/i.test(msg)
          ? `${msg} — SQL 마이그레이션(20260807051000_fix_work_plan_attachment_defs_grants.sql)을 적용하세요.`
          : msg,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  async function addCustom() {
    if (!projectId || !newName.trim()) return;
    const key = slugifyAttachmentKey(newName);
    const payload = {
      project_id: projectId,
      work_type: workType,
      attachment_key: key,
      name: newName.trim(),
      description: newDesc.trim(),
      category: newKind,
      is_mandatory: newMandatory,
      is_enabled: true,
      is_custom: true,
      sort_order: 900 + rows.length,
      created_by: user?.id || null,
    };
    const { error } = await supabase.from('work_plan_attachment_defs' as any).insert(payload);
    if (error) {
      toast({ title: '추가 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '증빙 항목 추가됨' });
    setAddOpen(false);
    setNewName('');
    setNewDesc('');
    setNewMandatory(true);
    await load();
  }

  async function removeCustom(row: EditorRow) {
    if (!row.is_custom || !row.defId) return;
    if (!window.confirm(`「${row.name}」 커스텀 항목을 삭제할까요?`)) return;
    const { error } = await supabase.from('work_plan_attachment_defs' as any).delete().eq('id', row.defId);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '삭제됨' });
    await load();
  }

  if (!canEdit) {
    return <Navigate to="/app/admin/settings" replace />;
  }

  if (!projectId) {
    return <div className="text-sm text-muted-foreground">프로젝트를 선택하세요.</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> 작업계획서 증빙 설정
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          마스터·프로젝트관리자가 공종별 첨부 필수/선택·사용여부를 정하고, 현장 맞춤 증빙을 추가합니다.
          결재 차단은 「필수」로 설정된 항목만 적용됩니다.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">공종 선택</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> 증빙 추가
              </Button>
              <Button size="sm" className="gap-1" onClick={saveAll} disabled={saving || !rows.some((r) => r.dirty)}>
                <Save className="h-3.5 w-3.5" /> {saving ? '저장 중…' : '변경 저장'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={workType} onValueChange={setWorkType}>
            <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
            <SelectContent>
              {workTypeOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {loading ? (
            <p className="text-sm text-muted-foreground py-8">로딩 중…</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>사용</TableHead>
                    <TableHead>필수</TableHead>
                    <TableHead>증빙명</TableHead>
                    <TableHead>분류</TableHead>
                    <TableHead>기본값</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key} className={!r.is_enabled ? 'opacity-60' : undefined}>
                      <TableCell>
                        <Switch
                          checked={r.is_enabled}
                          onCheckedChange={(v) => patchRow(r.key, { is_enabled: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={r.is_mandatory}
                          disabled={!r.is_enabled}
                          onCheckedChange={(v) => patchRow(r.key, { is_mandatory: v })}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {r.name}
                          {r.is_custom && <Badge variant="secondary" className="text-[10px]">추가</Badge>}
                          {r.dirty && <Badge variant="outline" className="text-[10px]">수정</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{r.description || r.key}</div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.category}
                          onValueChange={(v) => patchRow(r.key, { category: v as AttachmentKind })}
                        >
                          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(KIND_LABEL) as AttachmentKind[]).map((k) => (
                              <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.is_custom ? '커스텀' : (r.templateDefaultRequired ? '템플릿:필수' : '템플릿:선택')}
                      </TableCell>
                      <TableCell>
                        {r.is_custom && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeCustom(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground text-sm">항목 없음</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>증빙 항목 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>증빙명</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 현장 안전모 지급대장" />
            </div>
            <div className="space-y-1">
              <Label>설명</Label>
              <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>분류</Label>
              <Select value={newKind} onValueChange={(v) => setNewKind(v as AttachmentKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as AttachmentKind[]).map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label>필수 첨부</Label>
              <Switch checked={newMandatory} onCheckedChange={setNewMandatory} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
            <Button onClick={addCustom} disabled={!newName.trim()}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
