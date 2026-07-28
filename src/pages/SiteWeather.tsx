import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cloud, CloudRain, CloudSnow, Sun, Wind, Thermometer, Droplets,
  AlertTriangle, CheckCircle2, RefreshCw, MapPin, Eye, Snowflake,
  CloudLightning, CloudFog, CloudDrizzle, Star, StarOff, Gauge,
  ArrowDown, ArrowUp, ShieldAlert, Navigation, ExternalLink, Radio
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ResolvedLocation {
  lat: number;
  lng: number;
  city: string;
  address: string;
}

interface WeatherData {
  current: {
    temp: number; feels_like: number; humidity: number;
    wind_speed: number; wind_deg: number; wind_gust: number;
    description: string; icon: string; main: string;
    rain_1h: number; snow_1h: number; visibility: number;
    clouds: number; pressure: number; dt: number; city: string;
    sunrise: number; sunset: number; lat: number; lng: number;
  };
  hourly: {
    dt: number; temp: number; feels_like: number; humidity: number;
    wind_speed: number; wind_gust: number; rain: number; snow: number;
    description: string; icon: string; main: string; pop: number;
  }[];
  daily: {
    date: string; temp_min: number; temp_max: number; wind_max: number;
    wind_gust_max: number; rain_total: number; snow_total: number;
    pop_max: number; icon: string; main: string; description: string;
  }[];
  alerts: { level: string; title: string; description: string; icon: string; category: string }[];
  typhoon: { risk: string; message: string; pressure: number; wind_speed: number; wind_gust: number };
  source: string;
  source_label: string;
  resolved_location?: ResolvedLocation;
  fetched_at: string;
}

const WEATHER_ICONS: Record<string, React.ReactNode> = {
  Clear: <Sun className="h-8 w-8 text-amber-400" />,
  Clouds: <Cloud className="h-8 w-8 text-slate-400" />,
  Rain: <CloudRain className="h-8 w-8 text-blue-400" />,
  Drizzle: <CloudDrizzle className="h-8 w-8 text-blue-300" />,
  Thunderstorm: <CloudLightning className="h-8 w-8 text-purple-400" />,
  Snow: <CloudSnow className="h-8 w-8 text-sky-200" />,
  Mist: <CloudFog className="h-8 w-8 text-slate-300" />,
  Fog: <CloudFog className="h-8 w-8 text-slate-300" />,
  Haze: <CloudFog className="h-8 w-8 text-slate-300" />,
};

const SMALL_ICONS: Record<string, React.ReactNode> = {
  Clear: <Sun className="h-5 w-5 text-amber-400" />,
  Clouds: <Cloud className="h-5 w-5 text-slate-400" />,
  Rain: <CloudRain className="h-5 w-5 text-blue-400" />,
  Drizzle: <CloudDrizzle className="h-5 w-5 text-blue-300" />,
  Thunderstorm: <CloudLightning className="h-5 w-5 text-purple-400" />,
  Snow: <CloudSnow className="h-5 w-5 text-sky-200" />,
  Mist: <CloudFog className="h-5 w-5 text-slate-300" />,
  Fog: <CloudFog className="h-5 w-5 text-slate-300" />,
  Haze: <CloudFog className="h-5 w-5 text-slate-300" />,
};

function getAlertColor(level: string) {
  switch (level) {
    case "danger": return "bg-destructive/10 border-destructive text-destructive";
    case "warning": return "bg-warning/10 border-warning text-warning";
    case "caution": return "bg-amber-500/10 border-amber-500 text-amber-600";
    case "safe": return "bg-success/10 border-success text-success";
    default: return "bg-muted border-border text-muted-foreground";
  }
}

function getAlertBadge(level: string) {
  switch (level) {
    case "danger": return <Badge variant="destructive" className="text-[10px]">위험</Badge>;
    case "warning": return <Badge className="bg-warning text-warning-foreground text-[10px]">주의</Badge>;
    case "caution": return <Badge className="bg-amber-500 text-white text-[10px]">참고</Badge>;
    case "safe": return <Badge className="bg-success text-success-foreground text-[10px]">안전</Badge>;
    default: return null;
  }
}

function getAlertIcon(iconType: string) {
  switch (iconType) {
    case "wind": return <Wind className="h-5 w-5" />;
    case "thermometer": return <Thermometer className="h-5 w-5" />;
    case "rain": return <CloudRain className="h-5 w-5" />;
    case "snowflake": return <Snowflake className="h-5 w-5" />;
    case "check": return <CheckCircle2 className="h-5 w-5" />;
    case "fog": return <CloudFog className="h-5 w-5" />;
    case "lightning": return <CloudLightning className="h-5 w-5" />;
    case "typhoon": return <Navigation className="h-5 w-5" />;
    default: return <AlertTriangle className="h-5 w-5" />;
  }
}

function windDirection(deg: number) {
  const dirs = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  return dirs[Math.round(deg / 45) % 8];
}

function formatTime(dt: number) {
  return new Date(dt * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function formatSunTime(dt: number) {
  if (!dt) return "--:--";
  return new Date(dt * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

const FAVORITES_KEY = "weather-favorites";

function getFavorites(): { name: string; lat: number; lng: number }[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); } catch { return []; }
}
function saveFavorites(favs: { name: string; lat: number; lng: number }[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

const SiteWeather = () => {
  const { projects, selectedProject } = useGlobalProjectAccess();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualAddress, setManualAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [favorites, setFavorites] = useState(getFavorites());
  const [errorMsg, setErrorMsg] = useState("");
  const [activeSource, setActiveSource] = useState<"kma" | "openweather">("kma");
  const [owWeather, setOwWeather] = useState<WeatherData | null>(null);
  const [owLoading, setOwLoading] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [geocodeError, setGeocodeError] = useState("");

  const currentProject = projects.find((p) => p.id === selectedProject);

  const fetchWeather = useCallback(async (overrideLat?: number, overrideLng?: number, source?: string) => {
    if (!selectedProject) return;
    if (!source) {
      setLoading(true);
    }
    setErrorMsg("");

    try {
      const { data: project } = await supabase
        .from("projects")
        .select("site_address, site_lat, site_lng")
        .eq("id", selectedProject)
        .single();

      const lat = overrideLat || (project as any)?.site_lat;
      const lng = overrideLng || (project as any)?.site_lng;
      const address = (project as any)?.site_address || "";

      const { data, error } = await supabase.functions.invoke("fetch-weather", {
        body: {
          project_id: selectedProject,
          lat, lng,
          address: (!lat && !lng) ? address : undefined,
          source: source || "kma",
        },
      });

      // Prefer JSON error body over generic FunctionsHttpError message
      let detail = "";
      if (data?.error) detail = typeof data.error === "string" ? data.error : data.error.message || "";
      if (!detail && error) {
        const ctx = (error as { context?: Response })?.context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.clone().json();
            detail = body?.error || body?.message || "";
          } catch { /* ignore */ }
        }
        if (!detail) detail = error.message || "";
      }
      if (/non-2xx/i.test(detail)) {
        detail = "날씨 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      }
      if (detail) {
        setErrorMsg(detail);
        if (!source) {
          toast({ title: "날씨 데이터 로드 실패", description: detail, variant: "destructive" });
        }
        return;
      }

      if (source === "openweather") {
        setOwWeather(data);
        setOwLoading(false);
      } else {
        setWeather(data);
      }
    } catch (err: any) {
      console.error("Weather fetch error:", err);
      if (!source) {
        const msg = /non-2xx/i.test(err?.message || "")
          ? "날씨 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
          : (err?.message || "날씨 데이터 로드 실패");
        setErrorMsg(msg);
        toast({ title: "날씨 데이터 로드 실패", description: msg, variant: "destructive" });
      }
    } finally {
      if (!source) setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  const handleLoadOW = () => {
    setOwLoading(true);
    setActiveSource("openweather");
    fetchWeather(undefined, undefined, "openweather");
  };

  const handleSaveAddress = async () => {
    if (!selectedProject || !manualAddress.trim()) return;
    setGeocodeError("");
    setAddressSuggestions([]);
    try {
      const { data: geoData } = await supabase.functions.invoke("fetch-weather", {
        body: { project_id: '__geocode__', address: manualAddress.trim(), geocode_only: true },
      });
      
      if (geoData?.error) {
        setGeocodeError(geoData.message || geoData.error);
        if (geoData.suggestions) {
          setAddressSuggestions(geoData.suggestions);
        }
        return;
      }

      const updateData: any = { site_address: manualAddress.trim() };
      if (geoData?.lat && geoData?.lng) {
        updateData.site_lat = geoData.lat;
        updateData.site_lng = geoData.lng;
      } else {
        updateData.site_lat = null;
        updateData.site_lng = null;
      }
      
      await supabase.from("projects").update(updateData).eq("id", selectedProject);
      toast({ title: "주소 저장 완료", description: geoData?.lat ? `좌표: ${geoData.lat.toFixed(4)}, ${geoData.lng.toFixed(4)}` : "좌표 변환 실패 — 수동 확인 필요" });
      setEditingAddress(false);
      setGeocodeError("");
      setAddressSuggestions([]);
      fetchWeather();
    } catch (err: any) {
      toast({ title: "저장 실패", description: err.message, variant: "destructive" });
    }
  };

  const toggleFavorite = () => {
    if (!weather?.current || !currentProject) return;
    const existing = favorites.find(f => f.name === currentProject.site_name);
    let newFavs;
    if (existing) {
      newFavs = favorites.filter(f => f.name !== currentProject.site_name);
    } else {
      newFavs = [...favorites, { name: currentProject.site_name, lat: weather.current.lat, lng: weather.current.lng }];
    }
    setFavorites(newFavs);
    saveFavorites(newFavs);
    toast({ title: existing ? "즐겨찾기 해제" : "즐겨찾기 추가" });
  };

  const isFavorite = currentProject && favorites.some(f => f.name === currentProject.site_name);

  // Get the active weather data based on selected source
  const displayWeather = activeSource === "openweather" && owWeather ? owWeather : weather;

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">현장 일기예보</h1>
            <p className="text-sm text-muted-foreground mt-1">날씨 데이터 로딩 중...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">현장 일기예보</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {weather?.resolved_location?.city
              ? `${weather.resolved_location.city} (프로젝트 기준)`
              : currentProject ? currentProject.site_name : "프로젝트 선택 필요"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Data Source Toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-0.5">
            <Button
              variant={activeSource === "kma" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={() => setActiveSource("kma")}
            >
              🇰🇷 기상청
            </Button>
            <Button
              variant={activeSource === "openweather" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={handleLoadOW}
              disabled={owLoading}
            >
              {owLoading ? "로딩..." : "🌐 OpenWeather (보조)"}
            </Button>
          </div>
          {displayWeather?.fetched_at && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(displayWeather.fetched_at).toLocaleTimeString("ko-KR")} 기준
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFavorite} title="즐겨찾기">
            {isFavorite ? <Star className="h-4 w-4 text-amber-400 fill-amber-400" /> : <StarOff className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setActiveSource("kma"); fetchWeather(); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Source indicator */}
      {displayWeather?.source_label && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            데이터 소스: {displayWeather.source_label}
          </Badge>
          {activeSource === "openweather" && (
            <span className="text-[10px] text-muted-foreground">
              ⚠️ 보조 데이터입니다. 기상청 데이터가 기본(Primary)입니다.
            </span>
          )}
        </div>
      )}

      {/* Location & Address */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          {weather?.resolved_location && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">📍 {weather.resolved_location.city || '위치 확인'}</span>
                  <Badge variant="outline" className="text-[10px]">프로젝트 기준</Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>위도: {weather.resolved_location.lat.toFixed(4)}</span>
                  <span>경도: {weather.resolved_location.lng.toFixed(4)}</span>
                </div>
                <a
                  href={`https://map.naver.com/p/search/${weather.resolved_location.lat},${weather.resolved_location.lng}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> 네이버 지도에서 위치 확인
                </a>
              </div>
            </div>
          )}

          {!weather?.resolved_location?.city && currentProject && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-warning">현장 주소 미설정</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  프로젝트 관리 → 수정에서 현장주소를 입력하면 자동으로 해당 지역의 날씨를 불러옵니다.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
          {editingAddress ? (
              <div className="space-y-2 flex-1 min-w-[300px]">
                <div className="flex gap-2">
                  <Input
                    placeholder="현장 주소 입력 (예: 여수시, 평택시 고덕면)"
                    value={manualAddress}
                    onChange={(e) => setManualAddress(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveAddress()}
                  />
                  <Button size="sm" onClick={handleSaveAddress}>저장</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingAddress(false); setGeocodeError(""); setAddressSuggestions([]); }}>취소</Button>
                </div>
                {geocodeError && (
                  <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30">
                    <p className="text-xs text-destructive">{geocodeError}</p>
                  </div>
                )}
                {addressSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-xs text-muted-foreground">추천:</span>
                    {addressSuggestions.map((s) => (
                      <Button key={s} variant="outline" size="sm" className="text-xs h-6 px-2"
                        onClick={() => { setManualAddress(s); setAddressSuggestions([]); setGeocodeError(""); }}>
                        {s}
                      </Button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  💡 주소 변환 실패 시 도시명만 입력하세요 (예: 여수, 울산, 평택)
                </p>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditingAddress(true)}>
                <MapPin className="h-3 w-3 mr-1" /> 위치 변경
              </Button>
            )}
            {favorites.length > 0 && !editingAddress && (
              <div className="flex gap-1 flex-wrap">
                {favorites.map(f => (
                  <Button key={f.name} variant="outline" size="sm" className="text-xs h-7 gap-1"
                    onClick={() => fetchWeather(f.lat, f.lng)}>
                    <Star className="h-3 w-3 text-amber-400 fill-amber-400" /> {f.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {errorMsg && (
        <Card className="border-destructive">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive font-medium">{errorMsg}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchWeather()}>다시 시도</Button>
          </CardContent>
        </Card>
      )}

      {!displayWeather && !errorMsg ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">날씨 데이터를 불러올 수 없습니다.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchWeather()}>다시 시도</Button>
          </CardContent>
        </Card>
      ) : displayWeather && (
        <>
          {/* Safety Alerts Banner */}
          {displayWeather.alerts.length > 0 && (
            <div className="space-y-2">
              {displayWeather.alerts.map((alert, i) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${getAlertColor(alert.level)}`}>
                  {getAlertIcon(alert.icon)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{alert.title}</span>
                      {getAlertBadge(alert.level)}
                    </div>
                    <p className="text-xs mt-0.5 opacity-80">{alert.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Typhoon Info - Always Visible */}
          <Card className={`border-2 ${
            displayWeather.typhoon?.risk === "danger" ? "border-destructive bg-destructive/5" :
            displayWeather.typhoon?.risk === "warning" ? "border-warning bg-warning/5" :
            displayWeather.typhoon?.risk === "caution" ? "border-amber-500 bg-amber-500/5" :
            "border-border"
          }`}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                  displayWeather.typhoon?.risk === "danger" ? "bg-destructive/20" :
                  displayWeather.typhoon?.risk === "warning" ? "bg-warning/20" :
                  displayWeather.typhoon?.risk === "caution" ? "bg-amber-500/20" :
                  "bg-muted"
                }`}>
                  <Navigation className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base">🌀 태풍 정보</span>
                    {displayWeather.typhoon?.risk !== "none"
                      ? getAlertBadge(displayWeather.typhoon.risk)
                      : <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success">태풍 없음</Badge>
                    }
                  </div>
                  <p className="text-sm mt-1">
                    {displayWeather.typhoon?.risk !== "none" && displayWeather.typhoon?.message
                      ? displayWeather.typhoon.message
                      : "현재 한반도 인근에 태풍이 관측되지 않았습니다."}
                  </p>
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>기압: {displayWeather.typhoon?.pressure || displayWeather.current.pressure || '-'}hPa</span>
                    <span>풍속: {displayWeather.typhoon?.wind_speed || displayWeather.current.wind_speed}m/s</span>
                    {(displayWeather.typhoon?.wind_gust || 0) > 0 && <span>순간풍속: {displayWeather.typhoon.wind_gust}m/s</span>}
                  </div>
                  {displayWeather.typhoon?.risk === "danger" && (
                    <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/30">
                      <span className="text-xs font-bold text-destructive">🚫 작업 중지 권고 — 즉시 안전 대피 필요</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Current Weather + Wind */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">현재 날씨</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    {WEATHER_ICONS[displayWeather.current.main] || <Cloud className="h-8 w-8 text-slate-400" />}
                    <p className="text-xs text-muted-foreground mt-1">{displayWeather.current.description}</p>
                  </div>
                  <div>
                    <p className="text-5xl font-bold">{displayWeather.current.temp}°</p>
                    <p className="text-sm text-muted-foreground">체감 {displayWeather.current.feels_like}°C</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm ml-auto">
                    <div className="flex items-center gap-1.5">
                      <Wind className="h-4 w-4 text-muted-foreground" />
                      <span>{displayWeather.current.wind_speed}m/s {windDirection(displayWeather.current.wind_deg)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Droplets className="h-4 w-4 text-muted-foreground" />
                      <span>습도 {displayWeather.current.humidity}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <span>시정 {(displayWeather.current.visibility / 1000).toFixed(1)}km</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      <span>기압 {displayWeather.current.pressure || '-'}hPa</span>
                    </div>
                    {displayWeather.current.wind_gust > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Wind className="h-4 w-4 text-warning" />
                        <span className="text-warning">순간 {displayWeather.current.wind_gust}m/s</span>
                      </div>
                    )}
                    {displayWeather.current.rain_1h > 0 && (
                      <div className="flex items-center gap-1.5">
                        <CloudRain className="h-4 w-4 text-blue-400" />
                        <span className="text-blue-600 font-medium">강수 {displayWeather.current.rain_1h}mm/h</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-6 mt-4 pt-3 border-t text-xs text-muted-foreground">
                  <span>🌅 일출 {formatSunTime(displayWeather.current.sunrise)}</span>
                  <span>🌇 일몰 {formatSunTime(displayWeather.current.sunset)}</span>
                  <span><Cloud className="inline h-3 w-3" /> 구름 {displayWeather.current.clouds}%</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Wind className="h-4 w-4" /> 풍속 상태
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center">
                <div className={`text-4xl font-bold ${
                  displayWeather.current.wind_speed >= 15 ? "text-destructive" :
                  displayWeather.current.wind_speed >= 10 ? "text-warning" : "text-success"
                }`}>
                  {displayWeather.current.wind_speed}
                </div>
                <p className="text-sm text-muted-foreground">m/s</p>
                <div className="mt-3 w-full">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>안전 (&lt;10)</span>
                    <span>주의 (10-15)</span>
                    <span>위험 (&gt;15)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                    <div className="bg-success" style={{ width: "40%" }} />
                    <div className="bg-warning" style={{ width: "20%" }} />
                    <div className="bg-destructive" style={{ width: "40%" }} />
                  </div>
                  <div
                    className="h-3 w-0.5 bg-foreground -mt-3 transition-all"
                    style={{ marginLeft: `${Math.min(displayWeather.current.wind_speed / 25 * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs mt-2 font-medium">
                  {displayWeather.current.wind_speed >= 15 ? "🚫 양중 작업 금지" :
                   displayWeather.current.wind_speed >= 10 ? "⚠️ 크레인 작업 제한" : "✅ 작업 가능"}
                </p>
                {displayWeather.current.wind_gust > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">순간최대풍속 {displayWeather.current.wind_gust}m/s</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Tabs: Hourly / Weekly / Radar / Impact */}
          <Tabs defaultValue="hourly" className="w-full">
            <TabsList className="grid w-full grid-cols-4 max-w-md">
              <TabsTrigger value="hourly">시간별</TabsTrigger>
              <TabsTrigger value="weekly">주간</TabsTrigger>
              <TabsTrigger value="radar" className="flex items-center gap-1">
                <Radio className="h-3 w-3" /> 레이더
              </TabsTrigger>
              <TabsTrigger value="impact">영향분석</TabsTrigger>
            </TabsList>

            <TabsContent value="hourly">
              <Card>
                <CardContent className="pt-4">
                  {displayWeather.hourly.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {displayWeather.hourly.map((h, i) => (
                        <div key={i} className="flex flex-col items-center min-w-[80px] p-2 rounded-lg bg-muted/50">
                          <span className="text-[10px] text-muted-foreground">{formatTime(h.dt)}</span>
                          {SMALL_ICONS[h.main] || <Cloud className="h-5 w-5 text-slate-400" />}
                          <span className="text-sm font-semibold">{h.temp}°</span>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            <Wind className="h-3 w-3 text-muted-foreground" />
                            <span className={`text-[10px] ${h.wind_speed >= 10 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                              {h.wind_speed.toFixed(1)}
                            </span>
                          </div>
                          {h.rain > 0 && <span className="text-[10px] text-blue-500 font-medium">{h.rain}mm</span>}
                          {h.snow > 0 && <span className="text-[10px] text-sky-400 font-medium">❄{h.snow}mm</span>}
                          {h.pop > 0 && <span className="text-[10px] text-blue-400">💧{Math.round(h.pop * 100)}%</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">시간별 예보 데이터 없음</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="weekly">
              <Card>
                <CardContent className="pt-4">
                  {displayWeather.daily.length > 0 ? (
                    <div className="space-y-2">
                      {displayWeather.daily.map((d, i) => (
                        <div key={i} className="flex items-center gap-4 py-2 border-b last:border-0">
                          <span className="text-sm font-medium w-24">{formatDate(d.date)}</span>
                          {SMALL_ICONS[d.main] || <Cloud className="h-5 w-5 text-slate-400" />}
                          <span className="text-xs text-muted-foreground w-20 truncate">{d.description}</span>
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs text-blue-500 flex items-center gap-0.5">
                              <ArrowDown className="h-3 w-3" />{d.temp_min}°
                            </span>
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-blue-400 to-orange-400"
                                style={{
                                  marginLeft: `${Math.max(0, (d.temp_min + 10) / 50 * 100)}%`,
                                  width: `${Math.max(10, (d.temp_max - d.temp_min) / 50 * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs text-orange-500 flex items-center gap-0.5">
                              <ArrowUp className="h-3 w-3" />{d.temp_max}°
                            </span>
                          </div>
                          <div className="flex items-center gap-1 w-16">
                            <Droplets className="h-3 w-3 text-blue-400" />
                            <span className="text-xs">{d.pop_max}%</span>
                          </div>
                          {d.rain_total > 0 && (
                            <span className="text-[10px] text-blue-500 w-14">{d.rain_total}mm</span>
                          )}
                          <div className="flex items-center gap-1 w-20">
                            <Wind className="h-3 w-3 text-muted-foreground" />
                            <span className={`text-xs ${d.wind_max >= 10 ? "text-destructive font-bold" : ""}`}>
                              {d.wind_max.toFixed(1)}m/s
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">주간 예보 데이터 없음</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="radar">
              <KmaRadarTab lat={displayWeather.current.lat} lng={displayWeather.current.lng} />
            </TabsContent>

            <TabsContent value="impact">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-warning" /> 현장 영향 분석
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <ImpactCard
                      title="크레인/양중 작업"
                      status={displayWeather.current.wind_speed >= 15 ? "danger" : displayWeather.current.wind_speed >= 10 ? "warning" : "safe"}
                      detail={displayWeather.current.wind_speed >= 15
                        ? `🚫 작업 금지 (풍속 ${displayWeather.current.wind_speed}m/s)`
                        : displayWeather.current.wind_speed >= 10
                        ? `⚠️ 작업 제한 (풍속 ${displayWeather.current.wind_speed}m/s)`
                        : "✅ 작업 가능"}
                    />
                    <ImpactCard
                      title="토공/콘크리트 작업"
                      status={displayWeather.current.rain_1h >= 10 ? "danger" : (displayWeather.current.rain_1h > 0 || displayWeather.current.main === "Rain") ? "warning" : "safe"}
                      detail={displayWeather.current.rain_1h >= 10
                        ? `🚫 작업 중지 (강수 ${displayWeather.current.rain_1h}mm/h)`
                        : displayWeather.current.rain_1h > 0 ? `⚠️ 지연 위험 (강수 ${displayWeather.current.rain_1h}mm/h)`
                        : displayWeather.current.main === "Rain" ? "⚠️ 비 — 지연 위험" : "✅ 작업 가능"}
                    />
                    <ImpactCard
                      title="옥외 작업 (폭염)"
                      status={displayWeather.current.temp >= 33 ? "danger" : displayWeather.current.temp >= 30 ? "warning" : "safe"}
                      detail={displayWeather.current.temp >= 35
                        ? `🚫 전면 중지 (${displayWeather.current.temp}°C)`
                        : displayWeather.current.temp >= 33
                        ? `⚠️ 작업 제한 (${displayWeather.current.temp}°C)`
                        : displayWeather.current.temp >= 30
                        ? `⚠️ 고온 주의 (${displayWeather.current.temp}°C)`
                        : "✅ 정상"}
                    />
                    <ImpactCard
                      title="결빙/미끄럼"
                      status={displayWeather.current.temp <= -10 ? "danger" : displayWeather.current.temp <= 0 ? "warning" : "safe"}
                      detail={displayWeather.current.temp <= -10
                        ? `🚫 한파 — 옥외 작업 제한 (${displayWeather.current.temp}°C)`
                        : displayWeather.current.temp <= 0
                        ? `⚠️ 결빙 위험 (${displayWeather.current.temp}°C)`
                        : "✅ 정상"}
                    />
                    <ImpactCard
                      title="시정/안개"
                      status={displayWeather.current.visibility < 200 ? "danger" : displayWeather.current.visibility < 1000 ? "warning" : "safe"}
                      detail={displayWeather.current.visibility < 200
                        ? `🚫 작업 중지 (시정 ${displayWeather.current.visibility}m)`
                        : displayWeather.current.visibility < 1000
                        ? `⚠️ 운행 주의 (시정 ${displayWeather.current.visibility}m)`
                        : `✅ 시정 ${(displayWeather.current.visibility / 1000).toFixed(1)}km`}
                    />
                    <ImpactCard
                      title="낙뢰"
                      status={displayWeather.current.main === "Thunderstorm" ? "danger" : "safe"}
                      detail={displayWeather.current.main === "Thunderstorm"
                        ? "🚫 즉시 대피 — 옥외 작업 금지"
                        : "✅ 정상"}
                    />
                    <ImpactCard
                      title="태풍/저기압"
                      status={displayWeather.typhoon?.risk === "danger" ? "danger" : displayWeather.typhoon?.risk === "warning" ? "warning" : displayWeather.typhoon?.risk === "caution" ? "warning" : "safe"}
                      detail={displayWeather.typhoon?.risk !== "none" && displayWeather.typhoon?.message
                        ? displayWeather.typhoon.message
                        : `✅ 정상 (기압 ${displayWeather.current.pressure || '-'}hPa)`}
                    />
                    <ImpactCard
                      title="전체 판정"
                      status={
                        displayWeather.alerts.some(a => a.level === "danger") ? "danger" :
                        displayWeather.alerts.some(a => a.level === "warning") ? "warning" : "safe"
                      }
                      detail={
                        displayWeather.alerts.some(a => a.level === "danger") ? "🚫 작업 중지 검토 필요" :
                        displayWeather.alerts.some(a => a.level === "warning") ? "⚠️ 주의하며 작업" : "✅ 정상 작업 가능"
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
};

// Radar Tab - Windy.com interactive embed (zoom/pan/layers/time built-in)
function KmaRadarTab({ lat, lng }: { lat: number; lng: number }) {
  const [layer, setLayer] = useState<"radar" | "rain" | "wind" | "temp" | "clouds" | "pressure">("radar");

  // Windy embed URL - fully interactive (zoom, pan, time slider, layer switch)
  // Docs: https://api.windy.com/embed2.0
  const windyUrl = useMemo(() => {
    const overlay = layer === "radar" ? "radar" : layer;
    const params = new URLSearchParams({
      lat: lat.toFixed(4),
      lon: lng.toFixed(4),
      detailLat: lat.toFixed(4),
      detailLon: lng.toFixed(4),
      zoom: "9",
      level: "surface",
      overlay,
      product: "ecmwf",
      menu: "",
      message: "",
      marker: "true",
      calendar: "now",
      pressure: "",
      type: "map",
      location: "coordinates",
      detail: "",
      metricWind: "default",
      metricTemp: "default",
      radarRange: "-1",
    });
    return `https://embed.windy.com/embed2.html?${params.toString()}`;
  }, [lat, lng, layer]);

  const layers: { key: typeof layer; label: string; emoji: string }[] = [
    { key: "radar", label: "레이더", emoji: "📡" },
    { key: "rain", label: "강수", emoji: "🌧" },
    { key: "wind", label: "바람", emoji: "💨" },
    { key: "temp", label: "기온", emoji: "🌡" },
    { key: "clouds", label: "구름", emoji: "☁️" },
    { key: "pressure", label: "기압", emoji: "🧭" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" /> 인터랙티브 기상 레이더
          <Badge variant="outline" className="text-[9px]">Windy.com · ECMWF</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Layer switcher */}
        <div className="flex flex-wrap gap-1.5">
          {layers.map((l) => (
            <Button
              key={l.key}
              variant={layer === l.key ? "default" : "outline"}
              size="sm"
              onClick={() => setLayer(l.key)}
              className="text-xs h-7 gap-1"
            >
              <span>{l.emoji}</span> {l.label}
            </Button>
          ))}
        </div>

        {/* Full-width interactive radar */}
        <div className="relative w-full rounded-lg overflow-hidden border bg-muted" style={{ height: 'calc(min(75vh, 680px))' }}>
          <iframe
            key={layer}
            src={windyUrl}
            title="Windy 인터랙티브 레이더"
            className="w-full h-full border-0"
            frameBorder={0}
            allow="geolocation"
          />

          {/* Site location overlay */}
          <div className="absolute top-3 left-3 bg-background/95 backdrop-blur rounded-lg px-3 py-2 border shadow-md pointer-events-none z-10">
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="h-3 w-3 text-destructive" />
              <span className="font-medium">현장 위치</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              위도 {lat.toFixed(4)} · 경도 {lng.toFixed(4)}
            </p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-muted/50 border">
          <p className="text-xs text-muted-foreground">
            💡 <strong>사용법:</strong> 마우스 휠로 확대/축소, 드래그로 이동, 하단 시간 슬라이더로 예보 시점 변경, 좌측 메뉴에서 더 많은 레이어 선택. 
            ECMWF(유럽중기예보센터) 모델 기반으로 예측 정확도가 높습니다.
          </p>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-2">
          <a href={`https://www.windy.com/${lat}/${lng}?radar,${lat},${lng},9`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="w-full text-xs gap-1">
              <ExternalLink className="h-3 w-3" /> Windy 전체화면
            </Button>
          </a>
          <a href="https://www.weather.go.kr/w/image/radar.do" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="w-full text-xs gap-1">
              <ExternalLink className="h-3 w-3" /> 기상청 공식 레이더
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactCard({ title, status, detail }: { title: string; status: string; detail: string }) {
  const colors = {
    safe: "border-success/30 bg-success/5",
    warning: "border-warning/30 bg-warning/5",
    danger: "border-destructive/30 bg-destructive/5",
  };
  const dotColors = { safe: "bg-success", warning: "bg-warning", danger: "bg-destructive" };
  const labels = { safe: "안전", warning: "주의", danger: "위험" };

  return (
    <div className={`p-3 rounded-lg border ${colors[status as keyof typeof colors] || colors.safe}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <div className={`h-2 w-2 rounded-full ${dotColors[status as keyof typeof dotColors]}`} />
          <span className="text-[10px] font-medium">{labels[status as keyof typeof labels]}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default SiteWeather;
