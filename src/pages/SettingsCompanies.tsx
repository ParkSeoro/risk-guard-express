import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Building2, Plus, Search, Pencil, Trash2, Merge, Network } from 'lucide-react';

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  business_no: string | null;
  contact: string | null;
  address: string | null;
  is_deleted: boolean;
  project_count: number;
}

const TYPE_OPTIONS = [
  { v: 'client', label: '발주처' },
  { v: 'gc', label: '원도급' },
  { v: 'contractor', label: '시공사' },
  { v: 'vendor', label: '협력사' },
];

const emptyForm = { id: '', name: '', type: 'contractor', business_no: '', contact: '', address: '' };

export default function SettingsCompanies() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const canEdit = hasRole('master') || hasRole('project_admin');

  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSrc, setMergeSrc] = useState<string>('');
  const [mergeDst, setMergeDst] = useState<string>('');

  const fetchAll = async () => {
    setLoading(true);
    const { data: companies } = await (supabase as any)
      .from('companies')
      .select('id, name, type, business_no, contact, address, is_deleted')
      .order('is_deleted')
      .order('name');
    const list = companies || [];
    const ids = list.map((c: any) => c.id);
    const projectCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: pcs } = await (supabase as any)
        .from('project_companies')
        .select('company_id')
        .in('company_id', ids)
        .eq('is_deleted', false);
      (pcs || []).forEach((p: any) => {
        projectCounts[p.company_id] = (projectCounts[p.company_id] || 0) + 1;
      });
    }
    setRows(list.map((c: any) => ({ ...c, project_count: projectCounts[c.id] || 0 })));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    if (!search) return true;
    const t = search.toLowerCase();
    return r.name?.toLowerCase().includes(t) || r.business_no?.toLowerCase().includes(t);
  }), [rows, search]);

  const openNew = () => { setForm({ ...emptyForm }); setShowDialog(true); };
  const openEdit = (r: CompanyRow) => {
    setForm({ id: r.id, name: r.name, type: r.type, business_no: r.business_no || '', contact: r.contact || '', address: r.address || '' });
    setShowDialog(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast({ title: '회사명을 입력해주세요', variant: 'destructive' }); return; }
    const payload = {
      name: form.name.trim(),
      type: form.type,
      business_no: form.business_no.trim() || null,
      contact: form.contact.trim() || null,
      address: form.address.trim() || null,
    };
    let error;
    if (form.id) {
      ({ error } = await (supabase as any).from('companies').update(payload).eq('id', form.id));
    } else {
      ({ error } = await (supabase as any).from('companies').insert(payload));
    }
    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: form.id ? '수정되었습니다' : '등록되었습니다' });
    setShowDialog(false);
    fetchAll();
  };

  const softDelete = async (id: string) => {
    if (!confirm('이 업체를 삭제하시겠습니까? (프로젝트 연결도 함께 해제됩니다)')) return;
    const { error } = await (supabase as any).from('companies')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast({ title: '삭제 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '삭제되었습니다' });
    fetchAll();
  };

  const doMerge = async () => {
    if (!mergeSrc || !mergeDst || mergeSrc === mergeDst) {
      toast({ title: '원본/대상 업체를 다르게 선택해주세요', variant: 'destructive' });
      return;
    }
    const src = rows.find(r => r.id === mergeSrc);
    const dst = rows.find(r => r.id === mergeDst);
    if (!confirm(`"${src?.name}" 을(를) "${dst?.name}"(으)로 병합합니다. 되돌릴 수 없습니다. 계속?`)) return;
    const { error } = await (supabase as any).rpc('merge_companies', { _src: mergeSrc, _dst: mergeDst });
    if (error) { toast({ title: '병합 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '병합되었습니다' });
    setMergeMode(false); setMergeSrc(''); setMergeDst('');
    fetchAll();
  };

  if (!canEdit) {
    return <div className="p-6 text-sm text-muted-foreground">마스터/프로젝트 관리자만 접근할 수 있습니다.</div>;
  }

  const activeRows = filtered.filter(r => !r.is_deleted);

  return (
    <div className="p-6 space-y-4 max-w-5xl animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> 업체 관리 (시스템)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            시스템 전역 업체 정보를 관리합니다. 여기서 등록된 업체는 프로젝트별로 참여 지정할 수 있고, 각 모듈에서 자동으로 소속 업체로 매핑됩니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setMergeMode(m => !m)}>
            <Merge className="h-4 w-4 mr-1" /> 병합 도구
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> 신규 등록
          </Button>
        </div>
      </div>

      {mergeMode && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm">중복 업체 병합</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">원본(사라질 업체)을 대상(남을 업체)에 병합합니다. 관리자·부서·근로자·프로젝트 연결이 모두 대상으로 이관됩니다.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">원본 (Source)</Label>
                <Select value={mergeSrc} onValueChange={setMergeSrc}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {activeRows.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">대상 (Destination)</Label>
                <Select value={mergeDst} onValueChange={setMergeDst}>
                  <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {activeRows.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button size="sm" onClick={doMerge} disabled={!mergeSrc || !mergeDst}>병합 실행</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-3 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="회사명, 사업자번호 검색..." className="h-8 pl-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{activeRows.length}개 / 전체 {rows.length}</span>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {activeRows.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">등록된 업체가 없습니다.</div>
              ) : activeRows.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{r.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {TYPE_OPTIONS.find(o => o.v === r.type)?.label || r.type}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        <Network className="h-2.5 w-2.5 mr-1" /> 참여 프로젝트 {r.project_count}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {r.business_no && <span>사업자 {r.business_no} · </span>}
                      {r.contact && <span>{r.contact} · </span>}
                      {r.address}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => softDelete(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? '업체 수정' : '신규 업체 등록'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">회사명 *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">업체 유형</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">사업자등록번호</Label>
              <Input value={form.business_no} onChange={e => setForm({ ...form, business_no: e.target.value })} placeholder="000-00-00000" />
            </div>
            <div>
              <Label className="text-xs">대표 연락처</Label>
              <Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">주소</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>취소</Button>
            <Button onClick={save}>{form.id ? '수정' : '등록'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
