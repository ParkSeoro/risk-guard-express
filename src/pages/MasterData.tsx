import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";

const MasterData = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [processes, setProcesses] = useState<any[]>([]);
  const [ppe, setPpe] = useState<any[]>([]);
  const [legalRefs, setLegalRefs] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [assignees, setAssignees] = useState<any[]>([]);

  // Dialog states
  const [editDialog, setEditDialog] = useState<{ type: string; item?: any } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const fetchAll = async () => {
    const [p, pp, lr, d, a] = await Promise.all([
      supabase.from('master_processes').select('*').order('name'),
      supabase.from('master_ppe').select('*').order('name'),
      supabase.from('legal_references').select('*').order('law_name'),
      supabase.from('master_departments').select('*').order('name'),
      supabase.from('master_assignees').select('*, master_departments(name)').order('name'),
    ]);
    setProcesses(p.data || []);
    setPpe(pp.data || []);
    setLegalRefs(lr.data || []);
    setDepartments(d.data || []);
    setAssignees(a.data || []);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async () => {
    if (!editDialog) return;
    const { type, item } = editDialog;

    if (type === 'process') {
      if (item) {
        await supabase.from('master_processes').update({ name: form.name, category: form.category }).eq('id', item.id);
      } else {
        await supabase.from('master_processes').insert([{ name: form.name, category: form.category }]);
      }
    } else if (type === 'ppe') {
      if (item) {
        await supabase.from('master_ppe').update({ name: form.name, icon: form.icon }).eq('id', item.id);
      } else {
        await supabase.from('master_ppe').insert([{ name: form.name, icon: form.icon }]);
      }
    } else if (type === 'legal') {
      const data = {
        law_name: form.law_name, article: form.article, description: form.description,
        keywords: (form.keywords || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        process_mappings: (form.process_mappings || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        link: form.link, needs_review: form.needs_review || false,
      };
      if (item) {
        await supabase.from('legal_references').update(data).eq('id', item.id);
      } else {
        await supabase.from('legal_references').insert([data]);
      }
    } else if (type === 'department') {
      if (item) {
        await supabase.from('master_departments').update({ name: form.name }).eq('id', item.id);
      } else {
        await supabase.from('master_departments').insert([{ name: form.name }]);
      }
    } else if (type === 'assignee') {
      const data = { name: form.name, position: form.position, phone: form.phone, department_id: form.department_id };
      if (item) {
        await supabase.from('master_assignees').update(data).eq('id', item.id);
      } else {
        await supabase.from('master_assignees').insert([data]);
      }
    }

    toast({ title: item ? '수정되었습니다.' : '추가되었습니다.' });
    setEditDialog(null);
    fetchAll();
  };

  const handleDelete = async (type: string, id: string) => {
    const table = type === 'process' ? 'master_processes' : type === 'ppe' ? 'master_ppe' : type === 'legal' ? 'legal_references' : type === 'department' ? 'master_departments' : 'master_assignees';
    await supabase.from(table).delete().eq('id', id);
    toast({ title: '삭제되었습니다.' });
    fetchAll();
  };

  const openEdit = (type: string, item?: any) => {
    if (type === 'legal' && item) {
      setForm({ ...item, keywords: (item.keywords || []).join(', '), process_mappings: (item.process_mappings || []).join(', ') });
    } else {
      setForm(item || {});
    }
    setEditDialog({ type, item });
  };

  const admin = isAdmin();

  return (
    <div className="space-y-4 animate-fade-in">
      <div><h1 className="text-2xl font-bold">기준정보 관리</h1><p className="text-sm text-muted-foreground mt-1">마스터 데이터 및 법적근거</p></div>

      <Tabs defaultValue="processes">
        <TabsList>
          <TabsTrigger value="processes">공정 목록</TabsTrigger>
          <TabsTrigger value="ppe">PPE 목록</TabsTrigger>
          <TabsTrigger value="legal">법적근거</TabsTrigger>
          <TabsTrigger value="departments">부서·담당자</TabsTrigger>
        </TabsList>

        <TabsContent value="processes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">공정 목록</CardTitle>
              {admin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit('process')}><Plus className="h-3.5 w-3.5" /> 추가</Button>}
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>공정명</th><th>분류</th>{admin && <th className="w-20 text-center">작업</th>}</tr></thead>
                <tbody>
                  {processes.map(p => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td><Badge variant="secondary" className="text-[10px]">{p.category}</Badge></td>
                      {admin && <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('process', p)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete('process', p.id)}><Trash2 className="h-3 w-3" /></Button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ppe">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">PPE (개인보호구) 목록</CardTitle>
              {admin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit('ppe')}><Plus className="h-3.5 w-3.5" /> 추가</Button>}
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>아이콘</th><th>보호구명</th>{admin && <th className="w-20 text-center">작업</th>}</tr></thead>
                <tbody>
                  {ppe.map(p => (
                    <tr key={p.id}>
                      <td className="w-10 text-center text-lg">{p.icon || '🛡️'}</td>
                      <td>{p.name}</td>
                      {admin && <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('ppe', p)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete('ppe', p.id)}><Trash2 className="h-3 w-3" /></Button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legal">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">법적근거 목록</CardTitle>
              {admin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit('legal')}><Plus className="h-3.5 w-3.5" /> 추가</Button>}
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>법령명</th><th>조문</th><th>설명</th><th>공종 매핑</th><th>검토</th>{admin && <th className="w-20 text-center">작업</th>}</tr></thead>
                <tbody>
                  {legalRefs.map(l => (
                    <tr key={l.id}>
                      <td className="font-medium whitespace-nowrap">{l.law_name}</td>
                      <td className="whitespace-nowrap">{l.article}</td>
                      <td>{l.description}</td>
                      <td className="text-xs">{(l.process_mappings || []).join(', ')}</td>
                      <td className="text-center">
                        {l.needs_review && <Badge variant="outline" className="text-[10px] gap-1"><AlertTriangle className="h-2.5 w-2.5" />검토필요</Badge>}
                      </td>
                      {admin && <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('legal', l)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete('legal', l.id)}><Trash2 className="h-3 w-3" /></Button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">부서</CardTitle>
                {admin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit('department')}><Plus className="h-3.5 w-3.5" /> 추가</Button>}
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full data-table text-sm">
                  <thead><tr><th>부서명</th>{admin && <th className="w-20 text-center">작업</th>}</tr></thead>
                  <tbody>
                    {departments.map(d => (
                      <tr key={d.id}>
                        <td className="font-medium">{d.name}</td>
                        {admin && <td className="text-center">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('department', d)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete('department', d.id)}><Trash2 className="h-3 w-3" /></Button>
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">담당자</CardTitle>
                {admin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit('assignee')}><Plus className="h-3.5 w-3.5" /> 추가</Button>}
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full data-table text-sm">
                  <thead><tr><th>이름</th><th>부서</th><th>직위</th><th>연락처</th>{admin && <th className="w-16 text-center">작업</th>}</tr></thead>
                  <tbody>
                    {assignees.map(a => (
                      <tr key={a.id}>
                        <td className="font-medium">{a.name}</td>
                        <td><Badge variant="secondary" className="text-[10px]">{a.master_departments?.name || '—'}</Badge></td>
                        <td>{a.position}</td>
                        <td className="text-muted-foreground">{a.phone}</td>
                        {admin && <td className="text-center">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('assignee', a)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete('assignee', a.id)}><Trash2 className="h-3 w-3" /></Button>
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit/Add Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editDialog?.item ? '수정' : '추가'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {editDialog?.type === 'process' && (
              <>
                <div className="space-y-1"><Label>공정명</Label><Input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div className="space-y-1"><Label>분류</Label><Input value={form.category || ''} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="기계/건축/토목/전기/마감" /></div>
              </>
            )}
            {editDialog?.type === 'ppe' && (
              <>
                <div className="space-y-1"><Label>보호구명</Label><Input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div className="space-y-1"><Label>아이콘(이모지)</Label><Input value={form.icon || ''} onChange={e => setForm(p => ({ ...p, icon: e.target.value }))} /></div>
              </>
            )}
            {editDialog?.type === 'legal' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>법령명</Label><Input value={form.law_name || ''} onChange={e => setForm(p => ({ ...p, law_name: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>조문</Label><Input value={form.article || ''} onChange={e => setForm(p => ({ ...p, article: e.target.value }))} /></div>
                </div>
                <div className="space-y-1"><Label>설명</Label><Input value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <div className="space-y-1"><Label>키워드 (쉼표 구분)</Label><Input value={form.keywords || ''} onChange={e => setForm(p => ({ ...p, keywords: e.target.value }))} /></div>
                <div className="space-y-1"><Label>공종 매핑 (쉼표 구분)</Label><Input value={form.process_mappings || ''} onChange={e => setForm(p => ({ ...p, process_mappings: e.target.value }))} /></div>
                <div className="space-y-1"><Label>관련 링크</Label><Input value={form.link || ''} onChange={e => setForm(p => ({ ...p, link: e.target.value }))} /></div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={form.needs_review || false} onCheckedChange={v => setForm(p => ({ ...p, needs_review: v }))} />
                  <Label>검토 필요</Label>
                </div>
              </>
            )}
            {editDialog?.type === 'department' && (
              <div className="space-y-1"><Label>부서명</Label><Input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            )}
            {editDialog?.type === 'assignee' && (
              <>
                <div className="space-y-1"><Label>이름</Label><Input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div className="space-y-1"><Label>직위</Label><Input value={form.position || ''} onChange={e => setForm(p => ({ ...p, position: e.target.value }))} /></div>
                <div className="space-y-1"><Label>연락처</Label><Input value={form.phone || ''} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
                <div className="space-y-1">
                  <Label>부서</Label>
                  <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.department_id || ''} onChange={e => setForm(p => ({ ...p, department_id: e.target.value }))}>
                    <option value="">선택</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </>
            )}
            <Button onClick={handleSave} className="w-full">{editDialog?.item ? '저장' : '추가'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MasterData;
