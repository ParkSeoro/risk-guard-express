import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ShieldAlert, Plus, Trash2, MapPin, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSoftDelete } from "@/hooks/useSoftDelete";

type Zone = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  geometry_type: "polygon" | "radius";
  geo_polygon: { lat: number; lng: number }[] | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  banned_worker_ids: string[];
  banned_company_ids: string[];
  banned_job_types: string[];
  is_active: boolean;
};

type WorkerOpt = { id: string; name: string; job_type: string | null; company_id: string | null; company_name: string };
type CompanyOpt = { id: string; name: string };

const emptyForm = {
  name: "",
  description: "",
  geometry_type: "radius" as "polygon" | "radius",
  center_lat: "",
  center_lng: "",
  radius_m: "30",
  polygon_text: "",
  banned_worker_ids: [] as string[],
  banned_company_ids: [] as string[],
  banned_job_types_text: "",
  is_active: true,
};

export default function RestrictedZones() {
  const [projectId, setProjectId] = useState(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [workers, setWorkers] = useState<WorkerOpt[]>([]);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const { softDelete } = useSoftDelete();

  const jobTypeOptions = useMemo(() => {
    const set = new Set<string>();
    workers.forEach((w) => {
      if (w.job_type?.trim()) set.add(w.job_type.trim());
    });
    return [...set].sort();
  }, [workers]);

  useEffect(() => {
    supabase.from("projects").select("id,name").eq('is_deleted', false).then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    loadAll();
  }, [projectId]);

  const loadAll = async () => {
    setLoading(true);
    const [zRes, wRes, cRes] = await Promise.all([
      supabase
        .from("restricted_zones")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("workers")
        .select("id, name, job_type, company_id, company_name")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("name")
        .limit(500),
      supabase
        .from("companies")
        .select("id, name")
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .order("name"),
    ]);
    if (zRes.error) toast.error("구역 로드 실패: " + zRes.error.message);
    setZones((zRes.data || []) as unknown as Zone[]);
    setWorkers((wRes.data || []) as WorkerOpt[]);
    setCompanies((cRes.data || []) as CompanyOpt[]);
    setLoading(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (z: Zone) => {
    setEditing(z);
    setForm({
      name: z.name,
      description: z.description || "",
      geometry_type: z.geometry_type,
      center_lat: z.center_lat != null ? String(z.center_lat) : "",
      center_lng: z.center_lng != null ? String(z.center_lng) : "",
      radius_m: z.radius_m != null ? String(z.radius_m) : "30",
      polygon_text: z.geo_polygon
        ? z.geo_polygon.map((p) => `${p.lat},${p.lng}`).join("\n")
        : "",
      banned_worker_ids: z.banned_worker_ids || [],
      banned_company_ids: z.banned_company_ids || [],
      banned_job_types_text: (z.banned_job_types || []).join(", "),
      is_active: z.is_active,
    });
    setDialogOpen(true);
  };

  const parsePolygon = (text: string): { lat: number; lng: number }[] | null => {
    const lines = text
      .split(/[\n;]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 3) return null;
    const pts: { lat: number; lng: number }[] = [];
    for (const line of lines) {
      const parts = line.split(/[,\s]+/).map(Number);
      if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
      pts.push({ lat: parts[0], lng: parts[1] });
    }
    return pts;
  };

  const save = async () => {
    if (!projectId || !form.name.trim()) {
      toast.error("구역 이름을 입력하세요");
      return;
    }
    setSaving(true);
    const jobTypes = form.banned_job_types_text
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: any = {
      project_id: projectId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      geometry_type: form.geometry_type,
      banned_worker_ids: form.banned_worker_ids,
      banned_company_ids: form.banned_company_ids,
      banned_job_types: jobTypes,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };

    if (form.geometry_type === "radius") {
      const lat = Number(form.center_lat);
      const lng = Number(form.center_lng);
      const r = Number(form.radius_m);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(r) || r <= 0) {
        toast.error("중심 좌표와 반경(m)을 올바르게 입력하세요");
        setSaving(false);
        return;
      }
      payload.center_lat = lat;
      payload.center_lng = lng;
      payload.radius_m = r;
      payload.geo_polygon = null;
    } else {
      const poly = parsePolygon(form.polygon_text);
      if (!poly) {
        toast.error("폴리곤은 lat,lng 형식으로 3개 이상 좌표가 필요합니다");
        setSaving(false);
        return;
      }
      payload.geo_polygon = poly;
      payload.center_lat = null;
      payload.center_lng = null;
      payload.radius_m = null;
    }

    let error;
    if (editing) {
      ({ error } = await supabase.from("restricted_zones").update(payload).eq("id", editing.id));
    } else {
      const { data: userData } = await supabase.auth.getUser();
      payload.created_by = userData.user?.id || null;
      ({ error } = await supabase.from("restricted_zones").insert(payload));
    }
    setSaving(false);
    if (error) {
      toast.error("저장 실패: " + error.message);
      return;
    }
    toast.success(editing ? "구역이 수정되었습니다" : "위험 구역이 등록되었습니다");
    setDialogOpen(false);
    loadAll();
  };

  const remove = async (z: Zone) => {
    const result = await softDelete("restricted_zones", z.id, {
      projectId,
      label: `위험구역 "${z.name}"`,
    });
    if (result.ok) loadAll();
  };

  const toggleWorker = (id: string) => {
    setForm((f) => ({
      ...f,
      banned_worker_ids: f.banned_worker_ids.includes(id)
        ? f.banned_worker_ids.filter((x) => x !== id)
        : [...f.banned_worker_ids, id],
    }));
  };

  const toggleCompany = (id: string) => {
    setForm((f) => ({
      ...f,
      banned_company_ids: f.banned_company_ids.includes(id)
        ? f.banned_company_ids.filter((x) => x !== id)
        : [...f.banned_company_ids, id],
    }));
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-destructive" />
            위험/진입금지 구역 (Geofencing)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            GPS 반경·폴리곤 위험구역과 진입 금지 대상(근로자·소속·직종)을 설정합니다.
            금지 대상이 비어 있으면 구역에 진입하는 전원에게 알람이 발동합니다.
            {" "}
            <a href="/georef-map" className="text-primary underline">드론 Georef 관제</a>에서 사진 위 다각형 드로잉도 가능합니다.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="프로젝트 선택" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreate} disabled={!projectId}>
            <Plus className="h-4 w-4 mr-1" /> 구역 추가
          </Button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </div>
      )}

      {!loading && zones.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            등록된 위험 구역이 없습니다. 구역을 추가하세요.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {zones.map((z) => (
          <Card key={z.id} className={!z.is_active ? "opacity-60" : undefined}>
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-destructive" />
                  {z.name}
                  {!z.is_active && <Badge variant="secondary">비활성</Badge>}
                  <Badge variant="outline">
                    {z.geometry_type === "radius"
                      ? `반경 ${z.radius_m}m`
                      : `폴리곤 ${(z.geo_polygon || []).length}점`}
                  </Badge>
                </CardTitle>
                {z.description && (
                  <p className="text-sm text-muted-foreground mt-1">{z.description}</p>
                )}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => openEdit(z)}>편집</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(z)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              {z.geometry_type === "radius" && (
                <div>중심: {z.center_lat}, {z.center_lng}</div>
              )}
              <div>
                금지 근로자 {(z.banned_worker_ids || []).length}명 ·
                소속 {(z.banned_company_ids || []).length} ·
                직종 {(z.banned_job_types || []).length}
                {(z.banned_worker_ids || []).length === 0 &&
                  (z.banned_company_ids || []).length === 0 &&
                  (z.banned_job_types || []).length === 0 && (
                    <span className="text-destructive font-medium"> · 전원 금지</span>
                  )}
              </div>
              {(z.banned_job_types || []).length > 0 && (
                <div>직종: {(z.banned_job_types || []).join(", ")}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "위험 구역 수정" : "위험 구역 추가"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>구역 이름</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 크레인 선회 반경 / 굴착 개구부"
              />
            </div>
            <div className="space-y-1.5">
              <Label>설명</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>지오메트리</Label>
              <Select
                value={form.geometry_type}
                onValueChange={(v: "polygon" | "radius") => setForm({ ...form, geometry_type: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="radius">원형 반경 (위도/경도 + m)</SelectItem>
                  <SelectItem value="polygon">폴리곤 (lat,lng 목록)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.geometry_type === "radius" ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>위도</Label>
                  <Input
                    value={form.center_lat}
                    onChange={(e) => setForm({ ...form, center_lat: e.target.value })}
                    placeholder="37.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label>경도</Label>
                  <Input
                    value={form.center_lng}
                    onChange={(e) => setForm({ ...form, center_lng: e.target.value })}
                    placeholder="127.0"
                  />
                </div>
                <div className="space-y-1">
                  <Label>반경(m)</Label>
                  <Input
                    value={form.radius_m}
                    onChange={(e) => setForm({ ...form, radius_m: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>폴리곤 좌표 (한 줄에 lat,lng)</Label>
                <Textarea
                  value={form.polygon_text}
                  onChange={(e) => setForm({ ...form, polygon_text: e.target.value })}
                  rows={5}
                  placeholder={"37.5665,126.9780\n37.5666,126.9785\n37.5660,126.9784"}
                  className="font-mono text-xs"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>진입 금지 소속사 (다중 선택)</Label>
              <div className="max-h-28 overflow-auto border rounded-md p-2 space-y-1">
                {companies.length === 0 && (
                  <div className="text-xs text-muted-foreground">소속사 없음</div>
                )}
                {companies.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.banned_company_ids.includes(c.id)}
                      onChange={() => toggleCompany(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>진입 금지 근로자</Label>
              <div className="max-h-36 overflow-auto border rounded-md p-2 space-y-1">
                {workers.length === 0 && (
                  <div className="text-xs text-muted-foreground">근로자 없음</div>
                )}
                {workers.map((w) => (
                  <label key={w.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.banned_worker_ids.includes(w.id)}
                      onChange={() => toggleWorker(w.id)}
                    />
                    <span>
                      {w.name}
                      <span className="text-muted-foreground text-xs ml-1">
                        {w.company_name}
                        {w.job_type ? ` · ${w.job_type}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>진입 금지 직종 (쉼표 구분)</Label>
              <Input
                value={form.banned_job_types_text}
                onChange={(e) => setForm({ ...form, banned_job_types_text: e.target.value })}
                placeholder={jobTypeOptions.slice(0, 3).join(", ") || "예: 철근공, 신호수"}
                list="job-type-suggestions"
              />
              <datalist id="job-type-suggestions">
                {jobTypeOptions.map((j) => (
                  <option key={j} value={j} />
                ))}
              </datalist>
            </div>

            <div className="flex items-center justify-between">
              <Label>활성</Label>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
