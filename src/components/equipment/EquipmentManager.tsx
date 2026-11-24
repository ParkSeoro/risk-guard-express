import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2, Wrench, Search, Paperclip, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { COMMON_CRANES } from '@/lib/workPlanTemplates';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import { evaluateExpiryStatus } from '@/lib/workPlanOcrHelpers';
import type { EquipmentMasterItem } from '@/lib/workPlanEquipmentLink';

type Equipment = EquipmentMasterItem;

interface Props {
  projectId: string;
  companyId?: string | null;
  onSelect?: (equipment: Equipment) => void;
  selectable?: boolean;
}

const DEFAULT_EQUIPMENT: Omit<Equipment, 'project_id' | 'company_id'>[] = COMMON_CRANES.map(c => ({
  name: c.model,
  rated_capacity: c.maxCapacity,
  manufacturer: '',
  model_name: c.model,
  is_default: true,
}));

export default function EquipmentManager({ projectId, companyId, onSelect, selectable }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [newItem, setNewItem] = useState({ name: '', rated_capacity: '', manufacturer: '', model_name: '' });
  const [docTarget, setDocTarget] = useState<Equipment | null>(null);
  const [docBusyKey, setDocBusyKey] = useState<string | null>(null);
  const [docDates, setDocDates] = useState({ inspection_expiry_date: '', insurance_expiry_date: '' });

  const openDocDialog = (eq: Equipment) => {
    setDocTarget(eq);
    setDocDates({
      inspection_expiry_date: eq.inspection_expiry_date || '',
      insurance_expiry_date: eq.insurance_expiry_date || '',
    });
  };

  const handleUploadEquipmentDoc = async (
    field: 'reg_cert_url' | 'inspection_cert_url' | 'insurance_url' | 'spec_sheet_url',
    file: File,
  ) => {
    if (!docTarget?.id) return;
    setDocBusyKey(field);
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${projectId}/equipment/${docTarget.id}/${field}_${Date.now()}_${safeName}`;
      const uploaded = await uploadAttachmentFile(path, file);
      const { error } = await supabase
        .from('equipment_master')
        .update({ [field]: uploaded.publicUrl } as any)
        .eq('id', docTarget.id);
      if (error) throw error;
      setDocTarget((prev) => (prev ? { ...prev, [field]: uploaded.publicUrl } : prev));
      toast({ title: '장비 서류가 저장되었습니다.' });
      await fetchEquipment();
    } catch (e: any) {
      toast({ title: '서류 업로드 실패', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setDocBusyKey(null);
    }
  };

  const handleSaveDocDates = async () => {
    if (!docTarget?.id) return;
    setDocBusyKey('dates');
    try {
      const { error } = await supabase
        .from('equipment_master')
        .update({
          inspection_expiry_date: docDates.inspection_expiry_date || null,
          insurance_expiry_date: docDates.insurance_expiry_date || null,
        } as any)
        .eq('id', docTarget.id);
      if (error) throw error;
      toast({ title: '유효기간이 저장되었습니다.' });
      setDocTarget(null);
      await fetchEquipment();
    } catch (e: any) {
      toast({ title: '유효기간 저장 실패', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setDocBusyKey(null);
    }
  };

  const fetchEquipment = useCallback(async () => {
    const { data } = await supabase
      .from('equipment_master')
      .select('*')
      .eq('project_id', projectId)
      .order('is_default', { ascending: false })
      .order('name');
    
    if (data && data.length > 0) {
      setEquipment(data as Equipment[]);
    } else if (companyId) {
      // Seed defaults only for a known company. A null company id is rejected for non-managers.
      const defaults = DEFAULT_EQUIPMENT.map(e => ({
        ...e,
        project_id: projectId,
        company_id: companyId,
        created_by: user?.id,
      }));
      const { data: inserted } = await supabase.from('equipment_master').insert(defaults).select();
      if (inserted) setEquipment(inserted as Equipment[]);
    }
    setLoading(false);
  }, [projectId, companyId, user]);

  useEffect(() => { fetchEquipment(); }, [fetchEquipment]);

  const handleAdd = async () => {
    if (!newItem.name.trim()) return;
    const { error } = await supabase.from('equipment_master').insert({
      project_id: projectId,
      company_id: companyId || null,
      name: newItem.name,
      rated_capacity: newItem.rated_capacity ? Number(newItem.rated_capacity) : null,
      manufacturer: newItem.manufacturer,
      model_name: newItem.model_name,
      is_default: false,
      created_by: user?.id,
    });
    if (!error) {
      toast({ title: '장비가 추가되었습니다.' });
      setNewItem({ name: '', rated_capacity: '', manufacturer: '', model_name: '' });
      setShowAdd(false);
      fetchEquipment();
    }
  };

  const handleDelete = async (id: string) => {
    const reason = prompt('장비 삭제 사유를 입력하세요. (필수)');
    if (!reason || !reason.trim()) return;
    const { error } = await supabase.from('equipment_master').delete().eq('id', id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '장비가 삭제되었습니다.' });
    fetchEquipment();
  };

  const filtered = equipment.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.manufacturer.toLowerCase().includes(search.toLowerCase()) ||
    e.model_name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="text-xs text-muted-foreground p-4">장비 로딩 중...</div>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Wrench className="h-4 w-4" /> 장비 관리
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => setShowAdd(true)}>
            <Plus className="h-3 w-3" /> 장비 추가
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {selectable && (
          <p className="text-[11px] text-primary bg-primary/5 border border-primary/20 rounded-md px-2.5 py-1.5">
            장비의 <b>[계획서 적용]</b>을 누르면 <b>본문 장비정보 · 리깅 · 등록된 유효 장비서류(등록증·검사증·보험·제원표)</b>가 이 작업계획서에 한 번에 반영됩니다.
          </p>
        )}
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-8 text-xs pl-8"
            placeholder="장비명, 제조사, 모델 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">장비명 *</Label>
                <Input className="h-7 text-xs" value={newItem.name} onChange={e => setNewItem(prev => ({ ...prev, name: e.target.value }))} placeholder="예: 50톤 크롤러크레인" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">정격하중 (톤)</Label>
                <Input className="h-7 text-xs" type="number" value={newItem.rated_capacity} onChange={e => setNewItem(prev => ({ ...prev, rated_capacity: e.target.value }))} placeholder="50" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">제조사</Label>
                <Input className="h-7 text-xs" value={newItem.manufacturer} onChange={e => setNewItem(prev => ({ ...prev, manufacturer: e.target.value }))} placeholder="예: 두산" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">모델명</Label>
                <Input className="h-7 text-xs" value={newItem.model_name} onChange={e => setNewItem(prev => ({ ...prev, model_name: e.target.value }))} placeholder="예: DX300" />
              </div>
            </div>
            <div className="flex gap-1.5 justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(false)}>취소</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleAdd}>추가</Button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="border px-2 py-1.5 text-left font-medium">장비명</th>
                <th className="border px-2 py-1.5 text-left font-medium">정격하중</th>
                <th className="border px-2 py-1.5 text-left font-medium">제조사</th>
                <th className="border px-2 py-1.5 text-left font-medium">모델명</th>
                <th className="border px-2 py-1.5 text-left font-medium">등록 서류</th>
                <th className="border px-2 py-1.5 text-center font-medium w-44">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const docBadges = [
                  e.reg_cert_url ? { label: '등록증', expired: false } : null,
                  e.inspection_cert_url ? { label: '검사증', expired: evaluateExpiryStatus(e.inspection_expiry_date) === 'expired' } : null,
                  e.insurance_url ? { label: '보험', expired: evaluateExpiryStatus(e.insurance_expiry_date) === 'expired' } : null,
                  e.spec_sheet_url ? { label: '제원표', expired: false } : null,
                ].filter(Boolean) as Array<{ label: string; expired: boolean }>;
                return (
                <tr key={e.id || e.name} className="hover:bg-muted/30 cursor-pointer" onClick={() => selectable && onSelect?.(e)}>
                  <td className="border px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      {e.name}
                      {e.is_default && <Badge variant="secondary" className="text-[9px] h-4">기본</Badge>}
                    </div>
                  </td>
                  <td className="border px-2 py-1">{e.rated_capacity ? `${e.rated_capacity}t` : '—'}</td>
                  <td className="border px-2 py-1 text-muted-foreground">{e.manufacturer || '—'}</td>
                  <td className="border px-2 py-1 text-muted-foreground">{e.model_name || '—'}</td>
                  <td className="border px-2 py-1">
                    {docBadges.length > 0 ? (
                      <div className="flex items-center gap-1 flex-wrap">
                        {docBadges.map((b) => (
                          <Badge
                            key={b.label}
                            variant={b.expired ? 'destructive' : 'outline'}
                            className="text-[9px] h-4 px-1 gap-0.5"
                          >
                            {b.expired && <AlertTriangle className="h-2.5 w-2.5" />}
                            {b.label}{b.expired ? '(만료)' : ''}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">미등록</span>
                    )}
                  </td>
                  <td className="border px-2 py-1 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {selectable && (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          className="h-6 text-[10px] px-2"
                          onClick={(ev) => { ev.stopPropagation(); onSelect?.(e); }}
                        >
                          계획서 적용
                        </Button>
                      )}
                      {e.id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-1.5 gap-0.5"
                          onClick={(ev) => { ev.stopPropagation(); openDocDialog(e); }}
                        >
                          <Paperclip className="h-3 w-3" /> 서류
                        </Button>
                      )}
                      {!e.is_default && e.id && (
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id!); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="border px-2 py-4 text-center text-muted-foreground">장비가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={!!docTarget} onOpenChange={(o) => { if (!o) setDocTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <Paperclip className="h-4 w-4 text-primary" />
              {docTarget?.name} — 장비 서류 관리
            </DialogTitle>
          </DialogHeader>
          {docTarget && (
            <div className="space-y-3 text-xs">
              <p className="text-[11px] text-muted-foreground">
                여기에 한 번 등록해 두면 작업계획서에서 이 장비를 선택할 때 유효한 서류가 첨부파일 탭에 자동 연결됩니다.
              </p>
              {([
                { field: 'reg_cert_url', label: '건설기계·차량 등록증' },
                { field: 'inspection_cert_url', label: '정기검사·안전검사 합격증' },
                { field: 'insurance_url', label: '건설기계·장비 보험증권' },
                { field: 'spec_sheet_url', label: '장비 제원표' },
              ] as const).map(({ field, label }) => {
                const url = docTarget[field];
                return (
                  <div key={field} className="flex items-center justify-between gap-2 rounded border p-2">
                    <div className="min-w-0 flex items-center gap-1.5">
                      {url ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> : <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="font-medium truncate">{label}</span>
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary underline shrink-0">
                          보기
                        </a>
                      )}
                    </div>
                    <label className="cursor-pointer shrink-0">
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*,application/pdf"
                        disabled={docBusyKey === field}
                        onChange={(ev) => {
                          const f = ev.target.files?.[0];
                          if (f) void handleUploadEquipmentDoc(field, f);
                          ev.target.value = '';
                        }}
                      />
                      <Button asChild type="button" size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={docBusyKey === field}>
                        <span>
                          {docBusyKey === field ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                          {url ? '교체' : '업로드'}
                        </span>
                      </Button>
                    </label>
                  </div>
                );
              })}

              <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                <div className="space-y-1">
                  <Label className="text-[11px]">정기·안전검사 만료일</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={docDates.inspection_expiry_date}
                    onChange={(ev) => setDocDates((p) => ({ ...p, inspection_expiry_date: ev.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">보험 만료일</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={docDates.insurance_expiry_date}
                    onChange={(ev) => setDocDates((p) => ({ ...p, insurance_expiry_date: ev.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setDocTarget(null)}>닫기</Button>
            <Button type="button" size="sm" disabled={docBusyKey === 'dates'} onClick={() => void handleSaveDocDates()}>
              {docBusyKey === 'dates' ? '저장 중…' : '만료일 저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
