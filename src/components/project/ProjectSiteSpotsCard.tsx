import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Trash2 } from "lucide-react";
import { toAdminUrl } from "@/lib/adminNav";
import { type ProjectSiteSpotRow } from "@/lib/tracking/siteTrackBounds";

export default function ProjectSiteSpotsCard({
  projectId,
  canEdit,
  onToast,
}: {
  projectId: string;
  pinLat?: number | null;
  pinLng?: number | null;
  canEdit: boolean;
  onToast: (opts: { title: string; description?: string; variant?: "destructive" }) => void;
}) {
  const [spots, setSpots] = useState<ProjectSiteSpotRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_site_spots" as any)
      .select("id, project_id, name, center_lat, center_lng, radius_m, sort_order")
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) {
      setSpots([]);
    } else {
      setSpots((data || []) as ProjectSiteSpotRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!projectId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("project_site_spots" as any)
      .update({ is_deleted: true, is_active: false })
      .eq("id", id);
    if (error) {
      onToast({ title: "개소 삭제 실패", description: error.message, variant: "destructive" });
      return;
    }
    await load();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          GPS 개소
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          한 프로젝트에 현장이 여러 곳일 때 씁니다. 그리기는 관제맵에서 하고, 여기서는 목록만 봅니다.
          개소가 있으면 주소핀·단일 테두리 대신 개소 합집합으로 출퇴근합니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">불러오는 중…</p>
        ) : spots.length === 0 ? (
          <p className="text-xs text-muted-foreground">등록된 개소가 없습니다. 관제맵 [2] GPS 개소에서 그리세요.</p>
        ) : (
          <div className="space-y-2">
            {spots.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-2 rounded-md border p-2">
                <div className="text-sm min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {Number(s.center_lat).toFixed(5)}, {Number(s.center_lng).toFixed(5)}
                  </div>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive shrink-0"
                    onClick={() => void handleDelete(s.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <Button asChild size="sm" className="w-full text-xs">
            <Link to={toAdminUrl("/site-control-map")}>관제맵에서 개소 그리기</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
