import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, MapPin, Radio } from "lucide-react";
import { radarFrameHeight, type WeatherLayout } from "@/components/weather/radarLayout";

type Layer = "radar" | "rain" | "wind" | "temp" | "clouds" | "pressure";

export default function KmaRadarTab({
  lat,
  lng,
  layout = "desktop",
}: {
  lat: number;
  lng: number;
  layout?: WeatherLayout;
}) {
  const [layer, setLayer] = useState<Layer>("radar");

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

  const layers: { key: Layer; label: string; emoji: string }[] = [
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

        <div
          className="relative w-full rounded-lg overflow-hidden border bg-muted"
          style={{ height: radarFrameHeight(layout) }}
          data-testid="weather-radar-frame"
        >
          <iframe
            key={layer}
            src={windyUrl}
            title="Windy 인터랙티브 레이더"
            className="w-full h-full border-0"
            frameBorder={0}
            allow="geolocation"
          />

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
            💡 <strong>사용법:</strong> 확대/축소·드래그로 이동, 하단 시간 슬라이더로 예보 시점 변경.
            ECMWF(유럽중기예보센터) 모델 기반입니다.
          </p>
        </div>

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
