import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { project_id, lat, lng, address } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400,
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve coordinates
    let resolvedLat = lat;
    let resolvedLng = lng;

    // If address provided but no coordinates, geocode it
    if (address && (!resolvedLat || !resolvedLng)) {
      try {
        const geoRes = await fetch(
          `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(address)}&limit=1&appid=${apiKey}`
        );
        const geoData = await geoRes.json();
        console.log("Geocoding result:", JSON.stringify(geoData));
        if (geoData && geoData.length > 0) {
          resolvedLat = geoData[0].lat;
          resolvedLng = geoData[0].lon;
          // Save coordinates back to project
          await supabase
            .from("projects")
            .update({ site_lat: resolvedLat, site_lng: resolvedLng })
            .eq("id", project_id);
        }
      } catch (geoErr) {
        console.error("Geocoding error:", geoErr);
      }
    }

    // Default to Seoul if still no coords
    if (!resolvedLat || !resolvedLng) {
      resolvedLat = 37.5665;
      resolvedLng = 126.978;
    }

    // Check cache
    const { data: cached } = await supabase
      .from("weather_cache")
      .select("data, fetched_at")
      .eq("project_id", project_id)
      .eq("cache_type", "all")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();

    if (cached && cached.data && (cached.data as any)?.current?.temp !== 0) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_DURATION_MS) {
        console.log("Returning cached weather data");
        return new Response(JSON.stringify(cached.data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch current weather
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${resolvedLat}&lon=${resolvedLng}&appid=${apiKey}&units=metric&lang=kr`;
    console.log("Fetching current weather:", currentUrl.replace(apiKey, "***"));
    const currentRes = await fetch(currentUrl);
    const currentData = await currentRes.json();
    console.log("Current weather response status:", currentRes.status, "cod:", currentData.cod);

    if (currentData.cod && currentData.cod !== 200) {
      console.error("OpenWeather API error:", JSON.stringify(currentData));
      return new Response(JSON.stringify({ 
        error: `OpenWeather API error: ${currentData.message || currentData.cod}`,
        details: currentData 
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch 5-day/3-hour forecast
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${resolvedLat}&lon=${resolvedLng}&appid=${apiKey}&units=metric&lang=kr`;
    const forecastRes = await fetch(forecastUrl);
    const forecastData = await forecastRes.json();
    console.log("Forecast response status:", forecastRes.status);

    // Process current weather
    const current = {
      temp: Math.round(currentData.main?.temp ?? 0),
      feels_like: Math.round(currentData.main?.feels_like ?? 0),
      humidity: currentData.main?.humidity ?? 0,
      wind_speed: currentData.wind?.speed ?? 0,
      wind_deg: currentData.wind?.deg ?? 0,
      wind_gust: currentData.wind?.gust ?? 0,
      description: currentData.weather?.[0]?.description ?? "",
      icon: currentData.weather?.[0]?.icon ?? "01d",
      main: currentData.weather?.[0]?.main ?? "",
      rain_1h: currentData.rain?.["1h"] ?? 0,
      snow_1h: currentData.snow?.["1h"] ?? 0,
      visibility: currentData.visibility ?? 10000,
      clouds: currentData.clouds?.all ?? 0,
      pressure: currentData.main?.pressure ?? 0,
      dt: currentData.dt,
      city: currentData.name ?? "",
      sunrise: currentData.sys?.sunrise ?? 0,
      sunset: currentData.sys?.sunset ?? 0,
      lat: resolvedLat,
      lng: resolvedLng,
    };

    // Process hourly (3h intervals from forecast)
    const hourly = (forecastData.list || []).slice(0, 16).map((item: any) => ({
      dt: item.dt,
      temp: Math.round(item.main?.temp ?? 0),
      feels_like: Math.round(item.main?.feels_like ?? 0),
      humidity: item.main?.humidity ?? 0,
      wind_speed: item.wind?.speed ?? 0,
      wind_gust: item.wind?.gust ?? 0,
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
          wind_gust_max: item.wind?.gust ?? 0,
          rain_total: 0,
          snow_total: 0,
          pop_max: 0,
          icon: item.weather?.[0]?.icon ?? "01d",
          main: item.weather?.[0]?.main ?? "",
          description: item.weather?.[0]?.description ?? "",
        };
      }
      const d = dailyMap[date];
      d.temp_min = Math.min(d.temp_min, item.main.temp_min);
      d.temp_max = Math.max(d.temp_max, item.main.temp_max);
      d.wind_max = Math.max(d.wind_max, item.wind?.speed ?? 0);
      d.wind_gust_max = Math.max(d.wind_gust_max, item.wind?.gust ?? 0);
      d.rain_total += item.rain?.["3h"] ?? 0;
      d.snow_total += item.snow?.["3h"] ?? 0;
      d.pop_max = Math.max(d.pop_max, item.pop ?? 0);
    });
    const daily = Object.values(dailyMap).map((d: any) => ({
      ...d,
      temp_min: Math.round(d.temp_min),
      temp_max: Math.round(d.temp_max),
      rain_total: Math.round(d.rain_total * 10) / 10,
      snow_total: Math.round(d.snow_total * 10) / 10,
      pop_max: Math.round(d.pop_max * 100),
    }));

    // Generate safety alerts
    const alerts = generateSafetyAlerts(current, hourly, daily);

    // Check for typhoon/tropical storm info (pressure-based heuristic)
    const typhoonInfo = detectTyphoonRisk(current, hourly);

    const result = { 
      current, 
      hourly, 
      daily, 
      alerts, 
      typhoon: typhoonInfo,
      fetched_at: new Date().toISOString() 
    };

    // Only cache valid data
    if (current.temp !== 0 || current.description !== "") {
      await supabase
        .from("weather_cache")
        .upsert(
          { project_id, cache_type: "all", data: result, fetched_at: new Date().toISOString() },
          { onConflict: "project_id,cache_type" }
        );
    }

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

function generateSafetyAlerts(current: any, hourly: any[], daily: any[]) {
  const alerts: { level: string; title: string; description: string; icon: string; category: string }[] = [];

  // === Wind alerts ===
  if (current.wind_speed >= 15 || current.wind_gust >= 20) {
    alerts.push({ level: "danger", title: "강풍 경보", description: `풍속 ${current.wind_speed}m/s (순간 ${current.wind_gust}m/s) — 양중/크레인 작업 금지 권고`, icon: "wind", category: "wind" });
  } else if (current.wind_speed >= 10 || current.wind_gust >= 15) {
    alerts.push({ level: "warning", title: "강풍 주의", description: `풍속 ${current.wind_speed}m/s — 크레인 작업 제한`, icon: "wind", category: "wind" });
  }

  // === Temperature alerts ===
  if (current.temp >= 35) {
    alerts.push({ level: "danger", title: "극심 폭염", description: `기온 ${current.temp}°C — 옥외 작업 전면 중지 권고`, icon: "thermometer", category: "heat" });
  } else if (current.temp >= 33) {
    alerts.push({ level: "danger", title: "폭염 경보", description: `기온 ${current.temp}°C — 옥외 작업 제한, 휴식 필수 (매 시간 15분)`, icon: "thermometer", category: "heat" });
  } else if (current.temp >= 30) {
    alerts.push({ level: "warning", title: "고온 주의", description: `기온 ${current.temp}°C — 충분한 수분 섭취 및 그늘 휴식 권고`, icon: "thermometer", category: "heat" });
  }

  if (current.temp <= -10) {
    alerts.push({ level: "danger", title: "한파 경보", description: `기온 ${current.temp}°C — 동파 및 저체온 위험, 옥외 작업 제한`, icon: "snowflake", category: "cold" });
  } else if (current.temp <= 0) {
    alerts.push({ level: "warning", title: "결빙 주의", description: `기온 ${current.temp}°C — 미끄럼/결빙 위험, 방한 장비 착용`, icon: "snowflake", category: "cold" });
  }

  // === Rain alerts ===
  if (current.rain_1h >= 30) {
    alerts.push({ level: "danger", title: "호우 경보", description: `시간당 강수량 ${current.rain_1h}mm — 작업 중지, 지반 붕괴 위험`, icon: "rain", category: "rain" });
  } else if (current.rain_1h >= 10) {
    alerts.push({ level: "warning", title: "강우 주의", description: `시간당 강수량 ${current.rain_1h}mm — 토공/콘크리트 작업 지연 위험`, icon: "rain", category: "rain" });
  } else if (current.rain_1h > 0 || current.main === "Rain" || current.main === "Drizzle") {
    alerts.push({ level: "caution", title: "강수 중", description: "토공/콘크리트 작업 지연 위험, 미끄럼 주의", icon: "rain", category: "rain" });
  }

  // === Snow alerts ===
  if (current.snow_1h > 0 || current.main === "Snow") {
    alerts.push({ level: "warning", title: "적설 주의", description: `적설 ${current.snow_1h}mm — 지붕/구조물 하중 확인, 미끄럼 방지`, icon: "snowflake", category: "snow" });
  }

  // === Visibility alerts ===
  if (current.visibility < 200) {
    alerts.push({ level: "danger", title: "시정 불량 경보", description: `시정 ${current.visibility}m — 작업 중지 권고`, icon: "fog", category: "visibility" });
  } else if (current.visibility < 1000) {
    alerts.push({ level: "warning", title: "안개/시정 주의", description: `시정 ${current.visibility}m — 크레인/차량 운행 주의`, icon: "fog", category: "visibility" });
  }

  // === Thunderstorm ===
  if (current.main === "Thunderstorm") {
    alerts.push({ level: "danger", title: "낙뢰 경보", description: "번개/낙뢰 감지 — 옥외 작업 즉시 중지, 대피", icon: "lightning", category: "lightning" });
  }

  // === Pressure drop (typhoon indicator) ===
  if (current.pressure > 0 && current.pressure < 990) {
    alerts.push({ level: "danger", title: "태풍/저기압 접근", description: `기압 ${current.pressure}hPa — 태풍 접근 가능성, 작업 중지 준비`, icon: "typhoon", category: "typhoon" });
  } else if (current.pressure > 0 && current.pressure < 1000) {
    alerts.push({ level: "warning", title: "저기압 주의", description: `기압 ${current.pressure}hPa — 기상 악화 가능성`, icon: "typhoon", category: "pressure" });
  }

  // === Future conditions (next 12h) ===
  const futureSlice = hourly.slice(0, 4);
  if (futureSlice.length > 0) {
    const maxFutureWind = Math.max(...futureSlice.map((h: any) => h.wind_speed));
    const maxFutureGust = Math.max(...futureSlice.map((h: any) => h.wind_gust || 0));
    const futureRain = futureSlice.some((h: any) => h.rain > 0 || h.main === "Rain");
    const futureSnow = futureSlice.some((h: any) => h.snow > 0 || h.main === "Snow");
    const futureThunder = futureSlice.some((h: any) => h.main === "Thunderstorm");
    const maxFutureTemp = Math.max(...futureSlice.map((h: any) => h.temp));

    if (maxFutureWind >= 10 && current.wind_speed < 10) {
      alerts.push({ level: "caution", title: "풍속 상승 예보", description: `향후 풍속 최대 ${maxFutureWind.toFixed(1)}m/s 예상`, icon: "wind", category: "forecast" });
    }
    if (futureRain && current.rain_1h === 0 && current.main !== "Rain") {
      alerts.push({ level: "caution", title: "강수 예보", description: "향후 비 예보 — 토공 작업 일정 조정 필요", icon: "rain", category: "forecast" });
    }
    if (futureSnow && current.main !== "Snow") {
      alerts.push({ level: "caution", title: "적설 예보", description: "향후 눈 예보 — 작업 일정 조정 검토", icon: "snowflake", category: "forecast" });
    }
    if (futureThunder && current.main !== "Thunderstorm") {
      alerts.push({ level: "warning", title: "낙뢰 예보", description: "향후 뇌우 예보 — 옥외 작업 대비", icon: "lightning", category: "forecast" });
    }
    if (maxFutureTemp >= 33 && current.temp < 33) {
      alerts.push({ level: "caution", title: "폭염 예보", description: `향후 기온 ${maxFutureTemp}°C 예상 — 작업 시간 조정 검토`, icon: "thermometer", category: "forecast" });
    }
  }

  // === Weekly severe weather ===
  if (daily.length > 0) {
    const weeklyMaxWind = Math.max(...daily.map((d: any) => d.wind_max || 0));
    const weeklyMaxRain = Math.max(...daily.map((d: any) => d.rain_total || 0));
    if (weeklyMaxWind >= 15) {
      alerts.push({ level: "caution", title: "주간 강풍 예보", description: `이번 주 최대 풍속 ${weeklyMaxWind.toFixed(1)}m/s 예상`, icon: "wind", category: "weekly" });
    }
    if (weeklyMaxRain >= 50) {
      alerts.push({ level: "caution", title: "주간 호우 예보", description: `이번 주 최대 일강수량 ${weeklyMaxRain}mm 예상`, icon: "rain", category: "weekly" });
    }
  }

  // If no alerts, show safe
  if (alerts.length === 0) {
    alerts.push({ level: "safe", title: "안전 양호", description: "현재 기상 조건에 특별한 위험 요소가 없습니다", icon: "check", category: "safe" });
  }

  return alerts;
}

function detectTyphoonRisk(current: any, hourly: any[]) {
  // Heuristic typhoon detection based on pressure and wind
  const pressure = current.pressure || 1013;
  const windSpeed = current.wind_speed || 0;
  const gustSpeed = current.wind_gust || 0;

  let risk = "none";
  let message = "";

  if (pressure < 970 && windSpeed >= 17) {
    risk = "danger";
    message = "태풍 영향권 진입 가능성 — 즉시 작업 중지 및 안전 대피";
  } else if (pressure < 990 && windSpeed >= 10) {
    risk = "warning";
    message = "태풍/열대저기압 접근 — 작업 중지 준비 및 자재 고정";
  } else if (pressure < 1000 && (windSpeed >= 8 || gustSpeed >= 12)) {
    risk = "caution";
    message = "저기압 접근 — 기상 변화 모니터링 필요";
  }

  return {
    risk,
    message,
    pressure,
    wind_speed: windSpeed,
    wind_gust: gustSpeed,
  };
}
