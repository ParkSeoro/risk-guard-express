import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CloudSun, Loader2, AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

type Props = { projectId: string };

export default function MobileWeatherCard({ projectId }: Props) {
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState<any>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) {
        setLoading(false);
        setError("프로젝트 미선택");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data: project } = await supabase
          .from("projects")
          .select("site_lat, site_lng, site_address")
          .eq("id", projectId)
          .maybeSingle();
        const lat = (project as any)?.site_lat ?? 37.5665;
        const lng = (project as any)?.site_lng ?? 126.978;
        const address = (project as any)?.site_address || "";
        const { data, error: fnErr } = await supabase.functions.invoke("fetch-weather", {
          body: { project_id: projectId, lat, lng, address },
        });
        if (cancelled) return;
        if (fnErr) {
          setError("날씨 조회 실패");
          setWeather(null);
        } else {
          setWeather(data);
          setFetchedAt(new Date().toISOString());
        }
      } catch {
        if (!cancelled) setError("날씨 조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const current = weather?.current || weather?.now || weather;
  const temp = current?.temp ?? current?.temperature ?? current?.temp_c;
  const wind = current?.wind_speed ?? current?.wind ?? current?.wsd;
  const desc =
    current?.description || current?.sky || weather?.description || weather?.summary || "";
  const alert =
    weather?.alerts?.[0]?.title ||
    (typeof wind === "number" && wind >= 10 ? "강풍 주의" : null);

  const ageMin = fetchedAt
    ? Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60000)
    : null;
  const stale = ageMin != null && ageMin > 30;

  return (
    <Link to="/app/worker/site-weather" className="block" data-testid="mobile-weather-card">
    <Card className="border-sky-200/60 bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/40 dark:to-background active:scale-[0.99] transition">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-sky-100 dark:bg-sky-900/50 flex items-center justify-center shrink-0">
            <CloudSun className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">오늘 현장 날씨</div>
            {loading ? (
              <div className="flex items-center gap-2 text-sm mt-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중…
              </div>
            ) : error ? (
              <div className="text-sm text-muted-foreground mt-1">{error}</div>
            ) : (
              <>
                <div className="font-semibold text-sm mt-0.5 whitespace-normal break-words">
                  {temp != null ? `${Math.round(Number(temp))}°` : "—"}
                  {desc ? ` · ${desc}` : ""}
                  {wind != null ? ` · 풍속 ${Number(wind).toFixed(1)}m/s` : ""}
                </div>
                {alert && (
                  <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 mt-1 whitespace-normal">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {alert}
                  </div>
                )}
                {stale && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    갱신 지연 · {ageMin}분 전
                  </div>
                )}
              </>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
    </Link>
  );
}
