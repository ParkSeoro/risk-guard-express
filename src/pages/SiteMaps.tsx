import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { Map, Plus, Trash2, Upload, QrCode, Check, X } from "lucide-react";
import { toast } from "sonner";

type SiteMap = {
  id: string; name: string; image_url: string | null; project_id: string;
  geo_anchor_nw_lat?: number | null; geo_anchor_nw_lng?: number | null;
  geo_anchor_se_lat?: number | null; geo_anchor_se_lng?: number | null;
};
type Zone = {
  id: string;
  site_map_id: string;
  project_id: string;
  name: string;
  zone_type: "normal" | "work" | "restricted" | "danger";
  color: string | null;
  polygon: { x: number; y: number }[]; // normalized 0..1
  description: string | null;
};
type Qr = { id: string; zone_id: string; code: string; label: string | null; direction: "entry" | "exit"; is_active: boolean };

const ZONE_COLOR: Record<Zone["zone_type"], string> = {
  normal: "#10b981",
  work: "#3b82f6",
  restricted: "#f59e0b",
  danger: "#ef4444",
};
const ZONE_LABEL: Record<Zone["zone_type"], string> = {
  normal: "일반",
  work: "작업구역",
  restricted: "제한구역",
  danger: "위험구역",
};

export default function SiteMaps() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [maps, setMaps] = useState<SiteMap[]>([]);
  const [activeMap, setActiveMap] = useState<SiteMap | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [qrCodes, setQrCodes] = useState<Qr[]>([]);
  const [qrDialog, setQrDialog] = useState<Qr | null>(null);

  // editor state
  const [drafting, setDrafting] = useState(false);
  const [draftPts, setDraftPts] = useState<{ x: number; y: number }[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<Zone["zone_type"]>("danger");

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    loadMaps();
  }, [projectId]);

  const loadMaps = async () => {
    const { data } = await supabase
      .from("site_maps")
      .select("id,name,image_url,project_id,geo_anchor_nw_lat,geo_anchor_nw_lng,geo_anchor_se_lat,geo_anchor_se_lng")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    setMaps((data || []) as SiteMap[]);
    if (data && data.length && !activeMap) setActiveMap(data[0] as SiteMap);
  };

  useEffect(() => {
    if (!activeMap) { setZones([]); setQrCodes([]); return; }
    loadZones();
  }, [activeMap?.id]);

  const loadZones = async () => {
    if (!activeMap) return;
    const { data: zs } = await supabase
      .from("site_zones")
      .select("*")
      .eq("site_map_id", activeMap.id)
      .eq("is_deleted", false)
      .order("created_at");
    setZones((zs || []) as any);
    const zoneIds = (zs || []).map((z: any) => z.id);
    if (zoneIds.length) {
      const { data: qs } = await supabase
        .from("zone_qr_codes")
        .select("*")
        .in("zone_id", zoneIds);
      setQrCodes((qs || []) as any);
    } else setQrCodes([]);
  };

  // upload site map image
  const onUpload = async (file: File) => {
    if (!projectId) { toast.error("프로젝트를 선택하세요"); return; }
    const ext = file.name.split(".").pop() || "png";
    const path = `site-maps/${projectId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
    if (upErr) { toast.error("업로드 실패: " + upErr.message); return; }
    const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
    const name = prompt("사이트맵 이름", "본관 1층 평면도") || "신규 사이트맵";
    const { data, error } = await supabase
      .from("site_maps")
      .insert({ project_id: projectId, name, image_url: pub.publicUrl })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    toast.success("사이트맵 등록 완료");
    setActiveMap(data as any);
    loadMaps();
  };

  const onImgLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    setImgBox({ w: el.clientWidth, h: el.clientHeight });
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drafting || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDraftPts((p) => [...p, { x, y }]);
  };

  const finishDraft = async () => {
    if (!activeMap || draftPts.length < 3) { toast.error("3개 이상의 점이 필요합니다"); return; }
    if (!draftName.trim()) { toast.error("구역 이름을 입력하세요"); return; }
    // If the map has geo anchors, project the normalized polygon to lat/lng so
    // GPS geofencing can use it on the server.
    let geo_polygon: { lat: number; lng: number }[] | null = null;
    if (
      activeMap.geo_anchor_nw_lat != null && activeMap.geo_anchor_nw_lng != null &&
      activeMap.geo_anchor_se_lat != null && activeMap.geo_anchor_se_lng != null
    ) {
      const { projectPolygonToGeo } = await import("@/lib/tracking/geofence");
      geo_polygon = projectPolygonToGeo(draftPts, {
        nw_lat: activeMap.geo_anchor_nw_lat, nw_lng: activeMap.geo_anchor_nw_lng,
        se_lat: activeMap.geo_anchor_se_lat, se_lng: activeMap.geo_anchor_se_lng,
      });
    }
    const { error } = await supabase.from("site_zones").insert({
      site_map_id: activeMap.id,
      project_id: activeMap.project_id,
      name: draftName.trim(),
      zone_type: draftType,
      color: ZONE_COLOR[draftType],
      polygon: draftPts as any,
      geo_polygon: geo_polygon as any,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(geo_polygon ? "구역 추가 완료 (GPS 지오펜스 활성)" : "구역 추가 완료 — 지도 좌표가 미설정이라 GPS 추적은 비활성");
    setDrafting(false);
    setDraftPts([]);
    setDraftName("");
    loadZones();
  };

  const saveAnchors = async (m: SiteMap) => {
    const nw_lat = Number(prompt("북서(좌상단) 위도 (예: 37.5665)", String(m.geo_anchor_nw_lat ?? ""))?.trim());
    const nw_lng = Number(prompt("북서(좌상단) 경도 (예: 126.9780)", String(m.geo_anchor_nw_lng ?? ""))?.trim());
    const se_lat = Number(prompt("남동(우하단) 위도", String(m.geo_anchor_se_lat ?? ""))?.trim());
    const se_lng = Number(prompt("남동(우하단) 경도", String(m.geo_anchor_se_lng ?? ""))?.trim());
    if ([nw_lat, nw_lng, se_lat, se_lng].some((n) => !Number.isFinite(n))) {
      toast.error("위경도 4개를 모두 입력해야 합니다"); return;
    }
    const { error } = await supabase.from("site_maps").update({
      geo_anchor_nw_lat: nw_lat, geo_anchor_nw_lng: nw_lng,
      geo_anchor_se_lat: se_lat, geo_anchor_se_lng: se_lng,
    }).eq("id", m.id);
    if (error) { toast.error(error.message); return; }
    toast.success("지도 좌표 저장됨. 이후 그리는 구역부터 GPS 지오펜스가 적용됩니다.");
    loadMaps();
  };


  const deleteZone = async (z: Zone) => {
    if (!confirm(`'${z.name}' 구역을 삭제할까요?`)) return;
    await supabase.from("site_zones").update({ is_deleted: true }).eq("id", z.id);
    if (selectedZone?.id === z.id) setSelectedZone(null);
    loadZones();
  };

  const addQr = async (zone: Zone, direction: "entry" | "exit") => {
    const code = `z_${zone.id.slice(0, 8)}_${direction}_${Date.now().toString(36)}`;
    const { data, error } = await supabase
      .from("zone_qr_codes")
      .insert({ zone_id: zone.id, project_id: zone.project_id ?? activeMap?.project_id, code, label: `${zone.name} ${direction === "entry" ? "입구" : "출구"}`, direction })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    toast.success("QR 생성 완료");
    setQrDialog(data as any);
    loadZones();
  };

  const toggleQr = async (q: Qr) => {
    await supabase.from("zone_qr_codes").update({ is_active: !q.is_active }).eq("id", q.id);
    loadZones();
  };

  const pointsAttr = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${(p.x * imgBox.w).toFixed(1)},${(p.y * imgBox.h).toFixed(1)}`).join(" ");

  const zonesByMap = useMemo(() => zones, [zones]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Map className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">현장 사이트맵 / 구역 관리</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Label className="cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
            <span className="inline-flex items-center gap-1 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">
              <Upload className="h-4 w-4" /> 사이트맵 업로드
            </span>
          </Label>
        </div>
      </div>

      {maps.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {maps.map(m => (
            <Button key={m.id} size="sm" variant={activeMap?.id === m.id ? "default" : "outline"} onClick={() => setActiveMap(m)}>
              {m.name}
            </Button>
          ))}
        </div>
      )}

      {!activeMap && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          사이트맵을 업로드해 시작하세요. (평면도 이미지 PNG/JPG)
        </CardContent></Card>
      )}

      {activeMap && (
        <div className="grid md:grid-cols-[1fr_320px] gap-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">{activeMap.name}</CardTitle>
              <div className="flex gap-2">
                {!drafting ? (
                  <Button size="sm" onClick={() => { setDrafting(true); setDraftPts([]); }}>
                    <Plus className="h-4 w-4 mr-1" /> 구역 그리기
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setDrafting(false); setDraftPts([]); }}>
                      <X className="h-4 w-4 mr-1" /> 취소
                    </Button>
                    <Button size="sm" onClick={finishDraft}>
                      <Check className="h-4 w-4 mr-1" /> 완료 ({draftPts.length}점)
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {drafting && (
                <div className="mb-3 grid grid-cols-[1fr_180px] gap-2 p-3 bg-muted/40 rounded">
                  <Input placeholder="구역 이름 (예: 고소작업장)" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                  <Select value={draftType} onValueChange={(v: any) => setDraftType(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["danger", "restricted", "work", "normal"] as const).map(t => (
                        <SelectItem key={t} value={t}>{ZONE_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="col-span-2 text-xs text-muted-foreground">이미지 위를 클릭해 폴리곤 꼭지점을 추가하세요 (3점 이상). 완료를 누르면 저장됩니다.</p>
                </div>
              )}
              <div className="relative inline-block w-full">
                {activeMap.image_url ? (
                  <>
                    <img
                      ref={imgRef}
                      src={activeMap.image_url}
                      onLoad={onImgLoad}
                      className="w-full h-auto block select-none"
                      alt={activeMap.name}
                    />
                    <svg
                      className="absolute inset-0 w-full h-full"
                      style={{ cursor: drafting ? "crosshair" : "default" }}
                      onClick={onSvgClick}
                    >
                      {zonesByMap.map((z) => (
                        <g key={z.id} onClick={(e) => { e.stopPropagation(); setSelectedZone(z); }} style={{ cursor: "pointer" }}>
                          <polygon
                            points={pointsAttr(z.polygon)}
                            fill={(z.color || ZONE_COLOR[z.zone_type]) + (selectedZone?.id === z.id ? "80" : "40")}
                            stroke={z.color || ZONE_COLOR[z.zone_type]}
                            strokeWidth={selectedZone?.id === z.id ? 3 : 2}
                          />
                          {z.polygon[0] && (
                            <text
                              x={z.polygon[0].x * imgBox.w}
                              y={z.polygon[0].y * imgBox.h - 4}
                              fontSize="12"
                              fontWeight="bold"
                              fill={z.color || ZONE_COLOR[z.zone_type]}
                              stroke="white"
                              strokeWidth="0.5"
                            >{z.name}</text>
                          )}
                        </g>
                      ))}
                      {drafting && draftPts.length > 0 && (
                        <>
                          <polyline
                            points={pointsAttr(draftPts)}
                            fill={ZONE_COLOR[draftType] + "33"}
                            stroke={ZONE_COLOR[draftType]}
                            strokeWidth="2"
                            strokeDasharray="4 3"
                          />
                          {draftPts.map((p, i) => (
                            <circle key={i} cx={p.x * imgBox.w} cy={p.y * imgBox.h} r="4" fill={ZONE_COLOR[draftType]} />
                          ))}
                        </>
                      )}
                    </svg>
                  </>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">이미지가 없습니다</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">구역 ({zones.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {zones.length === 0 && <div className="text-sm text-muted-foreground">아직 등록된 구역이 없습니다.</div>}
              {zones.map(z => {
                const zoneQrs = qrCodes.filter(q => q.zone_id === z.id);
                return (
                  <div key={z.id} className={`border rounded p-2 space-y-2 ${selectedZone?.id === z.id ? "border-primary" : ""}`}>
                    <div className="flex items-center justify-between">
                      <button className="text-left flex-1" onClick={() => setSelectedZone(z)}>
                        <div className="font-medium text-sm">{z.name}</div>
                        <Badge variant="outline" style={{ color: z.color || ZONE_COLOR[z.zone_type], borderColor: z.color || ZONE_COLOR[z.zone_type] }}>
                          {ZONE_LABEL[z.zone_type]}
                        </Badge>
                      </button>
                      <Button size="icon" variant="ghost" onClick={() => deleteZone(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addQr(z, "entry")}>
                        <QrCode className="h-3 w-3 mr-1" /> 입구 QR
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addQr(z, "exit")}>
                        <QrCode className="h-3 w-3 mr-1" /> 출구 QR
                      </Button>
                    </div>
                    {zoneQrs.length > 0 && (
                      <div className="space-y-1 pt-1 border-t">
                        {zoneQrs.map(q => (
                          <div key={q.id} className="flex items-center justify-between text-xs">
                            <button className="truncate text-left flex-1 hover:underline" onClick={() => setQrDialog(q)}>
                              {q.direction === "entry" ? "🟢 입구" : "🔴 출구"} · {q.code.slice(-10)}
                            </button>
                            <button onClick={() => toggleQr(q)} className={q.is_active ? "text-success" : "text-muted-foreground"}>
                              {q.is_active ? "활성" : "비활성"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={!!qrDialog} onOpenChange={(o) => !o && setQrDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>구역 QR 코드</DialogTitle></DialogHeader>
          {qrDialog && (
            <div className="space-y-3 text-center">
              <div className="bg-white p-4 rounded inline-block">
                <QRCodeSVG value={`${window.location.origin}/z/${qrDialog.code}`} size={220} />
              </div>
              <div className="text-sm">{qrDialog.label}</div>
              <div className="text-xs text-muted-foreground break-all">{window.location.origin}/z/{qrDialog.code}</div>
              <p className="text-xs text-muted-foreground">현장 입구·출구에 인쇄·부착하세요. 근로자가 PWA로 스캔하면 입퇴장이 자동 기록되고, 위험/제한구역은 경고가 발송됩니다.</p>
              <Button onClick={() => window.print()} variant="outline" className="w-full">인쇄</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
