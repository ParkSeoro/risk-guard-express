import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import DepartmentAssigneeMapping from "@/components/DepartmentAssigneeMapping";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, AlertTriangle, Save } from "lucide-react";
import { GRADES, type RiskGrade, calculateRiskGrade, getGradeClassName, setMatrixConfig, getMatrixConfig } from "@/lib/riskGrade";

const MasterData = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [processes, setProcesses] = useState<any[]>([]);
  const [ppe, setPpe] = useState<any[]>([]);
  const [legalRefs, setLegalRefs] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [assignees, setAssignees] = useState<any[]>([]);
  const [validationRules, setValidationRules] = useState<any[]>([]);

  // Matrix settings
  const [matrix, setMatrix] = useState<Record<string, RiskGrade>>({});
  const [matrixColors, setMatrixColors] = useState<Record<RiskGrade, string>>({ '상': '#ef4444', '중': '#eab308', '하': '#22c55e' });

  const [editDialog, setEditDialog] = useState<{ type: string; item?: any } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const fetchAll = async () => {
    const [p, pp, lr, d, a, vr] = await Promise.all([
      supabase.from('master_processes').select('*').order('name'),
      supabase.from('master_ppe').select('*').order('name'),
      supabase.from('legal_references').select('*').order('law_name'),
      supabase.from('master_departments').select('*').order('name'),
      supabase.from('master_assignees').select('*, master_departments(name)').order('name'),
      supabase.from('validation_rules').select('*').order('rule_name'),
    ]);
    setProcesses(p.data || []);
    setPpe(pp.data || []);
    setLegalRefs(lr.data || []);
    setDepartments(d.data || []);
    setAssignees(a.data || []);
    setValidationRules(vr.data || []);

    // Load matrix config
    const config = getMatrixConfig();
    setMatrix({ ...config.matrix });
    setMatrixColors({ ...config.colors });
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async () => {
    if (!editDialog) return;
    const { type, item } = editDialog;

    if (type === 'process') {
      if (item) await supabase.from('master_processes').update({ name: form.name, category: form.category }).eq('id', item.id);
      else await supabase.from('master_processes').insert([{ name: form.name, category: form.category }]);
    } else if (type === 'ppe') {
      if (item) await supabase.from('master_ppe').update({ name: form.name, icon: form.icon }).eq('id', item.id);
      else await supabase.from('master_ppe').insert([{ name: form.name, icon: form.icon }]);
    } else if (type === 'legal') {
      const data = {
        law_name: form.law_name, article: form.article, description: form.description,
        keywords: (form.keywords || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        process_mappings: (form.process_mappings || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        link: form.link, needs_review: form.needs_review || false,
      };
      if (item) await supabase.from('legal_references').update(data).eq('id', item.id);
      else await supabase.from('legal_references').insert([data]);
    } else if (type === 'department') {
      if (item) await supabase.from('master_departments').update({ name: form.name }).eq('id', item.id);
      else await supabase.from('master_departments').insert([{ name: form.name }]);
    } else if (type === 'assignee') {
      const data = { name: form.name, position: form.position, phone: form.phone, department_id: form.department_id };
      if (item) await supabase.from('master_assignees').update(data).eq('id', item.id);
      else await supabase.from('master_assignees').insert([data]);
    } else if (type === 'rule') {
      const data = { rule_name: form.rule_name, rule_type: form.rule_type, description: form.description, severity: form.severity, weight: Number(form.weight) || 1, is_active: form.is_active !== false };
      if (item) await supabase.from('validation_rules').update(data).eq('id', item.id);
      else await supabase.from('validation_rules').insert([data]);
    }

    toast({ title: item ? '수정되었습니다.' : '추가되었습니다.' });
    setEditDialog(null);
    fetchAll();
  };

  const handleDelete = async (type: string, id: string) => {
    const tableMap: Record<string, string> = { process: 'master_processes', ppe: 'master_ppe', legal: 'legal_references', department: 'master_departments', assignee: 'master_assignees', rule: 'validation_rules' };
    await supabase.from(tableMap[type] as any).delete().eq('id', id);
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

  const handleSaveMatrix = () => {
    setMatrixConfig({ matrix, colors: matrixColors, labels: getMatrixConfig().labels });
    toast({ title: '위험도 매트릭스가 저장되었습니다.' });
  };

  const admin = isAdmin();

  // eslint-disable-next-line react/no-unstable-nested-components
  const DeptMappingTab = () => {
    const [dp, setDp] = useState<{id:string;name:string}[]>([]);
    const [sp, setSp] = useState('');
    useEffect(() => { supabase.from('projects').select('id, name').order('name').then(({data}) => { if (data?.length) { setDp(data); setSp(data[0].id); } }); }, []);
    return (<div className="space-y-4"><Select value={sp} onValueChange={setSp}><SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger><SelectContent>{dp.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>{sp && <DepartmentAssigneeMapping projectId={sp} />}</div>);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div><h1 className="text-2xl font-bold">기준정보 관리</h1><p className="text-sm text-muted-foreground mt-1">시스템 전체에서 공통으로 사용하는 마스터 데이터를 한 곳에서 관리합니다.</p></div>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-3 text-xs space-y-1">
          <p className="font-semibold text-foreground">📚 기준정보란?</p>
          <p className="text-muted-foreground">위험성평가, 작업계획서, 작업허가서, 결재 등 <b>모든 메뉴가 공통으로 참조하는 표준 데이터</b>입니다. 여기에서 한 번만 정의하면 시스템 전체에 즉시 반영됩니다.</p>
          <ul className="text-muted-foreground list-disc pl-4 space-y-0.5">
            <li><b>위험도 매트릭스</b>: 가능성×중대성 3×3 격자에 등급(상/중/하)과 색상을 지정 → 모든 위험성평가 자동 등급화</li>
            <li><b>공정 목록</b>: 표준 공종(예: 철근콘크리트, 양중작업) → 위험성평가/TBM/작업허가서 드롭다운에 사용</li>
            <li><b>PPE 목록</b>: 보호구(안전모, 안전화 등) → 위험성평가 항목별 필수 보호구 선택</li>
            <li><b>법적근거</b>: 산업안전보건법·KOSHA 조항 → 위험성평가/작업허가서 자동 인용</li>
            <li><b>부서·담당자 / 담당자 매핑</b>: 결재선·책임자 자동 배정에 사용</li>
            <li><b>검증 규칙</b>: 위험성평가 누락·오류 자동 검증 기준</li>
          </ul>
        </CardContent>
      </Card>

      <Tabs defaultValue="matrix">
        <TabsList className="flex-wrap">
          <TabsTrigger value="matrix">위험도 매트릭스</TabsTrigger>
          <TabsTrigger value="processes">공정 목록</TabsTrigger>
          <TabsTrigger value="ppe">PPE 목록</TabsTrigger>
          <TabsTrigger value="legal">법적근거</TabsTrigger>
          <TabsTrigger value="departments">부서·담당자</TabsTrigger>
          <TabsTrigger value="dept-mapping">담당자 매핑</TabsTrigger>
          <TabsTrigger value="rules">검증 규칙</TabsTrigger>
        </TabsList>

        {/* Matrix Settings */}
        <TabsContent value="matrix">
          <Card>
            <CardHeader><CardTitle className="text-base">3x3 위험도 매트릭스 설정</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">가능성(행) × 중대성(열) 조합별 위험도 등급을 설정합니다.</p>
              <div className="overflow-x-auto">
                <table className="border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 text-xs text-muted-foreground">가능성 ↓ / 중대성 →</th>
                      {GRADES.map(g => <th key={g} className="p-2 text-center font-bold text-sm">{g}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {GRADES.map(likelihood => (
                      <tr key={likelihood}>
                        <td className="p-2 font-bold text-sm">{likelihood}</td>
                        {GRADES.map(severity => {
                          const key = `${likelihood}_${severity}`;
                          const value = matrix[key] || calculateRiskGrade(likelihood, severity);
                          return (
                            <td key={key} className="p-1">
                              <Select value={value} onValueChange={v => setMatrix(prev => ({ ...prev, [key]: v as RiskGrade }))}>
                                <SelectTrigger className={`h-10 w-20 text-center font-bold ${getGradeClassName(value)}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GRADES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">색상:</span>
                {GRADES.map(g => (
                  <div key={g} className="flex items-center gap-1.5">
                    <input type="color" value={matrixColors[g]} onChange={e => setMatrixColors(prev => ({ ...prev, [g]: e.target.value }))} className="w-8 h-8 rounded border cursor-pointer" />
                    <span className="text-xs">{g}</span>
                  </div>
                ))}
              </div>

              {admin && (
                <Button onClick={handleSaveMatrix} className="gap-1.5">
                  <Save className="h-3.5 w-3.5" /> 매트릭스 저장
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Processes */}
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

        {/* PPE */}
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

        {/* Legal */}
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

        {/* Departments */}
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

        {/* Department-Assignee Mapping - uses first available project */}
        <TabsContent value="dept-mapping">
          <DeptMappingTab />
        </TabsContent>

        {/* Validation Rules */}
        <TabsContent value="rules">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">검증 규칙 관리</CardTitle>
              {admin && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit('rule')}><Plus className="h-3.5 w-3.5" /> 추가</Button>}
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>규칙명</th><th>유형</th><th>설명</th><th>심각도</th><th>가중치</th><th>활성</th>{admin && <th className="w-20 text-center">작업</th>}</tr></thead>
                <tbody>
                  {validationRules.map(r => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.rule_name}</td>
                      <td><Badge variant="secondary" className="text-[10px]">{r.rule_type}</Badge></td>
                      <td className="text-xs max-w-[200px]">{r.description}</td>
                      <td><Badge variant={r.severity === 'error' ? 'destructive' : 'outline'} className="text-[10px]">{r.severity}</Badge></td>
                      <td className="text-center">{r.weight}</td>
                      <td className="text-center">{r.is_active ? '✅' : '❌'}</td>
                      {admin && <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit('rule', r)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete('rule', r.id)}><Trash2 className="h-3 w-3" /></Button>
                      </td>}
                    </tr>
                  ))}
                  {validationRules.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">검증 규칙이 없습니다</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit/Add Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
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
            {editDialog?.type === 'rule' && (
              <>
                <div className="space-y-1"><Label>규칙명</Label><Input value={form.rule_name || ''} onChange={e => setForm(p => ({ ...p, rule_name: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>유형</Label>
                    <Select value={form.rule_type || ''} onValueChange={v => setForm(p => ({ ...p, rule_type: v }))}>
                      <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="missing_field">필수항목 누락</SelectItem>
                        <SelectItem value="underestimation">과소평가</SelectItem>
                        <SelectItem value="insufficient_improvement">개선 미흡</SelectItem>
                        <SelectItem value="missing_legal">법적근거 누락</SelectItem>
                        <SelectItem value="incomplete_completion">완료 미비</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>심각도</Label>
                    <Select value={form.severity || 'warning'} onValueChange={v => setForm(p => ({ ...p, severity: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="error">오류</SelectItem>
                        <SelectItem value="warning">경고</SelectItem>
                        <SelectItem value="info">정보</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1"><Label>설명</Label><Input value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <div className="space-y-1"><Label>가중치</Label><Input type="number" value={form.weight || 1} onChange={e => setForm(p => ({ ...p, weight: e.target.value }))} /></div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={form.is_active !== false} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
                  <Label>활성화</Label>
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
