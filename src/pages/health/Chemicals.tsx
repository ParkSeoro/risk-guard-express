import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToastError } from "@/hooks/useToastError";
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { toast } from "sonner";
import { Plus, FlaskConical, FileText, CalendarRange } from "lucide-react";

const ACTIVE_PROJECT_KEY = "selectedProjectId";

type Company = { id: string; name: string };
type Chemical = {
  id: string; name: string; cas_no: string | null; trade_name: string | null;
  hazard_class: string | null; is_carcinogen: boolean; is_reproductive_toxin: boolean;
  msds_file_url: string | null; storage_location: string | null;
  monthly_usage: number | null; unit: string | null; notes: string | null;
  company_id: string | null;
};
type UsagePlan = {
  id: string; chemical_id: string | null; plan_type: "annual" | "monthly";
  year: number; month: number | null; planned_qty: number | null; actual_qty: number | null;
  unit: string | null; storage_max_qty: number | null; legal_basis: string | null;
  notes: string | null; company_id: string | null;
};

export default function Chemicals() {
  const handle = useToastError();
  const { userCompanyId, applyCompanyFilter, isMaster, isProjectAdmin, isSafetyManager } =
    useGlobalProjectAccess();
  const canSeeAllCompanies = isMaster || isProjectAdmin || isSafetyManager;

  const projectId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [list, setList] = useState<Chemical[]>([]);
  const [plans, setPlans] = useState<UsagePlan[]>([]);
  const [loading, setLoading] = useState(true);

  // dialogs
  const [chemOpen, setChemOpen] = useState(false);
  const [chemForm, setChemForm] = useState<any>({});
  const [planOpen, setPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState<any>({ plan_type: "monthly", year: new Date().getFullYear(), month: new Date().getMonth() + 1 });

  const loadCompanies = async () => {
    if (!projectId) return;
    const rows = await (await import("@/lib/projectCompanies")).fetchProjectCompanies(projectId);
    setCompanies(rows.map(c => ({ id: c.id, name: c.name })) as Company[]);
  };

  const loadChemicals = async () => {
    if (!projectId) return;
    let q = supabase.from("chemicals").select("*")
      .eq("project_id", projectId).eq("is_deleted", false).order("name");
    q = applyCompanyFilter(q);
    const { data, error } = await q;
    if (error) handle(error, "화학물질 조회");
    setList((data || []) as Chemical[]);
  };

  const loadPlans = async () => {
    if (!projectId) return;
    let q = supabase.from("chemical_usage_plans").select("*")
      .eq("project_id", projectId).eq("is_deleted", false)
      .order("year", { ascending: false }).order("month", { ascending: false });
    q = applyCompanyFilter(q);
    const { data, error } = await q;
    if (error) handle(error, "사용계획 조회");
    setPlans((data || []) as UsagePlan[]);
  };

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([loadCompanies(), loadChemicals(), loadPlans()]).finally(() => setLoading(false));
  }, [projectId, userCompanyId]);

  const chemicalCompany = (id: string | null) =>
    companies.find(c => c.id === id)?.name || "-";

  const submitChemical = async () => {
    if (!projectId || !chemForm.name) { toast.error("물질명은 필수입니다"); return; }
    const company_id = canSeeAllCompanies ? (chemForm.company_id || null) : userCompanyId;
    if (!company_id && !isMaster && !isProjectAdmin && !isSafetyManager) {
      toast.error("소속 회사를 확인할 수 없습니다"); return;
    }
    try {
      let msdsUrl: string | null = null;
      if (chemForm.msdsFile) {
        const path = `${projectId}/chemicals/${Date.now()}_${chemForm.msdsFile.name}`;
        const { error: upErr } = await supabase.storage.from("attachments")
          .upload(path, chemForm.msdsFile, { upsert: false, contentType: chemForm.msdsFile.type });
        if (upErr) throw upErr;
        msdsUrl = supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("chemicals").insert({
        project_id: projectId,
        company_id,
        name: chemForm.name,
        cas_no: chemForm.cas_no || null,
        trade_name: chemForm.trade_name || null,
        hazard_class: chemForm.hazard_class || null,
        is_carcinogen: !!chemForm.is_carcinogen,
        is_reproductive_toxin: !!chemForm.is_reproductive_toxin,
        msds_file_url: msdsUrl,
        storage_location: chemForm.storage_location || null,
        monthly_usage: chemForm.monthly_usage ? Number(chemForm.monthly_usage) : null,
        unit: chemForm.unit || null,
        notes: chemForm.notes || null,
      });
      if (error) throw error;
      toast.success("등록되었습니다");
      setChemOpen(false); setChemForm({});
      await loadChemicals();
    } catch (e) { handle(e, "화학물질 등록"); }
  };

  const submitPlan = async () => {
    if (!projectId) return;
    if (!planForm.year) { toast.error("연도를 입력하세요"); return; }
    if (planForm.plan_type === "monthly" && !planForm.month) { toast.error("월을 입력하세요"); return; }
    const company_id = canSeeAllCompanies ? (planForm.company_id || null) : userCompanyId;
    try {
      const { error } = await supabase.from("chemical_usage_plans").insert({
        project_id: projectId,
        company_id,
        chemical_id: planForm.chemical_id || null,
        plan_type: planForm.plan_type,
        year: Number(planForm.year),
        month: planForm.plan_type === "monthly" ? Number(planForm.month) : null,
        planned_qty: planForm.planned_qty ? Number(planForm.planned_qty) : null,
        actual_qty: planForm.actual_qty ? Number(planForm.actual_qty) : null,
        unit: planForm.unit || null,
        storage_max_qty: planForm.storage_max_qty ? Number(planForm.storage_max_qty) : null,
        legal_basis: planForm.legal_basis || "산업안전보건법 제114조 / 화학물질관리법 시행규칙 제19조",
        notes: planForm.notes || null,
      });
      if (error) throw error;
      toast.success("사용계획이 등록되었습니다");
      setPlanOpen(false);
      setPlanForm({ plan_type: "monthly", year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
      await loadPlans();
    } catch (e) { handle(e, "사용계획 등록"); }
  };

  const chemicalById = useMemo(() => Object.fromEntries(list.map(c => [c.id, c])), [list]);

  if (!projectId) return <div className="p-6 text-muted-foreground">프로젝트를 선택해주세요.</div>;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FlaskConical className="h-6 w-6" />화학물질 / MSDS · 사용계획</h1>
        <p className="text-sm text-muted-foreground mt-1">
          산업안전보건법 제114조(MSDS 게시·교육), 화학물질관리법 시행규칙 제19조(연간 취급계획서)
          {!canSeeAllCompanies && " · 소속 회사 데이터만 조회됩니다"}
        </p>
      </div>

      <Tabs defaultValue="chemicals">
        <TabsList>
          <TabsTrigger value="chemicals"><FlaskConical className="h-4 w-4 mr-1" />물질 목록</TabsTrigger>
          <TabsTrigger value="plans"><CalendarRange className="h-4 w-4 mr-1" />사용계획 (월/연)</TabsTrigger>
        </TabsList>

        <TabsContent value="chemicals" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setChemOpen(true)}><Plus className="h-4 w-4 mr-1" />물질 등록</Button>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">등록된 화학물질 ({list.length})</CardTitle></CardHeader>
            <CardContent>
              {loading ? <div className="text-sm text-muted-foreground">로딩 중…</div> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>물질명</TableHead><TableHead>CAS</TableHead>
                      <TableHead>소속 회사</TableHead>
                      <TableHead>유해성</TableHead>
                      <TableHead>월 사용량</TableHead><TableHead>보관위치</TableHead><TableHead>MSDS</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {list.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.name} {c.trade_name && <span className="text-xs text-muted-foreground">({c.trade_name})</span>}</TableCell>
                          <TableCell className="text-xs">{c.cas_no || "-"}</TableCell>
                          <TableCell className="text-xs">{chemicalCompany(c.company_id)}</TableCell>
                          <TableCell className="space-x-1">
                            {c.is_carcinogen && <Badge variant="destructive">발암성</Badge>}
                            {c.is_reproductive_toxin && <Badge variant="destructive">생식독성</Badge>}
                            {c.hazard_class && <Badge variant="outline">{c.hazard_class}</Badge>}
                          </TableCell>
                          <TableCell>{c.monthly_usage ?? "-"} {c.unit || ""}</TableCell>
                          <TableCell className="text-xs">{c.storage_location || "-"}</TableCell>
                          <TableCell>{c.msds_file_url ? <a href={c.msds_file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1"><FileText className="h-3 w-3" />보기</a> : "-"}</TableCell>
                        </TableRow>
                      ))}
                      {list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">등록된 화학물질이 없습니다.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setPlanOpen(true)}><Plus className="h-4 w-4 mr-1" />사용계획 등록</Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">사용계획 ({plans.length})</CardTitle>
              <p className="text-xs text-muted-foreground">화관법상 연간 취급계획서 및 월간 사용·재고 관리</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>유형</TableHead><TableHead>기간</TableHead>
                    <TableHead>물질</TableHead><TableHead>소속 회사</TableHead>
                    <TableHead>계획량</TableHead><TableHead>실사용량</TableHead>
                    <TableHead>최대보관</TableHead><TableHead>법적근거</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {plans.map(p => (
                      <TableRow key={p.id}>
                        <TableCell><Badge variant={p.plan_type === "annual" ? "default" : "outline"}>{p.plan_type === "annual" ? "연간" : "월간"}</Badge></TableCell>
                        <TableCell className="text-sm">{p.year}{p.month ? `-${String(p.month).padStart(2,"0")}` : "년"}</TableCell>
                        <TableCell className="text-sm">{p.chemical_id ? (chemicalById[p.chemical_id]?.name || "(삭제됨)") : "전체"}</TableCell>
                        <TableCell className="text-xs">{chemicalCompany(p.company_id)}</TableCell>
                        <TableCell>{p.planned_qty ?? "-"} {p.unit || ""}</TableCell>
                        <TableCell>{p.actual_qty ?? "-"} {p.unit || ""}</TableCell>
                        <TableCell>{p.storage_max_qty ?? "-"} {p.unit || ""}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.legal_basis || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {plans.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">등록된 사용계획이 없습니다.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Chemical dialog */}
      <Dialog open={chemOpen} onOpenChange={setChemOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>화학물질 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>물질명 *</Label><Input value={chemForm.name || ""} onChange={e => setChemForm({ ...chemForm, name: e.target.value })} /></div>
            {canSeeAllCompanies && (
              <div className="col-span-2">
                <Label>소속 회사</Label>
                <Select value={chemForm.company_id || ""} onValueChange={v => setChemForm({ ...chemForm, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="회사 선택 (선택)" /></SelectTrigger>
                  <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>CAS No.</Label><Input value={chemForm.cas_no || ""} onChange={e => setChemForm({ ...chemForm, cas_no: e.target.value })} /></div>
            <div><Label>상품명</Label><Input value={chemForm.trade_name || ""} onChange={e => setChemForm({ ...chemForm, trade_name: e.target.value })} /></div>
            <div><Label>유해등급</Label><Input value={chemForm.hazard_class || ""} onChange={e => setChemForm({ ...chemForm, hazard_class: e.target.value })} /></div>
            <div><Label>보관위치</Label><Input value={chemForm.storage_location || ""} onChange={e => setChemForm({ ...chemForm, storage_location: e.target.value })} /></div>
            <div><Label>월 사용량</Label><Input type="number" value={chemForm.monthly_usage || ""} onChange={e => setChemForm({ ...chemForm, monthly_usage: e.target.value })} /></div>
            <div><Label>단위</Label><Input value={chemForm.unit || ""} onChange={e => setChemForm({ ...chemForm, unit: e.target.value })} placeholder="kg, L" /></div>
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2"><Checkbox checked={!!chemForm.is_carcinogen} onCheckedChange={v => setChemForm({ ...chemForm, is_carcinogen: !!v })} />발암성(1A/1B)</label>
              <label className="flex items-center gap-2"><Checkbox checked={!!chemForm.is_reproductive_toxin} onCheckedChange={v => setChemForm({ ...chemForm, is_reproductive_toxin: !!v })} />생식독성</label>
            </div>
            <div className="col-span-2"><Label>MSDS 파일 (PDF)</Label><Input type="file" accept="application/pdf,image/*" onChange={e => setChemForm({ ...chemForm, msdsFile: e.target.files?.[0] })} /></div>
            <div className="col-span-2"><Label>비고</Label><Input value={chemForm.notes || ""} onChange={e => setChemForm({ ...chemForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setChemOpen(false)}>취소</Button><Button onClick={submitChemical}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usage plan dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>화학물질 사용계획 등록</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>유형 *</Label>
              <Select value={planForm.plan_type} onValueChange={v => setPlanForm({ ...planForm, plan_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">연간 (화관법)</SelectItem>
                  <SelectItem value="monthly">월간</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>물질</Label>
              <Select value={planForm.chemical_id || ""} onValueChange={v => setPlanForm({ ...planForm, chemical_id: v })}>
                <SelectTrigger><SelectValue placeholder="물질 선택 (선택)" /></SelectTrigger>
                <SelectContent>{list.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {canSeeAllCompanies && (
              <div className="col-span-2">
                <Label>소속 회사</Label>
                <Select value={planForm.company_id || ""} onValueChange={v => setPlanForm({ ...planForm, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="회사 선택 (선택)" /></SelectTrigger>
                  <SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>연도 *</Label><Input type="number" value={planForm.year || ""} onChange={e => setPlanForm({ ...planForm, year: e.target.value })} /></div>
            {planForm.plan_type === "monthly" && (
              <div><Label>월 (1-12) *</Label><Input type="number" min={1} max={12} value={planForm.month || ""} onChange={e => setPlanForm({ ...planForm, month: e.target.value })} /></div>
            )}
            <div><Label>계획 사용량</Label><Input type="number" value={planForm.planned_qty || ""} onChange={e => setPlanForm({ ...planForm, planned_qty: e.target.value })} /></div>
            <div><Label>실 사용량</Label><Input type="number" value={planForm.actual_qty || ""} onChange={e => setPlanForm({ ...planForm, actual_qty: e.target.value })} /></div>
            <div><Label>최대 보관량</Label><Input type="number" value={planForm.storage_max_qty || ""} onChange={e => setPlanForm({ ...planForm, storage_max_qty: e.target.value })} /></div>
            <div><Label>단위</Label><Input value={planForm.unit || ""} onChange={e => setPlanForm({ ...planForm, unit: e.target.value })} placeholder="kg, L" /></div>
            <div className="col-span-2"><Label>법적근거</Label><Input value={planForm.legal_basis || ""} onChange={e => setPlanForm({ ...planForm, legal_basis: e.target.value })} placeholder="산업안전보건법 제114조 / 화관법 시행규칙 제19조" /></div>
            <div className="col-span-2"><Label>비고</Label><Input value={planForm.notes || ""} onChange={e => setPlanForm({ ...planForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPlanOpen(false)}>취소</Button><Button onClick={submitPlan}>등록</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
