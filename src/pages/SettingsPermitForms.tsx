/**
 * 허가서 표시 양식 (마스터) — 프로젝트별 복제 · 라벨 · 항목 숨기기
 *
 * 절대 하지 않음: 결재 규칙/RPC, form_data 키, DigPermitForm 구조 변경.
 * PDF 오버레이·자유 빌더·AI 분석은 제거됨.
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
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSignature, Trash2, Save, Eye, Copy } from 'lucide-react';
import DigPermitForm, {
  type PermitFormData,
  type PermitSignatures,
  type PermitType,
} from '@/components/permits/DigPermitForm';
import StandardPermitSheet from '@/components/permits/StandardPermitSheet';
import StandardStyleEditor from '@/components/permit-designer/StandardStyleEditor';
import type { StandardStyle, StandardLabels } from '@/lib/permitStandardStyle';
import {
  DEFAULT_STANDARD_LABELS,
  DEFAULT_STANDARD_STYLE,
  PERMIT_TYPE_LABEL,
} from '@/lib/permitStandardStyle';
import {
  buildCloneLayoutJson,
  emptyDisplayTemplate,
  normalizeDisplayTemplate,
  parseLayoutJson,
  PERMIT_KIND_CLONE_META,
  sectionsForKind,
  type PermitDisplaySectionId,
  type PermitDisplayTemplate,
  type PermitLayoutJson,
} from '@/lib/permitDisplayTemplate';

type CompanyOpt = { id: string; name: string; type: string | null };

type Tpl = {
  id: string;
  project_id: string | null;
  company_id: string | null;
  code: string;
  name: string;
  version: string;
  layout_json: PermitLayoutJson;
  is_default: boolean;
  is_active: boolean;
  permit_type: PermitType;
  updated_at: string;
};

/** 설정 화면용 — 키 옆에 한글 설명 (찾기 쉽게) */
const LABEL_KEY_TITLE: Record<string, string> = {
  approverCompany: '승인업체명',
  docNoPrefix: '문서번호 접두사',
  'general.title': '일반 — 제목',
  'general.contractor': '일반 — 공사업체',
  'general.approverCompany': '일반 — 승인업체 라벨',
  'general.cooperationDept': '일반 — 협조부서',
  'general.reviewDate': '일반 — 검토일',
  'general.approveDate': '일반 — 승인일',
  'general.workDatetime': '일반 — 작업일시',
  'general.workName': '일반 — 작업명',
  'general.workDescription': '일반 — 작업내용',
  'general.workLocation': '일반 — 작업장소',
  'general.personnel': '일반 — 투입인원',
  'general.attachments': '일반 — 첨부서류',
  'general.safetyChecklist': '일반 — 안전조치',
  'general.hazardConfirm': '일반 — 위험작업 확인',
  'general.gasMeasurement': '일반 — 가스측정',
  'general.siteConfirm': '일반 — 작업완료 확인',
  'general.extension': '일반 — 연장 작업',
  'general.footerNote': '일반 — 하단 안내',
  'confined_space.title': '밀폐 — 제목',
  'hot_work.title': '화기 — 제목',
  'excavation.title': '굴착 — 제목',
};

const PREVIEW_DATA: PermitFormData = {
  contractor_company: '(주)샘플건설',
  work_name: '배관 용접 작업',
  work_description: '냉각탑 상부 배관 T-이음 용접',
  work_location: '냉각탑 3F 배관 랙',
  personnel_count: 4,
  applicant_company: '(주)샘플건설',
  applicant_name: '홍길동',
};

const PREVIEW_SIGS: PermitSignatures = {
  contractor_pic: { name: '김시공', signature: '', signed_at: '2026-07-21T09:00:00.000Z' },
  safety_pic: { name: '박안전', signature: '', signed_at: '2026-07-21T10:00:00.000Z' },
  site_director: { name: '이소장', signature: '', signed_at: '2026-07-22T08:30:00.000Z' },
  cm: { name: '최CM', signature: '', signed_at: '2026-07-22T09:10:00.000Z' },
  sm: { name: '정SM', signature: '', signed_at: '2026-07-22T09:30:00.000Z' },
  approved_at: '2026-07-22T09:30:00.000Z',
  reviewed_at: '2026-07-21T09:30:00.000Z',
};

export default function SettingsPermitForms() {
  const { hasRole, user } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');

  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Tpl | null>(null);
  const [style, setStyle] = useState<Partial<StandardStyle>>(DEFAULT_STANDARD_STYLE);
  const [stdLabels, setStdLabels] = useState<Partial<StandardLabels>>(DEFAULT_STANDARD_LABELS);
  const [display, setDisplay] = useState<PermitDisplayTemplate>(emptyDisplayTemplate());
  const [tab, setTab] = useState('labels');
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);

  const loadCompanies = async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, type')
      .eq('is_deleted', false)
      .order('name');
    if (error) {
      toast({ title: '회사 목록 실패', description: error.message, variant: 'destructive' });
      return;
    }
    // 발주/원청 우선, 없으면 전체
    const all = (data || []) as CompanyOpt[];
    const preferred = all.filter((c) => c.type === 'client' || c.type === 'gc');
    const list = preferred.length > 0 ? preferred : all;
    setCompanies(list);
    if (!companyId && list[0]) setCompanyId(list[0].id);
  };

  const loadTemplates = async (cid: string) => {
    if (!cid) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('permit_form_templates')
      .select('id, project_id, company_id, code, name, version, layout_json, is_default, is_active, permit_type, updated_at')
      .eq('is_deleted', false)
      .eq('company_id', cid)
      .order('permit_type')
      .order('updated_at', { ascending: false });
    if (error) {
      toast({ title: '불러오기 실패', description: error.message, variant: 'destructive' });
      setRows([]);
    } else {
      setRows(
        (data || []).map((r: any) => ({
          ...r,
          company_id: r.company_id || null,
          permit_type: (r.permit_type || 'general') as PermitType,
          layout_json: parseLayoutJson(r.layout_json),
        })),
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isMaster) loadCompanies();
  }, [isMaster]);

  useEffect(() => {
    if (isMaster && companyId) {
      setSelected(null);
      loadTemplates(companyId);
    }
  }, [isMaster, companyId]);

  if (!isMaster) return <Navigate to="/settings" replace />;

  const openEdit = (t: Tpl) => {
    const layout = parseLayoutJson(t.layout_json);
    setSelected(t);
    setStyle(layout.standard_style || DEFAULT_STANDARD_STYLE);
    setStdLabels(layout.standard_labels || DEFAULT_STANDARD_LABELS);
    setDisplay(normalizeDisplayTemplate(layout.display_template || emptyDisplayTemplate()));
    setTab('labels');
  };

  const buildLayoutPayload = (): PermitLayoutJson => ({
    standard_style: style,
    standard_labels: {
      ...stdLabels,
      approverCompany: display.labels.approverCompany || stdLabels.approverCompany,
      docNoPrefix: display.labels.docNoPrefix || stdLabels.docNoPrefix,
    },
    display_template: normalizeDisplayTemplate(display),
  });

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const layout = buildLayoutPayload();
    const { error } = await supabase
      .from('permit_form_templates')
      .update({
        code: selected.code.trim(),
        name: selected.name.trim(),
        version: selected.version.trim() || '1',
        is_default: selected.is_default,
        is_active: selected.is_active,
        permit_type: selected.permit_type,
        project_id: null,
        company_id: companyId,
        layout_json: layout as any,
        // 레거시 오버레이/AI 필드 정리 (기능 삭제)
        print_overlay: { pages: [] } as any,
        original_pdf_url: null,
        signature_slots: [] as any,
        suggested_approval_steps: null,
        ai_analysis_json: null,
        ai_analyzed_at: null,
      })
      .eq('id', selected.id);
    setSaving(false);
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '저장되었습니다.', description: '결재 규칙·허가서 데이터 구조는 변경되지 않습니다.' });
    await loadTemplates(companyId);
    setSelected((prev) =>
      prev
        ? {
            ...prev,
            layout_json: layout,
            name: selected.name,
            code: selected.code,
            version: selected.version,
            is_default: selected.is_default,
            is_active: selected.is_active,
          }
        : prev,
    );
  };

  const softDelete = async (t: Tpl) => {
    if (!confirm(`「${t.name}」을(를) 삭제할까요? (허가서 본문·결재는 영향 없음)`)) return;
    const { error } = await supabase
      .from('permit_form_templates')
      .update({ is_deleted: true, is_active: false })
      .eq('id', t.id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    if (selected?.id === t.id) setSelected(null);
    toast({ title: '삭제되었습니다.' });
    await loadTemplates(companyId);
  };

  const cloneFromStandard = async () => {
    if (!companyId) {
      toast({ title: '회사를 선택하세요.', variant: 'destructive' });
      return;
    }
    setCloning(true);
    const existingTypes = new Set(rows.map((r) => r.permit_type));
    const toCreate = PERMIT_KIND_CLONE_META.filter((m) => !existingTypes.has(m.permit_type));
    if (toCreate.length === 0) {
      setCloning(false);
      toast({
        title: '이미 복제본이 있습니다.',
        description: '종류별로 하나씩 있으면 됩니다. 기존 양식을 열어 수정하세요.',
      });
      return;
    }
    const layout = buildCloneLayoutJson();
    const companyName = companies.find((c) => c.id === companyId)?.name || 'CO';
    const inserts = toCreate.map((m) => ({
      project_id: null,
      company_id: companyId,
      code: `${companyName.slice(0, 12).replace(/\s+/g, '')}-${m.codeSuffix}`.slice(0, 40),
      name: m.name,
      version: '1',
      permit_type: m.permit_type,
      is_default: true,
      is_active: true,
      layout_json: layout as any,
      print_overlay: { pages: [] } as any,
      original_pdf_url: null,
      signature_slots: [] as any,
      suggested_approval_steps: null,
      created_by: user?.id || null,
    }));
    const { error } = await supabase.from('permit_form_templates').insert(inserts);
    setCloning(false);
    if (error) {
      toast({ title: '복제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: `표준 허가서에서 ${inserts.length}종 복제했습니다.`,
      description: '이 회사의 모든 프로젝트 허가서에 표시(라벨/숨김)만 적용됩니다. 결재 규칙은 그대로입니다.',
    });
    await loadTemplates(companyId);
  };

  const kindSections = useMemo(
    () => (selected ? sectionsForKind(selected.permit_type) : []),
    [selected],
  );

  const editableLabelEntries = useMemo(() => {
    if (!selected) return [];
    const kind = selected.permit_type;
    return Object.entries(display.labels).filter(([k]) => {
      if (k === 'approverCompany' || k === 'docNoPrefix') return true;
      if (k.startsWith(`${kind}.`)) return true;
      if (kind === 'general' && k.startsWith('general.')) return true;
      return false;
    });
  }, [display.labels, selected]);

  const toggleHidden = (id: PermitDisplaySectionId, checked: boolean) => {
    const def = kindSections.find((s) => s.id === id);
    if (def?.locked) return;
    setDisplay((prev) => {
      const set = new Set(prev.hiddenSections);
      if (checked) set.add(id);
      else set.delete(id);
      return { ...prev, hiddenSections: Array.from(set) };
    });
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileSignature className="h-5 w-5" />
          허가서 표시 양식
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          지금 쓰는 허가서를 <strong>회사별로 복제</strong>한 뒤, 문구(라벨)와 선택 항목 숨김만 조정합니다.
          같은 회사의 모든 프로젝트에 동일하게 적용됩니다(턴키 다수 현장용).
          결재·연장·종료·저장 구조는 절대 바꾸지 않습니다. 양식이 없으면 표준 허가서가 그대로 사용됩니다.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[240px]">
            <Label>회사 (발주/원청)</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="회사 선택" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.type ? ` · ${c.type}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={cloneFromStandard} disabled={!companyId || cloning} className="gap-1.5">
            <Copy className="h-4 w-4" />
            {cloning ? '복제 중…' : '표준 허가서에서 복제'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">이 회사 양식</CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-1">
            {loading && <p className="text-xs text-muted-foreground p-2">불러오는 중…</p>}
            {!loading && rows.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">
                아직 없습니다. 「표준 허가서에서 복제」를 누르세요. 복제 전엔 기존 표준 허가서가 그대로 동작합니다.
              </p>
            )}
            {rows.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openEdit(t)}
                className={`w-full text-left rounded-md px-2 py-2 text-sm border ${
                  selected?.id === t.id ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'
                }`}
              >
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-[11px] text-muted-foreground flex gap-1 flex-wrap mt-0.5">
                  <Badge variant="outline" className="text-[10px] h-4">
                    {PERMIT_TYPE_LABEL[t.permit_type] || t.permit_type}
                  </Badge>
                  {t.is_default && <Badge variant="secondary" className="text-[10px] h-4">기본</Badge>}
                  {!t.is_active && <Badge variant="destructive" className="text-[10px] h-4">비활성</Badge>}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          {!selected ? (
            <CardContent className="p-8 text-sm text-muted-foreground">
              왼쪽에서 양식을 선택하거나, 표준에서 복제하세요.
            </CardContent>
          ) : (
            <>
              <CardHeader className="py-3 px-4 space-y-3">
                <div className="flex flex-wrap gap-2 items-end justify-between">
                  <div className="grid grid-cols-2 gap-2 flex-1 min-w-[240px]">
                    <div className="space-y-1">
                      <Label className="text-xs">이름</Label>
                      <Input
                        value={selected.name}
                        onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">코드</Label>
                      <Input
                        value={selected.code}
                        onChange={(e) => setSelected({ ...selected, code: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">버전</Label>
                      <Input
                        value={selected.version}
                        onChange={(e) => setSelected({ ...selected, version: e.target.value })}
                        className="h-8"
                      />
                    </div>
                    <div className="flex items-center gap-4 pt-5">
                      <label className="flex items-center gap-1.5 text-xs">
                        <Switch
                          checked={selected.is_default}
                          onCheckedChange={(v) => setSelected({ ...selected, is_default: v })}
                        />
                        기본
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Switch
                          checked={selected.is_active}
                          onCheckedChange={(v) => setSelected({ ...selected, is_active: v })}
                        />
                        사용
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => softDelete(selected)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> 삭제
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving}>
                      <Save className="h-3.5 w-3.5 mr-1" /> {saving ? '저장 중…' : '저장'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList>
                    <TabsTrigger value="labels">문구(라벨)</TabsTrigger>
                    <TabsTrigger value="hide">항목 숨기기</TabsTrigger>
                    <TabsTrigger value="style">스타일</TabsTrigger>
                    <TabsTrigger value="preview">미리보기</TabsTrigger>
                  </TabsList>

                  <TabsContent value="labels" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      비워 두지 마세요. 저장 키는 그대로이고, 화면에 보이는 글자만 바뀝니다.
                    </p>
                    <div className="grid gap-2 max-h-[420px] overflow-y-auto pr-1">
                      {editableLabelEntries.map(([key, val]) => (
                        <div key={key} className="grid grid-cols-[200px_1fr] gap-2 items-center">
                          <div className="min-w-0">
                            <Label className="text-xs font-medium truncate block">
                              {LABEL_KEY_TITLE[key] || key}
                            </Label>
                            <span className="text-[10px] text-muted-foreground truncate block" title={key}>{key}</span>
                          </div>
                          <Input
                            value={val}
                            className="h-8"
                            onChange={(e) =>
                              setDisplay((prev) => ({
                                ...prev,
                                labels: { ...prev.labels, [key]: e.target.value },
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="hide" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      숨긴 항목은 화면에만 안 보입니다. 이미 저장된 값·결재 슬롯은 유지됩니다.
                      잠금 표시된 항목(결재·작업일시·핵심 요약·완료·연장)은 숨길 수 없습니다.
                    </p>
                    <div className="space-y-2">
                      {kindSections.map((s) => {
                        const checked = display.hiddenSections.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                              s.locked ? 'opacity-60 bg-muted/30' : ''
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={s.locked}
                              onCheckedChange={(v) => toggleHidden(s.id, !!v)}
                              className="mt-0.5"
                            />
                            <span>
                              <span className="font-medium">{s.label}</span>
                              {s.locked && (
                                <Badge variant="outline" className="ml-2 text-[10px]">잠금</Badge>
                              )}
                              {s.description && (
                                <span className="block text-[11px] text-muted-foreground">{s.description}</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </TabsContent>

                  <TabsContent value="style" className="pt-3">
                    <StandardStyleEditor
                      style={style as StandardStyle}
                      labels={{
                        approverCompany: display.labels.approverCompany || stdLabels.approverCompany,
                        docNoPrefix: display.labels.docNoPrefix || stdLabels.docNoPrefix,
                      }}
                      onChange={(nextStyle, nextLabels) => {
                        setStyle(nextStyle);
                        setStdLabels(nextLabels);
                        setDisplay((prev) => ({
                          ...prev,
                          labels: {
                            ...prev.labels,
                            approverCompany: nextLabels.approverCompany || prev.labels.approverCompany,
                            docNoPrefix: nextLabels.docNoPrefix || prev.labels.docNoPrefix,
                          },
                        }));
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="preview" className="pt-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Eye className="h-3.5 w-3.5" /> 실제 DigPermitForm 미리보기 (샘플 데이터)
                    </div>
                    <div className="border rounded bg-white p-3 overflow-auto max-h-[640px]">
                      <StandardPermitSheet>
                        <DigPermitForm
                          permitType={selected.permit_type}
                          data={PREVIEW_DATA}
                          signatures={PREVIEW_SIGS}
                          readOnly
                          printMode
                          standardStyle={style}
                          standardLabels={{
                            approverCompany: display.labels.approverCompany,
                            docNoPrefix: display.labels.docNoPrefix,
                          }}
                          displayTemplate={display}
                        />
                      </StandardPermitSheet>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
