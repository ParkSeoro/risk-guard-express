import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, Presentation, Sparkles, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import pptxgen from "pptxgenjs";

type Material = {
  id?: string;
  project_id: string;
  company_id?: string | null;
  run_id?: string | null;
  work_plan_id?: string | null;
  title: string;
  work_overview: string;
  key_hazards: Array<{ hazard: string; description: string; risk_level: string }>;
  accident_cases: Array<{ title: string; summary: string; lesson: string }>;
  safety_measures: string[];
  prohibited_actions: string[];
  ppe_requirements: string[];
  tbm_summary: string;
  auto_generated?: boolean;
};

const empty = (project_id: string): Material => ({
  project_id, title: "", work_overview: "",
  key_hazards: [], accident_cases: [],
  safety_measures: [], prohibited_actions: [], ppe_requirements: [],
  tbm_summary: "", auto_generated: false,
});

export default function EducationMaterials() {
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState<string>(() =>
    params.get("project") || localStorage.getItem("currentProjectId") || ""
  );
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [list, setList] = useState<Material[]>([]);
  const [runs, setRuns] = useState<Array<{ id: string; period_label: string }>>([]);
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [editing, setEditing] = useState<Material | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("projects").select("id,name").eq('is_deleted', false).then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    loadMaterials();
    supabase.from("assessment_runs")
      .select("id,period_label")
      .eq("project_id", projectId)
      .eq("status", "승인완료")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRuns(data || []));
  }, [projectId]);

  const loadMaterials = async () => {
    const { data, error } = await supabase
      .from("safety_education_materials")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) { toast.error("불러오기 실패: " + error.message); return; }
    setList(data as any || []);
  };

  const generate = async () => {
    if (!selectedRun) { toast.error("위험성평가를 선택하세요"); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-education-material", {
        body: { run_id: selectedRun, project_id: projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const mat = data.material;
      setEditing({
        ...empty(projectId),
        ...mat,
        run_id: selectedRun,
        auto_generated: true,
      });
      toast.success("교육자료가 생성되었습니다");
    } catch (e: any) {
      toast.error("생성 실패: " + (e.message || "오류"));
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = { ...editing };
      delete (payload as any).id;
      if (editing.id) {
        const { error } = await supabase.from("safety_education_materials")
          .update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("safety_education_materials")
          .insert([payload]);
        if (error) throw error;
      }
      toast.success("저장 완료");
      setEditing(null);
      loadMaterials();
    } catch (e: any) {
      toast.error("저장 실패: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const printPdf = (m: Material) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${m.title}</title>
<style>
body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;padding:20px;color:#1a202c;line-height:1.6;font-size:12pt}
h1{font-size:20pt;border-bottom:3px solid #ea580c;padding-bottom:8px}
h2{font-size:14pt;color:#1e3a8a;margin-top:18px;border-left:4px solid #ea580c;padding-left:8px}
ul{padding-left:20px} li{margin:4px 0}
.box{border:1px solid #cbd5e1;padding:10px;margin:6px 0;border-radius:4px;background:#f8fafc}
.badge{display:inline-block;padding:2px 8px;background:#ea580c;color:white;font-size:10pt;border-radius:4px;margin-right:6px}
@media print{body{padding:0}}
</style></head><body>
<h1>${m.title}</h1>
<h2>1. 작업 개요</h2><div class="box">${m.work_overview.replace(/\n/g,"<br>")}</div>
<h2>2. 주요 위험요인</h2>
${m.key_hazards.map(h=>`<div class="box"><span class="badge">${h.risk_level}</span><strong>${h.hazard}</strong><br>${h.description}</div>`).join("")}
<h2>3. 사고사례</h2>
${m.accident_cases.map(a=>`<div class="box"><strong>${a.title}</strong><br>${a.summary}<br><em>교훈: ${a.lesson}</em></div>`).join("")}
<h2>4. 안전대책</h2><ul>${m.safety_measures.map(s=>`<li>${s}</li>`).join("")}</ul>
<h2>5. 작업 금지사항</h2><ul>${m.prohibited_actions.map(s=>`<li style="color:#dc2626">⛔ ${s}</li>`).join("")}</ul>
<h2>6. PPE 보호구</h2><ul>${m.ppe_requirements.map(s=>`<li>${s}</li>`).join("")}</ul>
<h2>7. TBM 브리핑 요약</h2><div class="box">${m.tbm_summary.replace(/\n/g,"<br>")}</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  };

  const exportPpt = async (m: Material) => {
    const pres = new pptxgen();
    pres.layout = "LAYOUT_WIDE";
    const NAVY = "1E3A8A", ORANGE = "EA580C", LIGHT = "F8FAFC", DARK = "1A202C";

    // Title
    let s = pres.addSlide();
    s.background = { color: NAVY };
    s.addText(m.title, { x: 0.5, y: 2, w: 12.3, h: 1.5, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Malgun Gothic", align: "center" });
    s.addText("산업안전보건교육 자료", { x: 0.5, y: 3.6, w: 12.3, h: 0.6, fontSize: 18, color: "FCD34D", fontFace: "Malgun Gothic", align: "center" });

    // Overview
    s = pres.addSlide();
    s.addText("1. 작업 개요", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: NAVY, fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: ORANGE } });
    s.addText(m.work_overview, { x: 0.4, y: 1.3, w: 12.5, h: 5.5, fontSize: 18, color: DARK, fontFace: "Malgun Gothic", valign: "top" });

    // Hazards
    s = pres.addSlide();
    s.addText("2. 주요 위험요인", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: NAVY, fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: ORANGE } });
    const hazRows: any[] = [[
      { text: "등급", options: { bold: true, fill: { color: NAVY }, color: "FFFFFF" } },
      { text: "위험요인", options: { bold: true, fill: { color: NAVY }, color: "FFFFFF" } },
      { text: "설명", options: { bold: true, fill: { color: NAVY }, color: "FFFFFF" } },
    ]];
    m.key_hazards.forEach(h => hazRows.push([
      { text: h.risk_level, options: { bold: true, color: h.risk_level === "상" ? "DC2626" : DARK } },
      h.hazard, h.description,
    ]));
    s.addTable(hazRows, { x: 0.4, y: 1.2, w: 12.5, fontSize: 14, fontFace: "Malgun Gothic", colW: [1.2, 3.3, 8] });

    // Accident cases
    s = pres.addSlide();
    s.addText("3. 사고사례", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: NAVY, fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: ORANGE } });
    let y = 1.2;
    m.accident_cases.slice(0, 3).forEach(a => {
      s.addShape("rect", { x: 0.4, y, w: 12.5, h: 1.6, fill: { color: LIGHT }, line: { color: "CBD5E1" } });
      s.addText(a.title, { x: 0.6, y: y + 0.05, w: 12, h: 0.4, fontSize: 16, bold: true, color: ORANGE, fontFace: "Malgun Gothic" });
      s.addText(a.summary, { x: 0.6, y: y + 0.45, w: 12, h: 0.5, fontSize: 13, fontFace: "Malgun Gothic" });
      s.addText("교훈: " + a.lesson, { x: 0.6, y: y + 0.95, w: 12, h: 0.5, fontSize: 13, italic: true, color: NAVY, fontFace: "Malgun Gothic" });
      y += 1.75;
    });

    // Safety measures
    s = pres.addSlide();
    s.addText("4. 안전대책", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: NAVY, fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: ORANGE } });
    s.addText(m.safety_measures.map(t => ({ text: "✓ " + t, options: { fontSize: 16, color: DARK, bullet: false, fontFace: "Malgun Gothic", breakLine: true } })),
      { x: 0.6, y: 1.2, w: 12.3, h: 5.8, paraSpaceAfter: 6 });

    // Prohibited
    s = pres.addSlide();
    s.addText("5. 작업 금지사항", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: "DC2626", fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: "DC2626" } });
    s.addText(m.prohibited_actions.map(t => ({ text: "⛔ " + t, options: { fontSize: 18, bold: true, color: "DC2626", fontFace: "Malgun Gothic", breakLine: true } })),
      { x: 0.6, y: 1.2, w: 12.3, h: 5.8, paraSpaceAfter: 8 });

    // PPE
    s = pres.addSlide();
    s.addText("6. PPE 보호구", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: NAVY, fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: ORANGE } });
    s.addText(m.ppe_requirements.map(t => ({ text: "▣ " + t, options: { fontSize: 18, color: DARK, fontFace: "Malgun Gothic", breakLine: true } })),
      { x: 0.6, y: 1.2, w: 12.3, h: 5.8, paraSpaceAfter: 6 });

    // TBM Summary
    s = pres.addSlide();
    s.background = { color: NAVY };
    s.addText("7. TBM 브리핑 요약", { x: 0.4, y: 0.3, w: 12, h: 0.6, fontSize: 26, bold: true, color: "FFFFFF", fontFace: "Malgun Gothic" });
    s.addShape("rect", { x: 0.4, y: 0.95, w: 12.5, h: 0.05, fill: { color: "FCD34D" } });
    s.addText(m.tbm_summary, { x: 0.5, y: 1.3, w: 12.3, h: 5.5, fontSize: 18, color: "FFFFFF", fontFace: "Malgun Gothic", valign: "top" });

    await pres.writeFile({ fileName: `${m.title || "교육자료"}.pptx` });
  };

  const updateField = <K extends keyof Material>(k: K, v: Material[K]) =>
    setEditing(e => e ? { ...e, [k]: v } : e);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" /> 교육자료 관리</h1>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {projectId && !editing && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-accent" /> AI 자동 생성</CardTitle></CardHeader>
          <CardContent className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <Label>위험성평가 회차</Label>
              <Select value={selectedRun} onValueChange={setSelectedRun}>
                <SelectTrigger><SelectValue placeholder="승인완료된 평가 선택" /></SelectTrigger>
                <SelectContent>{runs.map(r => <SelectItem key={r.id} value={r.id}>{r.period_label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={generate} disabled={generating || !selectedRun}>
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              교육자료 생성
            </Button>
            <Button variant="outline" onClick={() => setEditing(empty(projectId))}><Plus className="h-4 w-4 mr-2" /> 수동 작성</Button>
          </CardContent>
        </Card>
      )}

      {!editing && (
        <Card>
          <CardHeader><CardTitle>교육자료 목록</CardTitle></CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">생성된 자료가 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {list.map(m => (
                  <div key={m.id} className="flex items-center justify-between border rounded p-3 hover:bg-muted/30">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {m.title}
                        {m.auto_generated && <Badge variant="secondary">AI</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.work_overview.slice(0, 100)}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(m as any)}>수정</Button>
                      <Button size="sm" variant="outline" onClick={() => printPdf(m as any)}><FileText className="h-4 w-4 mr-1" />PDF</Button>
                      <Button size="sm" variant="outline" onClick={() => exportPpt(m as any)}><Presentation className="h-4 w-4 mr-1" />PPT</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>교육자료 편집</CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>취소</Button>
                <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <Save className="h-4 w-4 mr-2"/>}저장</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>제목</Label>
              <Input value={editing.title} onChange={e => updateField("title", e.target.value)} />
            </div>
            <div>
              <Label>작업 개요</Label>
              <Textarea rows={3} value={editing.work_overview} onChange={e => updateField("work_overview", e.target.value)} />
            </div>
            <ListField label="안전대책" items={editing.safety_measures} onChange={v => updateField("safety_measures", v)} />
            <ListField label="작업 금지사항" items={editing.prohibited_actions} onChange={v => updateField("prohibited_actions", v)} />
            <ListField label="PPE 보호구" items={editing.ppe_requirements} onChange={v => updateField("ppe_requirements", v)} />
            <div>
              <Label>주요 위험요인 (JSON)</Label>
              <Textarea rows={6} value={JSON.stringify(editing.key_hazards, null, 2)}
                onChange={e => { try { updateField("key_hazards", JSON.parse(e.target.value)); } catch {} }} />
            </div>
            <div>
              <Label>사고사례 (JSON)</Label>
              <Textarea rows={6} value={JSON.stringify(editing.accident_cases, null, 2)}
                onChange={e => { try { updateField("accident_cases", JSON.parse(e.target.value)); } catch {} }} />
            </div>
            <div>
              <Label>TBM 브리핑 요약</Label>
              <Textarea rows={5} value={editing.tbm_summary} onChange={e => updateField("tbm_summary", e.target.value)} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ListField({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <Label>{label}</Label>
        <Button size="sm" variant="outline" onClick={() => onChange([...items, ""])}><Plus className="h-3 w-3 mr-1" />추가</Button>
      </div>
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <Input value={it} onChange={e => { const n = [...items]; n[i] = e.target.value; onChange(n); }} />
            <Button size="icon" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
