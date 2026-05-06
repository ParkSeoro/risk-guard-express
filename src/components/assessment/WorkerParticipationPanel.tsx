import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Sparkles, Loader2, Upload, MessageSquare, HeartPulse, AlertTriangle, Users, Wand2 } from 'lucide-react';
import { detectHighRiskCategories, type RiskItemLike } from '@/lib/highRiskDetection';
import { autoGenerateAccidentCases } from '@/lib/autoAccidentGeneration';

interface Props {
  runId: string;
  projectId: string;
  userId?: string;
  canEdit: boolean;
  onChanged?: () => void;
  riskItems?: RiskItemLike[];
}

const HEALTH_CATEGORIES = ['분진', '소음', '화학물질', '고온/저온', '밀폐공간', '진동', '기타'];

export default function WorkerParticipationPanel({ runId, projectId, userId, canEdit, onChanged, riskItems = [] }: Props) {
  const { toast } = useToast();
  const [opinions, setOpinions] = useState<any[]>([]);
  const [healths, setHealths] = useState<any[]>([]);
  const [accidents, setAccidents] = useState<any[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<{ opinionId: string; result: any } | null>(null);
  const [selectedSafety, setSelectedSafety] = useState<Set<number>>(new Set());
  const [selectedHealthAi, setSelectedHealthAi] = useState<Set<number>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [healthAILoading, setHealthAILoading] = useState(false);
  const [accidentAILoading, setAccidentAILoading] = useState(false);

  const [newOpinion, setNewOpinion] = useState({ opinion_text: '', worker_name: '', worker_company: '', worker_position: '', signature_url: '' });
  const [healthDraft, setHealthDraft] = useState({ category: '분진', description: '', exposure_level: '보통', countermeasure: '', legal_basis: '', process: '' });
  const [accidentDraft, setAccidentDraft] = useState({ accident_type: '', cause: '', result: '', prevention: '', description: '', occurrence_date: '', process: '' });
  const [aiProcess, setAiProcess] = useState('');
  const [aiEquipment, setAiEquipment] = useState('');

  // 고위험 작업 자동 사고사례 생성
  const [autoAccidentEnabled, setAutoAccidentEnabled] = useState(true);
  const [autoAccidentRan, setAutoAccidentRan] = useState(false);
  const [autoAccidentLoading, setAutoAccidentLoading] = useState(false);
  const detectedHighRisk = useMemo(() => detectHighRiskCategories(riskItems), [riskItems]);
  const autoCases = accidents.filter(a => a.source_type === 'auto');
  const hasHighRiskWithoutCases = detectedHighRisk.length > 0 && autoCases.length === 0;

  const reload = async () => {
    const [op, hz, ac] = await Promise.all([
      supabase.from('worker_opinions' as any).select('*').eq('run_id', runId).order('created_at'),
      supabase.from('health_hazards' as any).select('*').eq('run_id', runId).order('created_at'),
      supabase.from('assessment_accidents' as any).select('*').eq('run_id', runId).order('created_at'),
    ]);
    setOpinions((op.data as any[]) || []);
    setHealths((hz.data as any[]) || []);
    setAccidents((ac.data as any[]) || []);
  };
  useEffect(() => { reload(); }, [runId]);

  const runAutoAccidentGeneration = async (silent = false) => {
    if (!canEdit || detectedHighRisk.length === 0) return;
    setAutoAccidentLoading(true);
    try {
      const res = await autoGenerateAccidentCases({ runId, projectId, items: riskItems, userId });
      await reload();
      onChanged?.();
      if (!silent) {
        toast({
          title: `사고사례 자동 생성 완료`,
          description: `고위험 카테고리 ${res.categories.length}건, 사례 ${res.inserted}건 추가`,
        });
      }
    } catch (e: any) {
      if (!silent) toast({ title: '자동 생성 실패', description: e.message, variant: 'destructive' });
    } finally {
      setAutoAccidentLoading(false);
      setAutoAccidentRan(true);
    }
  };

  // 자동 트리거: 위험성평가 항목 로드 후 1회
  useEffect(() => {
    if (!autoAccidentEnabled || autoAccidentRan) return;
    if (!canEdit) return;
    if (riskItems.length === 0) return;
    if (detectedHighRisk.length === 0) { setAutoAccidentRan(true); return; }
    if (autoCases.length > 0) { setAutoAccidentRan(true); return; }
    runAutoAccidentGeneration(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskItems.length, autoAccidentEnabled, canEdit]);


  // ---------- Opinion ----------
  const addOpinion = async () => {
    if (!newOpinion.opinion_text.trim() || !newOpinion.worker_name.trim()) {
      toast({ title: '의견과 참여자 이름은 필수입니다.', variant: 'destructive' }); return;
    }
    const { error } = await supabase.from('worker_opinions' as any).insert({
      run_id: runId, project_id: projectId, ...newOpinion, created_by: userId,
    });
    if (error) { toast({ title: '저장 실패', description: error.message, variant: 'destructive' }); return; }
    setNewOpinion({ opinion_text: '', worker_name: '', worker_company: '', worker_position: '', signature_url: '' });
    await reload(); onChanged?.();
    toast({ title: '근로자 의견이 저장되었습니다.' });
  };

  const deleteOpinion = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await supabase.from('worker_opinions' as any).delete().eq('id', id);
    await reload(); onChanged?.();
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const path = `${projectId}/worker-sign/${Date.now()}_${f.name}`;
    const { error } = await supabase.storage.from('attachments').upload(path, f);
    if (error) { toast({ title: '업로드 실패', variant: 'destructive' }); return; }
    const { data } = supabase.storage.from('attachments').getPublicUrl(path);
    setNewOpinion(p => ({ ...p, signature_url: data.publicUrl }));
  };

  // ---------- AI 분석 ----------
  const analyzeOpinion = async (op: any) => {
    setAnalyzing(true); setSelectedSafety(new Set()); setSelectedHealthAi(new Set());
    try {
      await supabase.from('worker_opinions' as any).update({ analysis_status: 'analyzing' }).eq('id', op.id);
      const { data, error } = await supabase.functions.invoke('analyze-worker-opinion', {
        body: { mode: 'opinion', opinion: op.opinion_text, process: op.worker_position || '', worker_name: op.worker_name },
      });
      if (error) throw error;
      await supabase.from('worker_opinions' as any).update({ analysis_status: 'done', analysis_result: data }).eq('id', op.id);
      setAiSuggestions({ opinionId: op.id, result: data });
      // 기본 모두 선택
      setSelectedSafety(new Set((data.safety_risks || []).map((_: any, i: number) => i)));
      setSelectedHealthAi(new Set((data.health_hazards || []).map((_: any, i: number) => i)));
      await reload();
      toast({ title: 'AI 분석 완료', description: `위험요인 ${data.safety_risks?.length || 0}건, 보건 ${data.health_hazards?.length || 0}건` });
    } catch (e: any) {
      await supabase.from('worker_opinions' as any).update({ analysis_status: 'failed' }).eq('id', op.id);
      toast({ title: 'AI 분석 실패', description: e.message, variant: 'destructive' });
    } finally { setAnalyzing(false); }
  };

  const applySuggestions = async () => {
    if (!aiSuggestions) return;
    const { opinionId, result } = aiSuggestions;
    const safety = (result.safety_risks || []).filter((_: any, i: number) => selectedSafety.has(i));
    const health = (result.health_hazards || []).filter((_: any, i: number) => selectedHealthAi.has(i));

    // safety -> risk_items
    if (safety.length > 0) {
      const inserts = safety.map((s: any) => ({
        project_id: projectId, run_id: runId,
        process: s.process || '근로자의견기반', sub_task: s.sub_task || '',
        hazard: s.hazard, hazard_situation: s.hazard_situation || '',
        existing_measure: s.existing_measure || '', improvement_measure: s.improvement_measure || '',
        ppe: s.ppe || [],
        likelihood_grade: s.likelihood_grade || '중', severity_grade: s.severity_grade || '중',
        risk_grade: '중', improved_likelihood_grade: '하', improved_severity_grade: '하', improved_risk_grade: '하',
        status: '미착수', item_category: 'safety', source_type: 'ai_opinion',
        source_opinion_id: opinionId, is_user_reviewed: true, created_by: userId,
      }));
      await supabase.from('risk_items').insert(inserts);
    }
    // health -> health_hazards
    if (health.length > 0) {
      const inserts = health.map((h: any) => ({
        run_id: runId, project_id: projectId,
        category: h.category, description: h.description, exposure_level: h.exposure_level || '보통',
        countermeasure: h.countermeasure || '', legal_basis: h.legal_basis || '',
        source_type: 'ai', is_user_reviewed: true, created_by: userId,
      }));
      await supabase.from('health_hazards' as any).insert(inserts);
    }
    setAiSuggestions(null);
    await reload(); onChanged?.();
    toast({ title: `반영 완료 (위험 ${safety.length}, 보건 ${health.length})` });
  };

  // ---------- Health ----------
  const addHealth = async () => {
    if (!healthDraft.description.trim()) { toast({ title: '내용을 입력하세요.', variant: 'destructive' }); return; }
    await supabase.from('health_hazards' as any).insert({ run_id: runId, project_id: projectId, ...healthDraft, created_by: userId });
    setHealthDraft({ category: '분진', description: '', exposure_level: '보통', countermeasure: '', legal_basis: '', process: '' });
    await reload(); onChanged?.();
  };
  const deleteHealth = async (id: string) => {
    await supabase.from('health_hazards' as any).delete().eq('id', id);
    await reload(); onChanged?.();
  };
  const generateHealthAI = async () => {
    setHealthAILoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-worker-opinion', { body: { mode: 'health', process: aiProcess, equipment: aiEquipment } });
      if (error) throw error;
      const inserts = (data.items || []).map((h: any) => ({
        run_id: runId, project_id: projectId, process: aiProcess,
        category: h.category, description: h.description, exposure_level: h.exposure_level || '보통',
        countermeasure: h.countermeasure, legal_basis: h.legal_basis || '',
        source_type: 'ai', is_user_reviewed: false, created_by: userId,
      }));
      if (inserts.length) await supabase.from('health_hazards' as any).insert(inserts);
      await reload(); onChanged?.();
      toast({ title: `보건 항목 ${inserts.length}건 생성 (검토 필요)` });
    } catch (e: any) { toast({ title: 'AI 생성 실패', description: e.message, variant: 'destructive' }); }
    finally { setHealthAILoading(false); }
  };

  // ---------- Accident ----------
  const addAccident = async () => {
    if (!accidentDraft.accident_type.trim()) { toast({ title: '사고유형을 입력하세요.', variant: 'destructive' }); return; }
    const payload: any = { run_id: runId, project_id: projectId, ...accidentDraft, source_type: 'manual', created_by: userId };
    if (!payload.occurrence_date) delete payload.occurrence_date;
    await supabase.from('assessment_accidents' as any).insert(payload);
    setAccidentDraft({ accident_type: '', cause: '', result: '', prevention: '', description: '', occurrence_date: '', process: '' });
    await reload(); onChanged?.();
  };
  const deleteAccident = async (id: string) => {
    await supabase.from('assessment_accidents' as any).delete().eq('id', id);
    await reload(); onChanged?.();
  };
  const generateAccidentAI = async () => {
    setAccidentAILoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-worker-opinion', { body: { mode: 'accident', process: aiProcess, equipment: aiEquipment } });
      if (error) throw error;
      const inserts = (data.items || []).map((a: any) => ({
        run_id: runId, project_id: projectId, process: aiProcess,
        accident_type: a.accident_type, cause: a.cause, result: a.result || '',
        prevention: a.prevention, description: a.description || '',
        source_type: 'ai', created_by: userId,
      }));
      if (inserts.length) await supabase.from('assessment_accidents' as any).insert(inserts);
      await reload(); onChanged?.();
      toast({ title: `사고사례 ${inserts.length}건 생성` });
    } catch (e: any) { toast({ title: 'AI 생성 실패', description: e.message, variant: 'destructive' }); }
    finally { setAccidentAILoading(false); }
  };

  const photoUpload = async (e: React.ChangeEvent<HTMLInputElement>, accidentId: string) => {
    const f = e.target.files?.[0]; if (!f) return;
    const path = `${projectId}/accidents/${Date.now()}_${f.name}`;
    const { error } = await supabase.storage.from('attachments').upload(path, f);
    if (error) { toast({ title: '업로드 실패', variant: 'destructive' }); return; }
    const { data } = supabase.storage.from('attachments').getPublicUrl(path);
    const target = accidents.find(a => a.id === accidentId);
    const urls = [...(target?.photo_urls || []), data.publicUrl];
    await supabase.from('assessment_accidents' as any).update({ photo_urls: urls }).eq('id', accidentId);
    await reload();
  };

  return (
    <div className="space-y-4">
      {/* ==================== 근로자 의견 ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" /> 근로자 의견 (필수)
            <Badge variant="outline" className="text-[10px]">{opinions.length}건</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && (
            <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
              <Textarea placeholder="현장 의견을 자유롭게 작성하세요. (예: 비계 위 발판이 미끄럽고 분진이 심함)"
                value={newOpinion.opinion_text} onChange={e => setNewOpinion(p => ({ ...p, opinion_text: e.target.value }))} rows={2} />
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="이름 *" value={newOpinion.worker_name} onChange={e => setNewOpinion(p => ({ ...p, worker_name: e.target.value }))} />
                <Input placeholder="소속" value={newOpinion.worker_company} onChange={e => setNewOpinion(p => ({ ...p, worker_company: e.target.value }))} />
                <Input placeholder="직책/공종" value={newOpinion.worker_position} onChange={e => setNewOpinion(p => ({ ...p, worker_position: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} />
                  <Button size="sm" variant="outline" asChild><span><Upload className="h-3 w-3 mr-1" /> 서명 이미지</span></Button>
                </label>
                {newOpinion.signature_url && <img src={newOpinion.signature_url} className="h-8 border rounded" alt="서명" />}
                <Button size="sm" onClick={addOpinion} className="ml-auto gap-1"><Plus className="h-3 w-3" /> 의견 등록</Button>
              </div>
            </div>
          )}
          {opinions.map(op => (
            <div key={op.id} className="p-3 border rounded-lg space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm">{op.opinion_text}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {op.worker_name} {op.worker_company && `· ${op.worker_company}`} {op.worker_position && `· ${op.worker_position}`} · {op.participated_at}
                  </p>
                  {op.signature_url && <img src={op.signature_url} className="h-8 mt-1 border rounded inline-block" alt="서명" />}
                </div>
                <div className="flex gap-1">
                  <Badge variant={op.analysis_status === 'done' ? 'default' : 'outline'} className="text-[9px] h-5">
                    {op.analysis_status === 'done' ? 'AI 분석완료' : op.analysis_status === 'analyzing' ? '분석중' : op.analysis_status === 'failed' ? '실패' : '미분석'}
                  </Badge>
                  {canEdit && op.analysis_status !== 'done' && (
                    <Button size="sm" variant="outline" className="h-7 gap-1" disabled={analyzing} onClick={() => analyzeOpinion(op)}>
                      {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} AI 분석
                    </Button>
                  )}
                  {canEdit && op.analysis_status === 'done' && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => {
                      setAiSuggestions({ opinionId: op.id, result: op.analysis_result });
                      setSelectedSafety(new Set((op.analysis_result?.safety_risks || []).map((_: any, i: number) => i)));
                      setSelectedHealthAi(new Set((op.analysis_result?.health_hazards || []).map((_: any, i: number) => i)));
                    }}><Sparkles className="h-3 w-3" /> 결과 보기</Button>
                  )}
                  {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteOpinion(op.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>}
                </div>
              </div>
            </div>
          ))}

          {/* AI 결과 검토 */}
          {aiSuggestions && (
            <div className="border-2 border-primary/40 rounded-lg p-3 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-1"><Sparkles className="h-4 w-4" /> AI 자동 생성 항목 (체크 후 반영)</h4>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAiSuggestions(null)}>닫기</Button>
                  <Button size="sm" onClick={applySuggestions}>선택 항목 반영</Button>
                </div>
              </div>
              {(aiSuggestions.result.keywords || []).length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {aiSuggestions.result.keywords.map((k: string, i: number) => <Badge key={i} variant="secondary" className="text-[9px]">{k}</Badge>)}
                </div>
              )}
              <div>
                <p className="text-xs font-medium mb-1">안전 위험요인</p>
                {(aiSuggestions.result.safety_risks || []).map((s: any, i: number) => (
                  <label key={i} className="flex items-start gap-2 text-xs p-2 border rounded mb-1 bg-background cursor-pointer">
                    <Checkbox checked={selectedSafety.has(i)} onCheckedChange={c => {
                      const ns = new Set(selectedSafety); c ? ns.add(i) : ns.delete(i); setSelectedSafety(ns);
                    }} />
                    <div className="flex-1">
                      <p className="font-medium">{s.hazard} <span className="text-[9px] text-muted-foreground">({s.likelihood_grade}/{s.severity_grade})</span></p>
                      <p className="text-[10px] text-muted-foreground">{s.hazard_situation}</p>
                      <p className="text-[10px]">→ {s.improvement_measure}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium mb-1">보건 유해요인</p>
                {(aiSuggestions.result.health_hazards || []).map((h: any, i: number) => (
                  <label key={i} className="flex items-start gap-2 text-xs p-2 border rounded mb-1 bg-background cursor-pointer">
                    <Checkbox checked={selectedHealthAi.has(i)} onCheckedChange={c => {
                      const ns = new Set(selectedHealthAi); c ? ns.add(i) : ns.delete(i); setSelectedHealthAi(ns);
                    }} />
                    <div className="flex-1">
                      <p className="font-medium">[{h.category}] {h.description} <span className="text-[9px] text-muted-foreground">노출 {h.exposure_level}</span></p>
                      <p className="text-[10px]">→ {h.countermeasure}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI 일괄 생성 도우미 */}
      {canEdit && (
        <Card>
          <CardContent className="py-3 flex items-end gap-2">
            <div className="flex-1"><Label className="text-[10px]">공종</Label><Input placeholder="예: 비계작업" value={aiProcess} onChange={e => setAiProcess(e.target.value)} className="h-8" /></div>
            <div className="flex-1"><Label className="text-[10px]">장비</Label><Input placeholder="예: 고소작업대" value={aiEquipment} onChange={e => setAiEquipment(e.target.value)} className="h-8" /></div>
            <Button size="sm" variant="outline" onClick={generateHealthAI} disabled={healthAILoading} className="gap-1">
              {healthAILoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <HeartPulse className="h-3 w-3" />} 보건 AI 생성
            </Button>
            <Button size="sm" variant="outline" onClick={generateAccidentAI} disabled={accidentAILoading} className="gap-1">
              {accidentAILoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />} 사고사례 AI
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ==================== 보건 ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" /> 보건 유해요인 (최소 1건)
            <Badge variant="outline" className="text-[10px]">{healths.length}건</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {canEdit && (
            <div className="grid grid-cols-6 gap-2 p-2 border rounded bg-muted/30">
              <select className="border rounded px-2 text-xs h-8" value={healthDraft.category}
                onChange={e => setHealthDraft(p => ({ ...p, category: e.target.value }))}>
                {HEALTH_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <Input className="h-8 col-span-2" placeholder="유해 내용" value={healthDraft.description} onChange={e => setHealthDraft(p => ({ ...p, description: e.target.value }))} />
              <select className="border rounded px-2 text-xs h-8" value={healthDraft.exposure_level} onChange={e => setHealthDraft(p => ({ ...p, exposure_level: e.target.value }))}>
                <option>낮음</option><option>보통</option><option>높음</option>
              </select>
              <Input className="h-8" placeholder="대책" value={healthDraft.countermeasure} onChange={e => setHealthDraft(p => ({ ...p, countermeasure: e.target.value }))} />
              <Button size="sm" onClick={addHealth} className="gap-1"><Plus className="h-3 w-3" />추가</Button>
            </div>
          )}
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/40"><tr>
              <th className="border px-2 py-1">구분</th><th className="border px-2 py-1">유해내용</th>
              <th className="border px-2 py-1">노출</th><th className="border px-2 py-1">대책</th>
              <th className="border px-2 py-1">법적근거</th><th className="border px-2 py-1">출처</th>
              {canEdit && <th className="border px-2 py-1 w-10"></th>}
            </tr></thead>
            <tbody>
              {healths.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-3">등록된 보건 항목이 없습니다.</td></tr>}
              {healths.map(h => (
                <tr key={h.id} className={!h.is_user_reviewed ? 'bg-warning/10' : ''}>
                  <td className="border px-2 py-1"><Badge variant="outline" className="text-[10px]">{h.category}</Badge></td>
                  <td className="border px-2 py-1">{h.description}</td>
                  <td className="border px-2 py-1">{h.exposure_level}</td>
                  <td className="border px-2 py-1">{h.countermeasure}</td>
                  <td className="border px-2 py-1 text-[10px]">{h.legal_basis}</td>
                  <td className="border px-2 py-1 text-[10px]">{h.source_type === 'ai' ? '🤖 AI' : '✍️ 수동'}{!h.is_user_reviewed && ' (검토필요)'}</td>
                  {canEdit && <td className="border px-2 py-1">
                    {!h.is_user_reviewed && <Button size="icon" variant="ghost" className="h-6 w-6" title="검토완료" onClick={async () => { await supabase.from('health_hazards' as any).update({ is_user_reviewed: true }).eq('id', h.id); reload(); }}>✓</Button>}
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteHealth(h.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ==================== 사고사례 ==================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> 사고사례
            <Badge variant="outline" className="text-[10px]">{accidents.length}건</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {canEdit && (
            <div className="grid grid-cols-2 gap-2 p-2 border rounded bg-muted/30">
              <Input className="h-8" placeholder="사고유형" value={accidentDraft.accident_type} onChange={e => setAccidentDraft(p => ({ ...p, accident_type: e.target.value }))} />
              <Input className="h-8" placeholder="공종" value={accidentDraft.process} onChange={e => setAccidentDraft(p => ({ ...p, process: e.target.value }))} />
              <Input className="h-8" placeholder="원인" value={accidentDraft.cause} onChange={e => setAccidentDraft(p => ({ ...p, cause: e.target.value }))} />
              <Input className="h-8" placeholder="결과" value={accidentDraft.result} onChange={e => setAccidentDraft(p => ({ ...p, result: e.target.value }))} />
              <Input className="h-8 col-span-2" placeholder="예방대책" value={accidentDraft.prevention} onChange={e => setAccidentDraft(p => ({ ...p, prevention: e.target.value }))} />
              <Textarea className="col-span-2 text-xs" rows={2} placeholder="설명" value={accidentDraft.description} onChange={e => setAccidentDraft(p => ({ ...p, description: e.target.value }))} />
              <Button size="sm" onClick={addAccident} className="gap-1 col-span-2"><Plus className="h-3 w-3" />사고사례 등록</Button>
            </div>
          )}
          {accidents.length === 0 && <p className="text-center text-xs text-muted-foreground py-3">등록된 사고사례가 없습니다.</p>}
          {accidents.map(a => (
            <div key={a.id} className="p-2 border rounded space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 text-xs">
                  <p className="font-medium">[{a.accident_type}] {a.process && <span className="text-muted-foreground">· {a.process}</span>}</p>
                  <p className="text-[11px]">원인: {a.cause}</p>
                  {a.result && <p className="text-[11px]">결과: {a.result}</p>}
                  <p className="text-[11px]">예방: {a.prevention}</p>
                  {a.description && <p className="text-[10px] text-muted-foreground">{a.description}</p>}
                  <Badge variant="outline" className="text-[9px] mt-1">{a.source_type === 'ai' ? '🤖 AI' : a.source_type === 'recommended' ? '📋 추천' : '✍️ 수동'}</Badge>
                </div>
                {canEdit && <div className="flex gap-1">
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={e => photoUpload(e, a.id)} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" asChild><span><Upload className="h-3 w-3" /></span></Button>
                  </label>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteAccident(a.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>}
              </div>
              {a.photo_urls?.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {a.photo_urls.map((u: string, i: number) => <img key={i} src={u} alt="사고사진" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(u, '_blank')} />)}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
