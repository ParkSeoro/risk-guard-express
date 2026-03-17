import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useToast } from "@/hooks/use-toast";
import { validateRiskItemField } from '@/lib/inputValidation';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Download, Filter, Search, Copy, Trash2, Printer, FileText, Wand2, Upload, ShieldCheck, Undo2 } from "lucide-react";
import { calculateRiskGrade, getGradeClassName, GRADES, type RiskGrade } from "@/lib/riskGrade";
import { generateRiskItems } from "@/lib/riskAutoGen";
import { exportToXLSX, exportToPDF, printRiskAssessment } from "@/lib/exportUtils";
import { validateRiskItems, type ValidationReport } from "@/lib/validationEngine";
import type { Database } from '@/integrations/supabase/types';
import IMESafeInput from '@/components/IMESafeInput';

type RiskItemRow = Database['public']['Tables']['risk_items']['Row'];

const RiskAssessment = () => {
  const { projectId: paramProjectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const [items, setItems] = useState<RiskItemRow[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string; client: string; contractor: string; period_start: string; period_end: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [filterProcess, setFilterProcess] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRiskGrade, setFilterRiskGrade] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [showAutoGen, setShowAutoGen] = useState(false);
  const [autoGenProcess, setAutoGenProcess] = useState('');
  const [autoGenTargetCount, setAutoGenTargetCount] = useState(50);
  const [autoGenTags, setAutoGenTags] = useState<string[]>([]);
  const [autoGenLoading, setAutoGenLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    supabase.from('projects').select('id, name, site_name, client, contractor, period_start, period_end').then(({ data }) => {
      if (data) {
        setProjects(data);
        if (paramProjectId) setSelectedProjectId(paramProjectId);
        else if (data.length > 0) setSelectedProjectId(data[0].id);
      }
    });
  }, [paramProjectId]);

  useEffect(() => {
    if (!selectedProjectId) { setLoading(false); return; }
    setLoading(true);
    supabase
      .from('risk_items')
      .select('*')
      .eq('project_id', selectedProjectId)
      .order('sort_order')
      .then(({ data }) => {
        setItems(data || []);
        setLoading(false);
      });
  }, [selectedProjectId]);

  const currentProject = projects.find(p => p.id === selectedProjectId);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterProcess !== 'all' && item.process !== filterProcess) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (filterRiskGrade !== 'all' && (item as any).risk_grade !== filterRiskGrade) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (item.hazard || '').toLowerCase().includes(term) ||
          (item.sub_task || '').toLowerCase().includes(term) ||
          item.process.toLowerCase().includes(term) ||
          (item.hazard_situation || '').toLowerCase().includes(term);
      }
      return true;
    });
  }, [items, filterProcess, filterStatus, filterRiskGrade, searchTerm]);

  const uniqueProcesses = [...new Set(items.map(i => i.process))];

  const handleCellEdit = async (id: string, field: string, value: any) => {
    const validation = validateRiskItemField(field, value);
    if (!validation.success) { toast({ title: (validation as { success: false; error: string }).error, variant: 'destructive' }); return; }
    const updateData: Record<string, any> = { [field]: validation.data };

    // Auto-compute risk_grade when likelihood or severity grade changes
    if (field === 'likelihood_grade' || field === 'severity_grade') {
      const item = items.find(i => i.id === id);
      if (item) {
        const lg = field === 'likelihood_grade' ? value : (item as any).likelihood_grade || '중';
        const sg = field === 'severity_grade' ? value : (item as any).severity_grade || '중';
        updateData.risk_grade = calculateRiskGrade(lg, sg);
      }
    }
    if (field === 'improved_likelihood_grade' || field === 'improved_severity_grade') {
      const item = items.find(i => i.id === id);
      if (item) {
        const lg = field === 'improved_likelihood_grade' ? value : (item as any).improved_likelihood_grade || '하';
        const sg = field === 'improved_severity_grade' ? value : (item as any).improved_severity_grade || '하';
        updateData.improved_risk_grade = calculateRiskGrade(lg, sg);
      }
    }

    const { error } = await supabase.from('risk_items').update(updateData).eq('id', id);
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
      return;
    }

    const { data: updated } = await supabase.from('risk_items').select('*').eq('id', id).single();
    if (updated) {
      setItems(prev => prev.map(item => item.id === id ? updated : item));
    }
    setEditingCell(null);
    log('수정', 'risk_item', id, selectedProjectId, { field, value });
  };

  const handleAddNew = async () => {
    if (!selectedProjectId || !user) return;
    const { data, error } = await supabase.from('risk_items').insert([{
      project_id: selectedProjectId,
      process: uniqueProcesses[0] || '신규공정',
      created_by: user.id,
      sort_order: items.length,
      likelihood_grade: '중',
      severity_grade: '중',
      risk_grade: '중',
      improved_likelihood_grade: '하',
      improved_severity_grade: '하',
      improved_risk_grade: '하',
    }]).select().single();
    if (data) {
      setItems(prev => [...prev, data]);
      toast({ title: "새 항목이 추가되었습니다." });
      log('추가', 'risk_item', data.id, selectedProjectId);
    }
  };

  const handleDuplicate = async (item: RiskItemRow) => {
    if (!user) return;
    const { id, risk, improved_risk, created_at, updated_at, ...rest } = item;
    const { data } = await supabase.from('risk_items').insert([{
      ...rest,
      status: '미착수',
      created_by: user.id,
      sort_order: items.length,
    }]).select().single();
    if (data) {
      setItems(prev => [...prev, data]);
      toast({ title: "행이 복사되었습니다." });
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('risk_items').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
    toast({ title: "행이 삭제되었습니다." });
    log('삭제', 'risk_item', id, selectedProjectId);
  };

  const handleAutoGenerate = async () => {
    if (!autoGenProcess || !selectedProjectId || !user) return;
    setAutoGenLoading(true);
    try {
      const generated = await generateRiskItems({
        processName: autoGenProcess,
        tags: autoGenTags,
        targetCount: autoGenTargetCount,
        deduplicate: true,
      });
      if (generated.length === 0) {
        toast({ title: '해당 공종에 대한 템플릿이 없습니다.', variant: 'destructive' });
        setAutoGenLoading(false);
        return;
      }
      const inserts = generated.map((g, i) => ({
        project_id: selectedProjectId,
        process: g.process,
        sub_task: g.sub_task,
        hazard: g.hazard,
        hazard_situation: g.hazard_situation,
        existing_measure: g.existing_measure,
        improvement_measure: g.improvement_measure,
        frequency: g.frequency,
        severity: g.severity,
        improved_frequency: g.improved_frequency,
        improved_severity: g.improved_severity,
        likelihood_grade: g.likelihood_grade,
        severity_grade: g.severity_grade,
        risk_grade: g.risk_grade,
        improved_likelihood_grade: g.improved_likelihood_grade,
        improved_severity_grade: g.improved_severity_grade,
        improved_risk_grade: g.improved_risk_grade,
        status: '초안',
        ppe: g.ppe,
        legal_basis: g.legal_basis,
        department: g.department,
        assignee: g.assignee,
        created_by: user.id,
        sort_order: items.length + i,
      }));
      const { data, error } = await supabase.from('risk_items').insert(inserts).select();
      if (data) {
        setItems(prev => [...prev, ...data]);
        toast({ title: `${data.length}건의 위험성평가 항목이 자동 생성되었습니다.` });
        log('자동생성', 'risk_items', autoGenProcess, selectedProjectId, { count: data.length });
      }
      setShowAutoGen(false);
      setAutoGenProcess('');
      setAutoGenTags([]);
    } catch (err) {
      toast({ title: '자동 생성 실패', variant: 'destructive' });
    }
    setAutoGenLoading(false);
  };

  const handleValidate = async () => {
    if (!selectedProjectId || !user) return;
    try {
      const report = await validateRiskItems(items, selectedProjectId);
      setValidationReport(report);
      setShowValidation(true);
      toast({ title: `검증 완료: ${report.verdict} (${report.score}점)` });
    } catch {
      toast({ title: '검증 실패', variant: 'destructive' });
    }
  };

  const handleBatchUndo = async () => {
    // Find latest batch
    const { data: batches } = await supabase.from('generated_batches')
      .select('id, total_items, created_at')
      .eq('project_id', selectedProjectId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!batches || batches.length === 0) {
      toast({ title: '되돌릴 배치가 없습니다.', variant: 'destructive' });
      return;
    }
    const batch = batches[0];
    await supabase.from('risk_items').delete().eq('batch_id', batch.id);
    await supabase.from('generated_batches').delete().eq('id', batch.id);
    setItems(prev => prev.filter(i => i.batch_id !== batch.id));
    toast({ title: `배치 ${batch.total_items}건이 삭제되었습니다.` });
    log('배치삭제', 'generated_batch', batch.id, selectedProjectId);
  };

  const handleExportXLSX = async () => {
    if (!currentProject) return;
    const { data: ppe } = await supabase.from('master_ppe').select('name');
    const { data: legalRefs } = await supabase.from('legal_references').select('law_name, article, description');
    exportToXLSX(
      items.map(i => ({
        ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
        existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
        likelihood_grade: (i as any).likelihood_grade || '중', severity_grade: (i as any).severity_grade || '중', risk_grade: (i as any).risk_grade || '중',
        improved_likelihood_grade: (i as any).improved_likelihood_grade || '하', improved_severity_grade: (i as any).improved_severity_grade || '하', improved_risk_grade: (i as any).improved_risk_grade || '하',
        ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
      })),
      { ...currentProject, period_start: currentProject.period_start || '', period_end: currentProject.period_end || '', client: currentProject.client || '', contractor: currentProject.contractor || '' },
      { ppe, legalRefs }
    );
  };

  const handleExportPDF = async () => {
    if (!currentProject) return;
    const { data: approvals } = await supabase.from('approvals').select('*').eq('project_id', selectedProjectId);
    exportToPDF(
      items.map(i => ({
        ...i, sub_task: i.sub_task || '', hazard: i.hazard || '', hazard_situation: i.hazard_situation || '',
        existing_measure: i.existing_measure || '', improvement_measure: i.improvement_measure || '',
        likelihood_grade: (i as any).likelihood_grade || '중', severity_grade: (i as any).severity_grade || '중', risk_grade: (i as any).risk_grade || '중',
        improved_likelihood_grade: (i as any).improved_likelihood_grade || '하', improved_severity_grade: (i as any).improved_severity_grade || '하', improved_risk_grade: (i as any).improved_risk_grade || '하',
        ppe: i.ppe || [], legal_basis: i.legal_basis || [], department: i.department || '', assignee: i.assignee || '', note: i.note || '',
      })),
      { ...currentProject, period_start: currentProject.period_start || '', period_end: currentProject.period_end || '', client: currentProject.client || '', contractor: currentProject.contractor || '' },
      approvals
    );
  };

  // IMESafeInput is now imported from @/components/IMESafeInput

  const GradeSelect = ({ item, field }: { item: RiskItemRow; field: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = (item as any)[field] || '중';

    if (isEditing) {
      return (
        <Select defaultValue={value} onValueChange={(v) => handleCellEdit(item.id, field, v)}>
          <SelectTrigger className="h-7 text-xs w-14"><SelectValue /></SelectTrigger>
          <SelectContent>
            {GRADES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }

    return (
      <span
        className={`cursor-pointer inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(value)}`}
        onClick={() => setEditingCell({ id: item.id, field })}
      >
        {value}
      </span>
    );
  };

  const RiskGradeBadge = ({ grade }: { grade: string }) => (
    <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getGradeClassName(grade)}`}>
      {grade}
    </span>
  );

  const EditableCell = ({ item, field, type = 'text' }: { item: RiskItemRow; field: string; type?: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = (item as any)[field];

    if (isEditing) {
      if (field === 'status') {
        return (
          <Select defaultValue={value as string} onValueChange={(v) => handleCellEdit(item.id, field, v)}>
            <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="초안">초안</SelectItem>
              <SelectItem value="제출">제출</SelectItem>
              <SelectItem value="검토대기">검토대기</SelectItem>
              <SelectItem value="반려">반려</SelectItem>
              <SelectItem value="보완중">보완중</SelectItem>
              <SelectItem value="승인">승인</SelectItem>
              <SelectItem value="폐기">폐기</SelectItem>
              <SelectItem value="미착수">미착수</SelectItem>
              <SelectItem value="진행">진행</SelectItem>
              <SelectItem value="완료">완료</SelectItem>
            </SelectContent>
          </Select>
        );
      }
      return (
        <IMESafeInput
          defaultValue={value as string || ''}
          className="h-7 text-xs min-w-[100px]"
          autoFocus
          onCommit={(val) => handleCellEdit(item.id, field, val)}
        />
      );
    }

    return (
      <span className="cursor-pointer hover:bg-accent/20 px-1 py-0.5 rounded transition-colors block min-h-[1.5em]"
        onClick={() => setEditingCell({ id: item.id, field })}>
        {String(value || '—')}
      </span>
    );
  };

  if (projects.length === 0 && !loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold">위험성평가</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          프로젝트를 먼저 생성해주세요.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in print:space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">위험성평가</h1>
          <p className="text-sm text-muted-foreground mt-1">상/중/하 3단계 등급 기법 · 셀 클릭으로 인라인 편집</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="h-8 w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 print:hidden flex-wrap">
        <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setShowAutoGen(true)}>
          <Wand2 className="h-3.5 w-3.5" /> 공종 자동작성
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => selectedProjectId && navigate(`/schedule-upload/${selectedProjectId}`)}>
          <Upload className="h-3.5 w-3.5" /> 스케줄 업로드
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleAddNew}>
          <Plus className="h-3.5 w-3.5" /> 행 추가
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleValidate} disabled={items.length === 0}>
          <ShieldCheck className="h-3.5 w-3.5" /> 검증
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={handleBatchUndo}>
          <Undo2 className="h-3.5 w-3.5" /> 배치 되돌리기
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> 인쇄
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF}>
          <FileText className="h-3.5 w-3.5" /> PDF
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportXLSX}>
          <Download className="h-3.5 w-3.5" /> XLSX
        </Button>
      </div>

      {/* Print header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold text-center">위험성평가표</h1>
        <p className="text-sm text-center">{currentProject?.name} · {currentProject?.site_name}</p>
      </div>

      {/* Filters */}
      <Card className="print:hidden">
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">필터</span>
            </div>
            <Select value={filterProcess} onValueChange={setFilterProcess}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="공정 전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">공정 전체</SelectItem>
                {uniqueProcesses.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="상태 전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">상태 전체</SelectItem>
                <SelectItem value="초안">초안</SelectItem>
                <SelectItem value="제출">제출</SelectItem>
                <SelectItem value="검토대기">검토대기</SelectItem>
                <SelectItem value="반려">반려</SelectItem>
                <SelectItem value="승인">승인</SelectItem>
                <SelectItem value="미착수">미착수</SelectItem>
                <SelectItem value="진행">진행</SelectItem>
                <SelectItem value="완료">완료</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRiskGrade} onValueChange={setFilterRiskGrade}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="위험도 전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">위험도 전체</SelectItem>
                <SelectItem value="상">상 (고위험)</SelectItem>
                <SelectItem value="중">중</SelectItem>
                <SelectItem value="하">하 (저위험)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="위험요인, 작업명, 공정 검색..." className="h-8 pl-8 text-xs"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{filteredItems.length}건</span>
          </div>
        </CardContent>
      </Card>

      {/* Risk Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full data-table text-xs">
              <thead>
                <tr>
                  <th className="w-8 text-center">#</th>
                  <th>공정</th><th>세부작업</th><th>위험요인</th><th>위험발생상황</th>
                  <th>기존대책</th><th>개선대책</th>
                  <th className="text-center w-12">가능성</th><th className="text-center w-12">중대성</th><th className="text-center w-12">위험도</th>
                  <th className="text-center w-12">가능성'</th><th className="text-center w-12">중대성'</th><th className="text-center w-12">위험도'</th>
                  <th className="text-center w-16">상태</th>
                  <th>PPE</th><th>법적근거</th>
                  <th>책임부서</th><th>담당자</th>
                  <th className="w-16 text-center print:hidden">작업</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={19} className="text-center py-8 text-muted-foreground">로딩 중...</td></tr>
                ) : filteredItems.length === 0 ? (
                  <tr><td colSpan={19} className="text-center py-8 text-muted-foreground">데이터가 없습니다. '공종 자동작성' 또는 '행 추가'를 사용하세요.</td></tr>
                ) : filteredItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="text-center text-muted-foreground">{idx + 1}</td>
                    <td className="editable whitespace-nowrap"><EditableCell item={item} field="process" /></td>
                    <td className="editable"><EditableCell item={item} field="sub_task" /></td>
                    <td className="editable"><EditableCell item={item} field="hazard" /></td>
                    <td className="editable max-w-[200px]"><EditableCell item={item} field="hazard_situation" /></td>
                    <td className="editable max-w-[180px]"><EditableCell item={item} field="existing_measure" /></td>
                    <td className="editable max-w-[180px]"><EditableCell item={item} field="improvement_measure" /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="likelihood_grade" /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="severity_grade" /></td>
                    <td className="text-center"><RiskGradeBadge grade={(item as any).risk_grade || '중'} /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="improved_likelihood_grade" /></td>
                    <td className="text-center editable"><GradeSelect item={item} field="improved_severity_grade" /></td>
                    <td className="text-center"><RiskGradeBadge grade={(item as any).improved_risk_grade || '하'} /></td>
                    <td className="text-center editable"><EditableCell item={item} field="status" /></td>
                    <td className="text-xs max-w-[120px] truncate">{(item.ppe || []).join(', ') || '—'}</td>
                    <td className="text-xs max-w-[150px] truncate">{(item.legal_basis || []).join(', ') || '—'}</td>
                    <td className="editable whitespace-nowrap"><EditableCell item={item} field="department" /></td>
                    <td className="whitespace-nowrap text-muted-foreground">{item.assignee || '—'}</td>
                    <td className="text-center print:hidden">
                      <div className="flex items-center gap-0.5 justify-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDuplicate(item)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Auto Generate Dialog */}
      <Dialog open={showAutoGen} onOpenChange={setShowAutoGen}>
        <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>공종명으로 위험성평가 자동작성</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">공종명을 입력하면 표준 라이브러리에서 관련 위험성평가 항목을 자동 생성합니다. (상/중/하 등급 자동 산출)</p>
            <div className="space-y-1.5">
              <Label>공종명 입력</Label>
              <Input value={autoGenProcess} onChange={e => setAutoGenProcess(e.target.value)}
                placeholder="예: 배관, 용접, 비계, 굴착, 철골, 콘크리트, 전기, 도장, 밀폐공간..." />
            </div>
            <div className="space-y-1.5">
              <Label>환경/장비 태그 (선택)</Label>
              <div className="flex flex-wrap gap-1.5">
                {['고소','야간','밀폐','화기','양중','굴착','전기','분진','소음','고온','해상','화학'].map(tag => (
                  <Badge key={tag} variant={autoGenTags.includes(tag) ? 'default' : 'outline'}
                    className="cursor-pointer text-[11px]"
                    onClick={() => setAutoGenTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}>
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>생성 개수</Label>
              <Select value={String(autoGenTargetCount)} onValueChange={v => setAutoGenTargetCount(Number(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30개</SelectItem>
                  <SelectItem value="50">50개</SelectItem>
                  <SelectItem value="100">100개</SelectItem>
                  <SelectItem value="150">150개</SelectItem>
                  <SelectItem value="300">300개</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">18개 대분류 · 240+ 표준항목 (상/중/하 3단계 등급 자동 산출)</p>
            <Button onClick={handleAutoGenerate} disabled={!autoGenProcess || autoGenLoading} className="w-full">
              {autoGenLoading ? '생성 중...' : `${autoGenTargetCount}개 자동 생성`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Validation Report Dialog */}
      <Dialog open={showValidation} onOpenChange={setShowValidation}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>검증 결과</DialogTitle></DialogHeader>
          {validationReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{validationReport.score}</p>
                  <p className="text-xs text-muted-foreground">점수</p>
                </div>
                <div className={`p-3 rounded-lg ${validationReport.verdict === '적정' ? 'bg-success/10' : validationReport.verdict === '조건부 적정' ? 'bg-warning/10' : 'bg-destructive/10'}`}>
                  <p className="text-lg font-bold">{validationReport.verdict}</p>
                  <p className="text-xs text-muted-foreground">판정</p>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold">{validationReport.totalIssues}</p>
                  <p className="text-xs text-muted-foreground">지적사항</p>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {validationReport.issues.slice(0, 20).map((issue, i) => {
                  const item = items.find(it => it.id === issue.riskItemId);
                  return (
                    <div key={i} className={`text-xs p-2 rounded ${issue.severity === 'error' ? 'bg-destructive/5 text-destructive' : 'bg-warning/5'}`}>
                      <span className="font-medium">{item?.process} – {item?.sub_task || ''}</span>: {issue.message}
                    </div>
                  );
                })}
                {validationReport.issues.length === 0 && (
                  <p className="text-center text-success py-4 font-medium">✅ 검출된 문제가 없습니다.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RiskAssessment;
