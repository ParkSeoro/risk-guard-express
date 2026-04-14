import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { project_id, lat, lng } = await req.json();
    if (!project_id || lat == null || lng == null) {
      return new Response(JSON.stringify({ error: "Missing project_id, lat, lng" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check cache
    const { data: cached } = await supabase
      .from("weather_cache")
      .select("data, fetched_at")
      .eq("project_id", project_id)
      .eq("cache_type", "all")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();

    if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_DURATION_MS) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENWEATHER_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch current weather
    const currentRes = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&lang=kr`
    );
    const currentData = await currentRes.json();

    // Fetch 5-day/3-hour forecast (free tier)
    const forecastRes = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric&lang=kr`
    );
    const forecastData = await forecastRes.json();

    // Process current weather
    const current = {
      temp: Math.round(currentData.main?.temp ?? 0),
      feels_like: Math.round(currentData.main?.feels_like ?? 0),
      humidity: currentData.main?.humidity ?? 0,
      wind_speed: currentData.wind?.speed ?? 0,
      wind_deg: currentData.wind?.deg ?? 0,
      description: currentData.weather?.[0]?.description ?? "",
      icon: currentData.weather?.[0]?.icon ?? "01d",
      main: currentData.weather?.[0]?.main ?? "",
      rain_1h: currentData.rain?.["1h"] ?? 0,
      snow_1h: currentData.snow?.["1h"] ?? 0,
      visibility: currentData.visibility ?? 10000,
      clouds: currentData.clouds?.all ?? 0,
      dt: currentData.dt,
      city: currentData.name ?? "",
    };

    // Process hourly (3h intervals from forecast)
    const hourly = (forecastData.list || []).slice(0, 16).map((item: any) => ({
      dt: item.dt,
      temp: Math.round(item.main?.temp ?? 0),
      feels_like: Math.round(item.main?.feels_like ?? 0),
      wind_speed: item.wind?.speed ?? 0,
      rain: item.rain?.["3h"] ?? 0,
      snow: item.snow?.["3h"] ?? 0,
      description: item.weather?.[0]?.description ?? "",
      icon: item.weather?.[0]?.icon ?? "01d",
      main: item.weather?.[0]?.main ?? "",
      pop: item.pop ?? 0,
    }));

    // Process daily (aggregate from 3h forecast)
    const dailyMap: Record<string, any> = {};
    (forecastData.list || []).forEach((item: any) => {
      const date = new Date(item.dt * 1000).toISOString().split("T")[0];
      if (!dailyMap[date]) {
        dailyMap[date] = {
          date,
          temp_min: item.main.temp_min,
          temp_max: item.main.temp_max,
          wind_max: item.wind?.speed ?? 0,
          rain_total: 0,
          pop_max: 0,
          icon: item.weather?.[0]?.icon ?? "01d",
          description: item.weather?.[0]?.description ?? "",
        };
      }
      const d = dailyMap[date];
      d.temp_min = Math.min(d.temp_min, item.main.temp_min);
      d.temp_max = Math.max(d.temp_max, item.main.temp_max);
      d.wind_max = Math.max(d.wind_max, item.wind?.speed ?? 0);
      d.rain_total += item.rain?.["3h"] ?? 0;
      d.pop_max = Math.max(d.pop_max, item.pop ?? 0);
    });
    const daily = Object.values(dailyMap).map((d: any) => ({
      ...d,
      temp_min: Math.round(d.temp_min),
      temp_max: Math.round(d.temp_max),
      rain_total: Math.round(d.rain_total * 10) / 10,
      pop_max: Math.round(d.pop_max * 100),
    }));

    // Generate safety alerts based on weather conditions
    const alerts = generateSafetyAlerts(current, hourly);

    const result = { current, hourly, daily, alerts, fetched_at: new Date().toISOString() };

    // Upsert cache
    await supabase
      .from("weather_cache")
      .upsert(
        { project_id, cache_type: "all", data: result, fetched_at: new Date().toISOString() },
        { onConflict: "project_id,cache_type" }
      );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Weather fetch error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function generateSafetyAlerts(current: any, hourly: any[]) {
  const alerts: { level: string; title: string; description: string; icon: string }[] = [];

  // Wind alerts
  if (current.wind_speed >= 15) {
    alerts.push({ level: "danger", title: "강풍 경보", description: `풍속 ${current.wind_speed}m/s — 양중/크레인 작업 금지 권고`, icon: "wind" });
  } else if (current.wind_speed >= 10) {
    alerts.push({ level: "warning", title: "강풍 주의", description: `풍속 ${current.wind_speed}m/s — 크레인 작업 제한`, icon: "wind" });
  }

  // Temperature alerts
  if (current.temp >= 33) {
    alerts.push({ level: "danger", title: "폭염 경보", description: `기온 ${current.temp}°C — 옥외 작업 제한, 휴식 필수`, icon: "thermometer" });
  } else if (current.temp <= 0) {
    alerts.push({ level: "warning", title: "결빙 주의", description: `기온 ${current.temp}°C — 미끄럼/결빙 위험`, icon: "snowflake" });
  }

  // Rain alerts
  if (current.rain_1h > 0 || current.main === "Rain") {
    alerts.push({ level: "warning", title: "강수 주의", description: "토공/콘크리트 작업 지연 위험", icon: "rain" });
  }

  // Check future conditions (next 12h)
  const futureHigh = hourly.slice(0, 4);
  const maxFutureWind = Math.max(...futureHigh.map((h: any) => h.wind_speed));
  const futureRain = futureHigh.some((h: any) => h.rain > 0 || h.main === "Rain");

  if (maxFutureWind >= 10 && current.wind_speed < 10) {
    alerts.push({ level: "caution", title: "풍속 상승 예보", description: `향후 풍속 최대 ${maxFutureWind.toFixed(1)}m/s 예상`, icon: "wind" });
  }
  if (futureRain && current.rain_1h === 0) {
    alerts.push({ level: "caution", title: "강수 예보", description: "향후 비 예보 — 토공 작업 일정 조정 필요", icon: "rain" });
  }

  // If no alerts, show safe
  if (alerts.length === 0) {
    alerts.push({ level: "safe", title: "안전 양호", description: "현재 기상 조건에 특별한 위험 요소가 없습니다", icon: "check" });
  }

  return alerts;
}
