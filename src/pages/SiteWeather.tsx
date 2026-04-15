import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Cloud, CloudRain, CloudSnow, Sun, Wind, Thermometer, Droplets,
  AlertTriangle, CheckCircle2, RefreshCw, MapPin, Eye, Snowflake,
  CloudLightning, CloudFog, CloudDrizzle, Star, StarOff, Gauge,
  ArrowDown, ArrowUp, ShieldAlert, Navigation, ExternalLink, Info
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
const SOURCE_KEY = "weather-source";

function getFavorites(): { name: string; lat: number; lng: number }[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); } catch { return []; }
}
function saveFavorites(favs: { name: string; lat: number; lng: number }[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}
function getSavedSource(): string {
  return localStorage.getItem(SOURCE_KEY) || "kma";
}

const SiteWeather = () => {
  const { projects, selectedProject } = useGlobalProjectAccess();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualAddress, setManualAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [favorites, setFavorites] = useState(getFavorites());
  const [errorMsg, setErrorMsg] = useState("");
  const [dataSource, setDataSource] = useState(getSavedSource());

  const currentProject = projects.find((p) => p.id === selectedProject);

  const fetchWeather = useCallback(async (overrideLat?: number, overrideLng?: number, source?: string) => {
    if (!selectedProject) return;
    setLoading(true);
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
          source: source || dataSource,
        },
      });

      if (error) throw error;
      if (data?.error) {
        setErrorMsg(data.error);
        return;
      }
      setWeather(data);
    } catch (err: any) {
      console.error("Weather fetch error:", err);
      setErrorMsg(err.message || "날씨 데이터 로드 실패");
      toast({ title: "날씨 데이터 로드 실패", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedProject, dataSource]);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  const handleSaveAddress = async () => {
    if (!selectedProject || !manualAddress.trim()) return;
    try {
      await supabase
        .from("projects")
        .update({ site_address: manualAddress.trim(), site_lat: null, site_lng: null } as any)
        .eq("id", selectedProject);
      toast({ title: "주소 저장 완료", description: "좌표를 자동 변환하여 날씨를 조회합니다" });
      setEditingAddress(false);
      fetchWeather();
    } catch (err: any) {
      toast({ title: "저장 실패", description: err.message, variant: "destructive" });
    }
  };

  const handleSourceChange = (newSource: string) => {
    setDataSource(newSource);
    localStorage.setItem(SOURCE_KEY, newSource);
    fetchWeather(undefined, undefined, newSource);
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
            {currentProject ? `${currentProject.site_name}` : "프로젝트 선택 필요"}
            {weather?.current?.city && ` · ${weather.current.city}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {weather?.fetched_at && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(weather.fetched_at).toLocaleTimeString("ko-KR")} 기준
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFavorite} title="즐겨찾기">
            {isFavorite ? <Star className="h-4 w-4 text-amber-400 fill-amber-400" /> : <StarOff className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fetchWeather()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Location Verification + Data Source */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          {/* Resolved Location Info */}
          {weather?.resolved_location && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border">
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">📍 조회 위치 확인</span>
                  <Badge variant="outline" className="text-[10px]">
                    {weather.resolved_location.city || '알 수 없음'}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>위도: {weather.resolved_location.lat.toFixed(4)}</span>
                  <span>경도: {weather.resolved_location.lng.toFixed(4)}</span>
                  {weather.resolved_location.address && (
                    <span className="truncate">입력: {weather.resolved_location.address}</span>
                  )}
                </div>
                <a
                  href={`https://map.naver.com/p/search/${weather.resolved_location.lat},${weather.resolved_location.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> 네이버 지도에서 위치 확인
                </a>
              </div>
            </div>
          )}

          {/* Location Editor */}
          <div className="flex flex-wrap items-center gap-2">
            {editingAddress ? (
              <div className="flex gap-2 flex-1 min-w-[300px]">
                <Input
                  placeholder="현장 주소 입력 (예: 서울특별시 강남구 테헤란로 123)"
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveAddress()}
                />
                <Button size="sm" onClick={handleSaveAddress}>저장</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingAddress(false)}>취소</Button>
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

          {/* Data Source Selector */}
          <div className="flex items-center gap-4 pt-1">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" /> 데이터 소스:
            </span>
            <RadioGroup
              value={dataSource}
              onValueChange={handleSourceChange}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="kma" id="src-kma" />
                <Label htmlFor="src-kma" className="text-xs cursor-pointer">
                  🇰🇷 기상청 (기본)
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="openweather" id="src-ow" />
                <Label htmlFor="src-ow" className="text-xs cursor-pointer">
                  🌐 OpenWeather (보조)
                </Label>
              </div>
            </RadioGroup>
            {weather?.source_label && (
              <Badge variant="secondary" className="text-[10px]">
                현재: {weather.source_label}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {errorMsg && (
        <Card className="border-destructive">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive font-medium">{errorMsg}</p>
            <p className="text-xs text-muted-foreground mt-1">API 키를 확인하거나 다시 시도해 주세요.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchWeather()}>다시 시도</Button>
          </CardContent>
        </Card>
      )}

      {!weather && !errorMsg ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">날씨 데이터를 불러올 수 없습니다.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchWeather()}>다시 시도</Button>
          </CardContent>
        </Card>
      ) : weather && (
        <>
          {/* Safety Alerts Banner */}
          {weather.alerts.length > 0 && (
            <div className="space-y-2">
              {weather.alerts.map((alert, i) => (
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

          {/* Typhoon Alert */}
          {weather.typhoon && weather.typhoon.risk !== "none" && (
            <Card className={`border-2 ${
              weather.typhoon.risk === "danger" ? "border-destructive bg-destructive/5" :
              weather.typhoon.risk === "warning" ? "border-warning bg-warning/5" :
              "border-amber-500 bg-amber-500/5"
            }`}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                    weather.typhoon.risk === "danger" ? "bg-destructive/20" :
                    weather.typhoon.risk === "warning" ? "bg-warning/20" : "bg-amber-500/20"
                  }`}>
                    <Navigation className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">🌀 태풍/저기압 경보</span>
                      {getAlertBadge(weather.typhoon.risk)}
                    </div>
                    <p className="text-sm mt-1">{weather.typhoon.message}</p>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span>기압: {weather.typhoon.pressure}hPa</span>
                      <span>풍속: {weather.typhoon.wind_speed}m/s</span>
                      {weather.typhoon.wind_gust > 0 && <span>순간풍속: {weather.typhoon.wind_gust}m/s</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Current Weather + Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">현재 날씨</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    {WEATHER_ICONS[weather.current.main] || <Cloud className="h-8 w-8 text-slate-400" />}
                    <p className="text-xs text-muted-foreground mt-1">{weather.current.description}</p>
                  </div>
                  <div>
                    <p className="text-5xl font-bold">{weather.current.temp}°</p>
                    <p className="text-sm text-muted-foreground">체감 {weather.current.feels_like}°C</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm ml-auto">
                    <div className="flex items-center gap-1.5">
                      <Wind className="h-4 w-4 text-muted-foreground" />
                      <span>{weather.current.wind_speed}m/s {windDirection(weather.current.wind_deg)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Droplets className="h-4 w-4 text-muted-foreground" />
                      <span>습도 {weather.current.humidity}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <span>시정 {(weather.current.visibility / 1000).toFixed(1)}km</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      <span>기압 {weather.current.pressure || '-'}hPa</span>
                    </div>
                    {weather.current.wind_gust > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Wind className="h-4 w-4 text-warning" />
                        <span className="text-warning">순간 {weather.current.wind_gust}m/s</span>
                      </div>
                    )}
                    {weather.current.rain_1h > 0 && (
                      <div className="flex items-center gap-1.5">
                        <CloudRain className="h-4 w-4 text-blue-400" />
                        <span className="text-blue-600 font-medium">강수 {weather.current.rain_1h}mm/h</span>
                      </div>
                    )}
                    {weather.current.snow_1h > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Snowflake className="h-4 w-4 text-sky-300" />
                        <span className="text-sky-500 font-medium">적설 {weather.current.snow_1h}mm</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-6 mt-4 pt-3 border-t text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">🌅 일출 {formatSunTime(weather.current.sunrise)}</span>
                  <span className="flex items-center gap-1">🌇 일몰 {formatSunTime(weather.current.sunset)}</span>
                  <span className="flex items-center gap-1"><Cloud className="h-3 w-3" /> 구름 {weather.current.clouds}%</span>
                </div>
              </CardContent>
            </Card>

            {/* Wind Gauge */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Wind className="h-4 w-4" /> 풍속 상태
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center">
                <div className={`text-4xl font-bold ${
                  weather.current.wind_speed >= 15 ? "text-destructive" :
                  weather.current.wind_speed >= 10 ? "text-warning" : "text-success"
                }`}>
                  {weather.current.wind_speed}
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
                    style={{ marginLeft: `${Math.min(weather.current.wind_speed / 25 * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs mt-2 font-medium">
                  {weather.current.wind_speed >= 15 ? "🚫 양중 작업 금지" :
                   weather.current.wind_speed >= 10 ? "⚠️ 크레인 작업 제한" : "✅ 작업 가능"}
                </p>
                {weather.current.wind_gust > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">순간최대풍속 {weather.current.wind_gust}m/s</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Tabs: Hourly / Weekly */}
          <Tabs defaultValue="hourly" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="hourly">시간별 예보</TabsTrigger>
              <TabsTrigger value="weekly">주간 예보</TabsTrigger>
            </TabsList>

            <TabsContent value="hourly">
              <Card>
                <CardContent className="pt-4">
                  {weather.hourly.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {weather.hourly.map((h, i) => (
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
                  {weather.daily.length > 0 ? (
                    <div className="space-y-2">
                      {weather.daily.map((d, i) => (
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
          </Tabs>

          {/* Site Impact Analysis */}
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
                  status={weather.current.wind_speed >= 15 ? "danger" : weather.current.wind_speed >= 10 ? "warning" : "safe"}
                  detail={weather.current.wind_speed >= 15
                    ? `🚫 작업 금지 (풍속 ${weather.current.wind_speed}m/s)`
                    : weather.current.wind_speed >= 10
                    ? `⚠️ 작업 제한 (풍속 ${weather.current.wind_speed}m/s)`
                    : "✅ 작업 가능"}
                />
                <ImpactCard
                  title="토공/콘크리트 작업"
                  status={weather.current.rain_1h >= 10 ? "danger" : (weather.current.rain_1h > 0 || weather.current.main === "Rain") ? "warning" : "safe"}
                  detail={weather.current.rain_1h >= 10
                    ? `🚫 작업 중지 (강수 ${weather.current.rain_1h}mm/h)`
                    : weather.current.rain_1h > 0 ? `⚠️ 지연 위험 (강수 ${weather.current.rain_1h}mm/h)`
                    : weather.current.main === "Rain" ? "⚠️ 비 — 지연 위험" : "✅ 작업 가능"}
                />
                <ImpactCard
                  title="옥외 작업 (폭염)"
                  status={weather.current.temp >= 35 ? "danger" : weather.current.temp >= 33 ? "danger" : weather.current.temp >= 30 ? "warning" : "safe"}
                  detail={weather.current.temp >= 35
                    ? `🚫 전면 중지 (${weather.current.temp}°C)`
                    : weather.current.temp >= 33
                    ? `⚠️ 작업 제한, 휴식 필수 (${weather.current.temp}°C)`
                    : weather.current.temp >= 30
                    ? `⚠️ 고온 주의 (${weather.current.temp}°C)`
                    : "✅ 정상"}
                />
                <ImpactCard
                  title="결빙/미끄럼"
                  status={weather.current.temp <= -10 ? "danger" : weather.current.temp <= 0 ? "warning" : "safe"}
                  detail={weather.current.temp <= -10
                    ? `🚫 한파 — 옥외 작업 제한 (${weather.current.temp}°C)`
                    : weather.current.temp <= 0
                    ? `⚠️ 결빙 위험 — 방한 장비 (${weather.current.temp}°C)`
                    : "✅ 정상"}
                />
                <ImpactCard
                  title="시정/안개"
                  status={weather.current.visibility < 200 ? "danger" : weather.current.visibility < 1000 ? "warning" : "safe"}
                  detail={weather.current.visibility < 200
                    ? `🚫 작업 중지 (시정 ${weather.current.visibility}m)`
                    : weather.current.visibility < 1000
                    ? `⚠️ 운행 주의 (시정 ${weather.current.visibility}m)`
                    : `✅ 시정 ${(weather.current.visibility / 1000).toFixed(1)}km`}
                />
                <ImpactCard
                  title="낙뢰"
                  status={weather.current.main === "Thunderstorm" ? "danger" : "safe"}
                  detail={weather.current.main === "Thunderstorm"
                    ? "🚫 즉시 대피 — 옥외 작업 금지"
                    : "✅ 정상"}
                />
                <ImpactCard
                  title="태풍/저기압"
                  status={weather.typhoon?.risk === "danger" ? "danger" : weather.typhoon?.risk === "warning" ? "warning" : weather.typhoon?.risk === "caution" ? "warning" : "safe"}
                  detail={weather.typhoon?.risk !== "none" && weather.typhoon?.message
                    ? weather.typhoon.message
                    : `✅ 정상 (기압 ${weather.current.pressure || '-'}hPa)`}
                />
                <ImpactCard
                  title="전체 판정"
                  status={
                    weather.alerts.some(a => a.level === "danger") ? "danger" :
                    weather.alerts.some(a => a.level === "warning") ? "warning" : "safe"
                  }
                  detail={
                    weather.alerts.some(a => a.level === "danger") ? "🚫 작업 중지 검토 필요" :
                    weather.alerts.some(a => a.level === "warning") ? "⚠️ 주의하며 작업" : "✅ 정상 작업 가능"
                  }
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

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
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export default SiteWeather;
