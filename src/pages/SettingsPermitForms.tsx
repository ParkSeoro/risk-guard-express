/**
 * 허가서 양식 디자인 (마스터 전용) — 비주얼 빌더
 * 좌측: 양식 목록 / 우측: 빌더(섹션·필드) | 미리보기 | 원본PDF 오버레이 | 고급(JSON) | 버전
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FileSignature, Plus, Copy, Trash2, Save, Eye, History, FileText, MousePointer2, Sparkles, Signature, Table2,
} from 'lucide-react';
import SortableSectionCard from '@/components/permit-designer/SortableSectionCard';
import PropertyPanel from '@/components/permit-designer/PropertyPanel';
import LivePreview from '@/components/permit-designer/LivePreview';
import OverlayEditor from '@/components/permit-designer/OverlayEditor';
import AIAnalysisPanel from '@/components/permit-designer/AIAnalysisPanel';
import SignatureSlotMapper from '@/components/permit-designer/SignatureSlotMapper';
import GridDesigner from '@/components/permit-grid/GridDesigner';
import type { GridBook } from '@/lib/xlsxGrid';
import type { InputCell } from '@/lib/permitGridTypes';
import { FormLayout, PrintOverlay, SignatureSlot, EMPTY_LAYOUT, EMPTY_OVERLAY, newSection } from '@/lib/permitFormTypes';

type Tpl = {
  id: string;
  project_id: string | null;
  code: string;
  name: string;
  version: string;
  layout_json: FormLayout;
  print_overlay: PrintOverlay;
  original_pdf_url: string | null;
  is_default: boolean;
  is_active: boolean;
  permit_type: string | null;
  signature_slots: SignatureSlot[];
  suggested_approval_steps: number | null;
  ai_analyzed_at: string | null;
  grid_snapshot: GridBook | null;
  input_cells: InputCell[];
  source_xlsx_url: string | null;
  updated_at: string;
};

const PERMIT_TYPE_OPTIONS = [
  { value: 'general', label: '일반' },
  { value: 'confined_space', label: '밀폐공간' },
  { value: 'hot_work', label: '화기' },
  { value: 'excavation', label: '굴착·중장비' },
];

type SelectedRef =
  | { kind: 'section'; sectionId: string }
  | { kind: 'field'; sectionId: string; fieldKey: string }
  | null;

export default function SettingsPermitForms() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const isMaster = hasRole('master');
  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Tpl | null>(null);
  const [layout, setLayout] = useState<FormLayout>(EMPTY_LAYOUT);
  const [overlay, setOverlay] = useState<PrintOverlay>(EMPTY_OVERLAY);
  const [originalPdfUrl, setOriginalPdfUrl] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<SelectedRef>(null);
  const [tab, setTab] = useState('ai');
  const [versions, setVersions] = useState<any[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [signatureSlots, setSignatureSlots] = useState<SignatureSlot[]>([]);
  const [gridSnapshot, setGridSnapshot] = useState<GridBook | null>(null);
  const [inputCells, setInputCells] = useState<InputCell[]>([]);
  const [sourceXlsxUrl, setSourceXlsxUrl] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('permit_form_templates')
      .select('id, project_id, code, name, version, layout_json, print_overlay, original_pdf_url, is_default, is_active, permit_type, signature_slots, suggested_approval_steps, ai_analyzed_at, grid_snapshot, input_cells, source_xlsx_url, updated_at')
      .eq('is_deleted', false)
      .order('code')
      .order('version', { ascending: false });
    if (error) toast({ title: '불러오기 실패', description: error.message, variant: 'destructive' });
    const list = (data || []) as any[];
    const normalizeLayout = (raw: any): FormLayout => {
      if (!raw || typeof raw !== 'object') return EMPTY_LAYOUT;
      const header = raw.header && typeof raw.header === 'object' ? raw.header : EMPTY_LAYOUT.header;
      const secs = Array.isArray(raw.sections) ? raw.sections : [];
      const sections = secs.map((s: any, i: number) => ({
        id: s?.id || `sec_${i}`,
        title: s?.title || `섹션 ${i + 1}`,
        description: s?.description,
        fields: Array.isArray(s?.fields)
          ? s.fields.map((f: any, j: number) => ({
              key: f?.key || `field_${i}_${j}`,
              label: f?.label || '필드',
              type: f?.type || 'text',
              ...f,
              options: Array.isArray(f?.options) ? f.options : undefined,
              columns: Array.isArray(f?.columns) ? f.columns : undefined,
            }))
          : [],
      }));
      return { header, sections };
    };
    const normalizeOverlay = (raw: any): PrintOverlay => {
      if (!raw || typeof raw !== 'object') return EMPTY_OVERLAY;
      const pages = Array.isArray(raw.pages) ? raw.pages.map((p: any) => ({
        page: Number(p?.page) || 1,
        boxes: Array.isArray(p?.boxes) ? p.boxes : [],
      })) : [];
      return { pages };
    };
    setRows(list.map((r) => ({
      ...r,
      layout_json: normalizeLayout(r.layout_json),
      print_overlay: normalizeOverlay(r.print_overlay),
      signature_slots: Array.isArray(r.signature_slots) ? r.signature_slots : [],
    })));
    setLoading(false);
  };

  const loadVersions = async (templateId: string) => {
    const { data } = await supabase
      .from('permit_form_template_versions' as any)
      .select('id, version_label, snapshot_reason, created_at')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(20);
    setVersions((data as any) || []);
  };

  useEffect(() => { if (isMaster) load(); }, [isMaster]);

  if (!isMaster) return <Navigate to="/settings" replace />;

  const openEdit = (t: Tpl) => {
    setSelected(t);
    setLayout(t.layout_json);
    setOverlay(t.print_overlay);
    setOriginalPdfUrl(t.original_pdf_url);
    setSignatureSlots(t.signature_slots || []);
    setSelectedRef(null);
    setTab(t.ai_analyzed_at ? 'builder' : 'ai');
    setJsonText(JSON.stringify(t.layout_json, null, 2));
    loadVersions(t.id);
  };

  const save = async (snapshotReason?: string) => {
    if (!selected) return;
    const payload: any = {
      code: selected.code.trim(),
      name: selected.name.trim(),
      version: selected.version.trim(),
      is_default: selected.is_default,
      is_active: selected.is_active,
      permit_type: selected.permit_type || 'general',
      layout_json: layout,
      print_overlay: overlay,
      original_pdf_url: originalPdfUrl,
      signature_slots: signatureSlots,
      suggested_approval_steps: signatureSlots.length || null,
    };
    const { error } = await supabase.from('permit_form_templates').update(payload).eq('id', selected.id);
    if (error) return toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    await supabase.from('permit_form_template_versions' as any).insert({
      template_id: selected.id,
      version_label: selected.version,
      layout_json: layout,
      print_overlay: overlay,
      original_pdf_url: originalPdfUrl,
      snapshot_reason: snapshotReason || '저장',
    } as any);
    toast({ title: '양식이 저장되었습니다.' });
    await load();
    await loadVersions(selected.id);
  };

  // AI 분석 결과 적용: AI가 만든 기존 박스는 교체, 사용자 수동 박스는 보존
  const applyAIResult = (res: {
    layout: FormLayout; overlay: PrintOverlay; signatureSlots: SignatureSlot[]; detectedTitle?: string;
  }) => {
    const hasSections = (res.layout?.sections?.length || 0) > 0;
    const hasOverlay = (res.overlay?.pages || []).some((p) => (p.boxes?.length || 0) > 0);
    const hasSigs = (res.signatureSlots?.length || 0) > 0;
    if (!hasSections && !hasOverlay && !hasSigs) {
      toast({
        title: '적용할 AI 결과가 없습니다',
        description: 'AI가 인식한 요소가 없어 빌더/오버레이를 변경하지 않았습니다.',
        variant: 'destructive',
      });
      return;
    }

    // overlay 병합
    const mergedPages = new Map<number, any[]>();
    (overlay.pages || []).forEach((p) => {
      mergedPages.set(p.page, p.boxes.filter((b) => !b.ai_generated));
    });
    (res.overlay.pages || []).forEach((p) => {
      const cur = mergedPages.get(p.page) || [];
      mergedPages.set(p.page, [...cur, ...p.boxes]);
    });
    setOverlay({
      pages: Array.from(mergedPages.entries()).map(([page, boxes]) => ({ page, boxes })),
    });

    // layout 병합: AI 자동 섹션은 교체, 사용자 섹션은 유지
    const userSections = (layout.sections || []).filter((s) => !s.id.startsWith('sec_ai_'));
    setLayout({
      header: res.detectedTitle
        ? { ...layout.header, title: res.detectedTitle }
        : layout.header,
      sections: [...userSections, ...(res.layout.sections || [])],
    });

    setSignatureSlots(res.signatureSlots);
    setTab('builder');
    toast({ title: 'AI 결과가 적용되었습니다. 검토 후 저장하세요.' });
  };


  const createNew = async (clone?: Tpl) => {
    const base = clone
      ? {
          code: clone.code,
          name: `${clone.name} (복제)`,
          version: 'v' + Date.now().toString().slice(-4),
          layout_json: clone.layout_json,
          print_overlay: clone.print_overlay,
          original_pdf_url: clone.original_pdf_url,
        }
      : {
          code: 'CUSTOM-' + Date.now().toString().slice(-4),
          name: '새 허가서 양식',
          version: 'v1',
          layout_json: EMPTY_LAYOUT,
          print_overlay: EMPTY_OVERLAY,
          original_pdf_url: null,
        };
    const { data, error } = await supabase
      .from('permit_form_templates')
      .insert({ ...base, project_id: null, is_default: false, is_active: true } as any)
      .select()
      .single();
    if (error) return toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    toast({ title: '새 양식이 생성되었습니다.' });
    await load();
    openEdit({
      ...(data as any),
      layout_json: base.layout_json,
      print_overlay: base.print_overlay,
    } as Tpl);
  };

  const remove = async (t: Tpl) => {
    if (!confirm(`"${t.name}" ${t.version} 양식을 삭제하시겠습니까? (소프트 삭제)`)) return;
    const { error } = await supabase.from('permit_form_templates').update({ is_deleted: true } as any).eq('id', t.id);
    if (error) return toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    if (selected?.id === t.id) setSelected(null);
    await load();
    toast({ title: '삭제되었습니다.' });
  };

  // 섹션 정렬
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = layout.sections.findIndex((s) => s.id === active.id);
    const newIndex = layout.sections.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLayout({ ...layout, sections: arrayMove(layout.sections, oldIndex, newIndex) });
  };

  const addSection = () => {
    const s = newSection(layout.sections.length);
    setLayout({ ...layout, sections: [...layout.sections, s] });
    setSelectedRef({ kind: 'section', sectionId: s.id });
  };

  const duplicateSection = (id: string) => {
    const idx = layout.sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const src = layout.sections[idx];
    const copy = {
      ...src,
      id: `sec_${Date.now().toString(36)}`,
      title: `${src.title} (복제)`,
      fields: src.fields.map((f) => ({ ...f, key: `${f.key}_${Date.now().toString(36).slice(-3)}` })),
    };
    const next = [...layout.sections];
    next.splice(idx + 1, 0, copy);
    setLayout({ ...layout, sections: next });
  };

  return (
    <div className="space-y-3 animate-fade-in p-3 md:p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSignature className="h-6 w-6" /> 허가서 양식 디자인
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            마스터 전용. 드래그앤드롭 빌더와 원본 PDF 좌표 매핑으로 원본과 동일한 인쇄가 가능합니다.
          </p>
        </div>
        <Button size="sm" onClick={() => createNew()}><Plus className="h-4 w-4 mr-1" />새 양식</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">양식 목록</CardTitle></CardHeader>
          <CardContent className="p-2 space-y-1 max-h-[80vh] overflow-auto">
            {loading && <div className="text-xs text-muted-foreground p-2">불러오는 중...</div>}
            {!loading && rows.length === 0 && <div className="text-xs text-muted-foreground p-2">등록된 양식이 없습니다.</div>}
            {rows.map((t) => (
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

        {!selected ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">왼쪽에서 양식을 선택하거나 새 양식을 생성하세요.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {/* 메타 정보 + 저장 */}
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div><Label className="text-xs">코드</Label>
                    <Input className="h-8" value={selected.code} onChange={(e) => setSelected({ ...selected, code: e.target.value })} />
                  </div>
                  <div><Label className="text-xs">이름</Label>
                    <Input className="h-8" value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} />
                  </div>
                  <div><Label className="text-xs">버전</Label>
                    <Input className="h-8" value={selected.version} onChange={(e) => setSelected({ ...selected, version: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-[220px]">
                    <Label className="text-xs">허가서 종류</Label>
                    <Select
                      value={selected.permit_type || 'general'}
                      onValueChange={(v) => setSelected({ ...selected, permit_type: v })}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PERMIT_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1">이 종류의 허가서를 작성할 때 자동 로드됩니다.</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={selected.is_default} onCheckedChange={(v) => setSelected({ ...selected, is_default: v })} />
                    이 종류의 기본 양식으로 사용
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={selected.is_active} onCheckedChange={(v) => setSelected({ ...selected, is_active: v })} />
                    활성
                  </label>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowJson(!showJson)}>{showJson ? '고급 닫기' : '고급 (JSON)'}</Button>
                    <Button size="sm" onClick={() => save()}><Save className="h-4 w-4 mr-1" />저장</Button>
                  </div>
                </div>
                {showJson && (
                  <div className="pt-2">
                    <Label className="text-xs">레이아웃 JSON (직접 편집)</Label>
                    <Textarea
                      rows={12}
                      value={jsonText}
                      onChange={(e) => setJsonText(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => {
                      try {
                        const parsed = JSON.parse(jsonText);
                        setLayout(parsed);
                        toast({ title: 'JSON이 빌더에 적용되었습니다.' });
                      } catch (err: any) {
                        toast({ title: 'JSON 오류', description: err.message, variant: 'destructive' });
                      }
                    }}>JSON → 빌더에 적용</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="ai"><Sparkles className="h-4 w-4 mr-1" />AI 자동 분석</TabsTrigger>
                <TabsTrigger value="overlay"><FileText className="h-4 w-4 mr-1" />원본 PDF 오버레이</TabsTrigger>
                <TabsTrigger value="signatures"><Signature className="h-4 w-4 mr-1" />서명·결재라인 ({signatureSlots.length})</TabsTrigger>
                <TabsTrigger value="builder"><MousePointer2 className="h-4 w-4 mr-1" />빌더</TabsTrigger>
                <TabsTrigger value="preview"><Eye className="h-4 w-4 mr-1" />미리보기</TabsTrigger>
                <TabsTrigger value="versions"><History className="h-4 w-4 mr-1" />버전</TabsTrigger>
              </TabsList>

              <TabsContent value="ai">
                <Card>
                  <CardContent className="p-3 space-y-3">
                    <AIAnalysisPanel
                      templateId={selected.id}
                      originalPdfUrl={originalPdfUrl}
                      onApply={applyAIResult}
                    />
                    {selected.ai_analyzed_at && (
                      <p className="text-[11px] text-muted-foreground">
                        마지막 AI 분석: {new Date(selected.ai_analyzed_at).toLocaleString('ko-KR')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="signatures">
                <Card>
                  <CardContent className="p-3">
                    <SignatureSlotMapper slots={signatureSlots} onChange={setSignatureSlots} />
                  </CardContent>
                </Card>
              </TabsContent>


              <TabsContent value="builder">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
                  <Card>
                    <CardHeader className="py-2 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">섹션 / 필드</CardTitle>
                      <Button size="sm" variant="outline" onClick={addSection}><Plus className="h-3.5 w-3.5 mr-1" />섹션 추가</Button>
                    </CardHeader>
                    <CardContent className="space-y-2 max-h-[70vh] overflow-auto" onClick={() => setSelectedRef(null)}>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                        <SortableContext items={layout.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                          {layout.sections.map((s) => (
                            <SortableSectionCard
                              key={s.id}
                              section={s}
                              selected={selectedRef}
                              onSelect={setSelectedRef}
                              onChange={(updated) => setLayout({ ...layout, sections: layout.sections.map((x) => (x.id === s.id ? updated : x)) })}
                              onDelete={() => {
                                setLayout({ ...layout, sections: layout.sections.filter((x) => x.id !== s.id) });
                                if (selectedRef?.sectionId === s.id) setSelectedRef(null);
                              }}
                              onDuplicate={() => duplicateSection(s.id)}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                      {layout.sections.length === 0 && (
                        <div className="text-center text-sm text-muted-foreground py-12 border-2 border-dashed rounded">
                          섹션을 추가해 시작하세요.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="py-2"><CardTitle className="text-sm">속성</CardTitle></CardHeader>
                    <CardContent className="max-h-[70vh] overflow-auto">
                      <PropertyPanel layout={layout} selected={selectedRef} onChange={setLayout} />
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="preview">
                <LivePreview layout={layout} />
              </TabsContent>

              <TabsContent value="overlay">
                <OverlayEditor
                  templateId={selected.id}
                  layout={layout}
                  overlay={overlay}
                  originalPdfUrl={originalPdfUrl}
                  onChange={(o, u) => { setOverlay(o); setOriginalPdfUrl(u); }}
                />
              </TabsContent>

              <TabsContent value="versions">
                <Card>
                  <CardContent className="p-3">
                    {versions.length === 0 && <div className="text-sm text-muted-foreground">저장된 버전이 없습니다.</div>}
                    <div className="space-y-1">
                      {versions.map((v) => (
                        <div key={v.id} className="text-xs flex items-center justify-between border-b py-1">
                          <span>{new Date(v.created_at).toLocaleString()} — {v.version_label} {v.snapshot_reason && `· ${v.snapshot_reason}`}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
