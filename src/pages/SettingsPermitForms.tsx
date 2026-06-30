/**
 * 허가서 양식 디자인 (마스터 전용)
 * - permit_form_templates 의 layout_json 을 직접 편집/버전관리.
 * - 코드/이름/버전/기본여부/활성여부를 관리하고, SF003 표준양식을 복제해 새 버전을 만들 수 있음.
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FileSignature, Plus, Copy, Trash2, Save, Eye } from 'lucide-react';

type Tpl = {
  id: string;
  project_id: string | null;
  code: string;
  name: string;
  version: string;
  layout_json: any;
  is_default: boolean;
  is_active: boolean;
  updated_at: string;
};

export default function SettingsPermitForms() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');
  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Tpl | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('permit_form_templates')
      .select('id, project_id, code, name, version, layout_json, is_default, is_active, updated_at')
      .eq('is_deleted', false)
      .order('code')
      .order('version', { ascending: false });
    if (error) toast({ title: '불러오기 실패', description: error.message, variant: 'destructive' });
    setRows((data || []) as Tpl[]);
    setLoading(false);
  };

  useEffect(() => { if (isMaster) load(); }, [isMaster]);

  if (!isMaster) return <Navigate to="/settings" replace />;

  const openEdit = (t: Tpl) => {
    setSelected(t);
    setJsonText(JSON.stringify(t.layout_json ?? {}, null, 2));
    setJsonErr(null);
  };

  const validateJson = (text: string) => {
    try { JSON.parse(text); setJsonErr(null); return true; }
    catch (e: any) { setJsonErr(e.message); return false; }
  };

  const save = async () => {
    if (!selected) return;
    if (!validateJson(jsonText)) return;
    const payload = {
      code: selected.code.trim(),
      name: selected.name.trim(),
      version: selected.version.trim(),
      is_default: selected.is_default,
      is_active: selected.is_active,
      layout_json: JSON.parse(jsonText),
    };
    const { error } = await supabase.from('permit_form_templates').update(payload).eq('id', selected.id);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    toast({ title: '양식이 저장되었습니다.' });
    await load();
  };

  const createNew = async (clone?: Tpl) => {
    const base = clone
      ? { code: clone.code, name: `${clone.name} (복제)`, version: 'v' + Date.now().toString().slice(-4), layout_json: clone.layout_json }
      : { code: 'CUSTOM-' + Date.now().toString().slice(-4), name: '새 허가서 양식', version: 'v1', layout_json: { header: { title: '안전작업허가서' }, sections: [] } };
    const { data, error } = await supabase
      .from('permit_form_templates')
      .insert({ ...base, project_id: null, is_default: false, is_active: true } as any)
      .select()
      .single();
    if (error) return toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    toast({ title: '새 양식이 생성되었습니다.' });
    await load();
    openEdit(data as Tpl);
  };

  const remove = async (t: Tpl) => {
    if (!confirm(`"${t.name}" ${t.version} 양식을 삭제하시겠습니까? (소프트 삭제)`)) return;
    const { error } = await supabase.from('permit_form_templates').update({ is_deleted: true }).eq('id', t.id);
    if (error) return toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    if (selected?.id === t.id) setSelected(null);
    await load();
    toast({ title: '삭제되었습니다.' });
  };

  const previewLayout = useMemo(() => {
    try { return JSON.parse(jsonText); } catch { return null; }
  }, [jsonText]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSignature className="h-6 w-6" /> 허가서 양식 디자인
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            마스터 전용. SF003 표준양식을 포함한 모든 허가서 양식의 레이아웃(JSON)을 관리합니다.
          </p>
        </div>
        <Button size="sm" onClick={() => createNew()}><Plus className="h-4 w-4 mr-1" />새 양식</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">양식 목록</CardTitle></CardHeader>
          <CardContent className="p-2 space-y-1 max-h-[70vh] overflow-auto">
            {loading && <div className="text-xs text-muted-foreground p-2">불러오는 중...</div>}
            {!loading && rows.length === 0 && <div className="text-xs text-muted-foreground p-2">등록된 양식이 없습니다.</div>}
            {rows.map(t => (
              <div
                key={t.id}
                className={`p-2 rounded border cursor-pointer hover:bg-accent ${selected?.id === t.id ? 'border-primary bg-accent/40' : 'border-transparent'}`}
                onClick={() => openEdit(t)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{t.code} · {t.version}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {t.is_default && <Badge variant="outline" className="text-[10px]">기본</Badge>}
                    {!t.is_active && <Badge variant="outline" className="text-[10px] text-muted-foreground">비활성</Badge>}
                  </div>
                </div>
                <div className="flex gap-1 mt-1">
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={(e) => { e.stopPropagation(); createNew(t); }}>
                    <Copy className="h-3 w-3 mr-1" />복제
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-destructive" onClick={(e) => { e.stopPropagation(); remove(t); }}>
                    <Trash2 className="h-3 w-3 mr-1" />삭제
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {selected ? `편집: ${selected.name}` : '양식을 선택하세요'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selected && <div className="text-sm text-muted-foreground">왼쪽에서 양식을 선택하거나 새 양식을 생성하세요.</div>}
            {selected && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label className="text-xs">코드</Label>
                    <Input value={selected.code} onChange={(e) => setSelected({ ...selected, code: e.target.value })} />
                  </div>
                  <div><Label className="text-xs">이름</Label>
                    <Input value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} />
                  </div>
                  <div><Label className="text-xs">버전</Label>
                    <Input value={selected.version} onChange={(e) => setSelected({ ...selected, version: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={selected.is_default} onCheckedChange={(v) => setSelected({ ...selected, is_default: v })} />
                    기본 양식으로 사용
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={selected.is_active} onCheckedChange={(v) => setSelected({ ...selected, is_active: v })} />
                    활성
                  </label>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs">레이아웃 JSON</Label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4 mr-1" />미리보기</Button>
                      <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" />저장</Button>
                    </div>
                  </div>
                  <Textarea
                    value={jsonText}
                    onChange={(e) => { setJsonText(e.target.value); validateJson(e.target.value); }}
                    rows={22}
                    className="font-mono text-xs"
                  />
                  {jsonErr && <div className="text-xs text-destructive mt-1">JSON 오류: {jsonErr}</div>}
                  <p className="text-[11px] text-muted-foreground mt-2">
                    구조 예시: <code>{`{ header:{title,doc_no,rev}, sections:[{id,title,fields:[{key,label,type,required}]}] }`}</code>
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>레이아웃 미리보기</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] overflow-auto border rounded p-4 bg-white">
            {!previewLayout && <div className="text-sm text-destructive">JSON이 유효하지 않습니다.</div>}
            {previewLayout && (
              <div className="space-y-4 text-sm">
                <div className="text-center border-b pb-2">
                  <div className="text-lg font-bold">{previewLayout?.header?.title || '(제목 없음)'}</div>
                  <div className="text-xs text-muted-foreground">
                    {previewLayout?.header?.doc_no} {previewLayout?.header?.rev}
                  </div>
                </div>
                {(previewLayout?.sections || []).map((s: any) => (
                  <div key={s.id || s.title}>
                    <div className="font-semibold mb-1">{s.title}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(s.fields || []).map((f: any) => (
                        <div key={f.key} className="border rounded px-2 py-1">
                          <div className="text-[11px] text-muted-foreground">{f.label} {f.required && <span className="text-destructive">*</span>}</div>
                          <div className="text-xs">{f.type}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPreviewOpen(false)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
