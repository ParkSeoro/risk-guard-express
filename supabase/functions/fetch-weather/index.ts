import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// KMA grid conversion (WGS84 -> grid)
function latLngToGrid(lat: number, lng: number) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0;
  const OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  const x = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const y = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx: x, ny: y };
}

function getKmaBaseDateTime() {
  const now = new Date();
  // KMA issues forecasts at 0200,0500,0800,1100,1400,1700,2000,2300 (KST = UTC+9)
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hours = [23, 20, 17, 14, 11, 8, 5, 2];
  let baseDate = kst.toISOString().slice(0, 10).replace(/-/g, '');
  let baseTime = '0200';
  const currentHour = kst.getUTCHours();
  const currentMin = kst.getUTCMinutes();
  for (const h of hours) {
    // Data available ~10min after base time
    if (currentHour > h || (currentHour === h && currentMin >= 10)) {
      baseTime = String(h).padStart(2, '0') + '00';
      break;
    }
  }
  // If no match, use previous day 2300
  if (baseTime === '0200' && currentHour < 2) {
    const yesterday = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
    baseDate = yesterday.toISOString().slice(0, 10).replace(/-/g, '');
    baseTime = '2300';
  }
  return { baseDate, baseTime };
}

async function fetchKmaWeather(lat: number, lng: number, apiKey: string) {
  const { nx, ny } = latLngToGrid(lat, lng);
  const { baseDate, baseTime } = getKmaBaseDateTime();
  
  // API key should be used as-is (Encoding key from data.go.kr is already URL-encoded)
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${apiKey}&numOfRows=300&pageNo=1&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${nx}&ny=${ny}`;
  console.log(`KMA API call: base_date=${baseDate}, base_time=${baseTime}, nx=${nx}, ny=${ny}`);
  
  const res = await fetch(url);
  const text = await res.text();
  
  try {
    const data = JSON.parse(text);
    const header = data?.response?.header;
    if (header?.resultCode !== '00') {
      console.error("KMA API error:", header?.resultMsg, header?.resultCode);
      return null;
    }
    const items = data?.response?.body?.items?.item;
    if (!items || items.length === 0) {
      console.error("KMA: no items returned");
      return null;
    }
    return parseKmaItems(items);
  } catch (e) {
    console.error("KMA parse error:", e, text.substring(0, 200));
    return null;
  }
}

function parseKmaItems(items: any[]) {
  // Group by fcstDate+fcstTime
  const timeMap: Record<string, Record<string, string>> = {};
  for (const item of items) {
    const key = `${item.fcstDate}_${item.fcstTime}`;
    if (!timeMap[key]) timeMap[key] = { fcstDate: item.fcstDate, fcstTime: item.fcstTime };
    timeMap[key][item.category] = item.fcstValue;
  }

  const slots = Object.values(timeMap).sort((a, b) => 
    (a.fcstDate + a.fcstTime).localeCompare(b.fcstDate + b.fcstTime)
  );

  if (slots.length === 0) return null;

  // First slot = current/nearest forecast
  const first = slots[0];
  const temp = parseFloat(first.TMP || first.T1H || '0');
  const windSpeed = parseFloat(first.WSD || '0');
  const humidity = parseInt(first.REH || '0');
  const sky = parseInt(first.SKY || '1'); // 1=맑음, 3=구름많음, 4=흐림
  const pty = parseInt(first.PTY || '0'); // 0=없음,1=비,2=비/눈,3=눈,4=소나기
  const rn1 = first.RN1 || first.PCP || '0';
  const sno = first.SNO || '0';
  const vec = parseFloat(first.VEC || '0');
  const uuu = parseFloat(first.UUU || '0');
  const vvv = parseFloat(first.VVV || '0');

  // Map PTY to weather main
  let main = 'Clear';
  let description = '맑음';
  if (pty === 1 || pty === 5) { main = 'Rain'; description = '비'; }
  else if (pty === 2 || pty === 6) { main = 'Rain'; description = '비/눈'; }
  else if (pty === 3 || pty === 7) { main = 'Snow'; description = '눈'; }
  else if (pty === 4) { main = 'Rain'; description = '소나기'; }
  else if (sky === 4) { main = 'Clouds'; description = '흐림'; }
  else if (sky === 3) { main = 'Clouds'; description = '구름많음'; }
  else { main = 'Clear'; description = '맑음'; }

  const rain1h = rn1 === '강수없음' || rn1 === '0' ? 0 : parseFloat(rn1.replace('mm', '')) || 0;
  const snow1h = sno === '적설없음' || sno === '0' ? 0 : parseFloat(sno.replace('cm', '')) || 0;

  const current = {
    temp: Math.round(temp),
    feels_like: Math.round(temp), // KMA doesn't provide feels_like directly
    humidity,
    wind_speed: windSpeed,
    wind_deg: vec,
    wind_gust: 0,
    description,
    icon: sky <= 2 ? '01d' : sky === 3 ? '03d' : '04d',
    main,
    rain_1h: rain1h,
    snow_1h: snow1h,
    visibility: 10000,
    clouds: sky === 1 ? 0 : sky === 3 ? 60 : sky === 4 ? 90 : 20,
    pressure: 0,
    dt: Math.floor(Date.now() / 1000),
    city: '',
    sunrise: 0,
    sunset: 0,
  };

  // Build hourly from slots
  const hourly = slots.slice(0, 16).map(s => {
    const sTemp = parseFloat(s.TMP || s.T1H || '0');
    const sPty = parseInt(s.PTY || '0');
    const sSky = parseInt(s.SKY || '1');
    const sWsd = parseFloat(s.WSD || '0');
    const sRn = s.RN1 || s.PCP || '0';
    const sRain = sRn === '강수없음' || sRn === '0' ? 0 : parseFloat(sRn.replace('mm', '')) || 0;
    const sSno = s.SNO || '0';
    const sSnow = sSno === '적설없음' || sSno === '0' ? 0 : parseFloat(sSno.replace('cm', '')) || 0;
    let sMain = 'Clear';
    if (sPty >= 1) sMain = sPty === 3 || sPty === 7 ? 'Snow' : 'Rain';
    else if (sSky >= 4) sMain = 'Clouds';
    else if (sSky >= 3) sMain = 'Clouds';

    const dateStr = s.fcstDate;
    const timeStr = s.fcstTime;
    const dt = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T${timeStr.slice(0,2)}:${timeStr.slice(2,4)}:00+09:00`).getTime() / 1000;

    return {
      dt,
      temp: Math.round(sTemp),
      feels_like: Math.round(sTemp),
      humidity: parseInt(s.REH || '0'),
      wind_speed: sWsd,
      wind_gust: 0,
      rain: sRain,
      snow: sSnow,
      description: '',
      icon: sSky <= 2 ? '01d' : '04d',
      main: sMain,
      pop: parseFloat(s.POP || '0') / 100,
    };
  });

  // Aggregate daily
  const dailyMap: Record<string, any> = {};
  for (const s of slots) {
    const date = `${s.fcstDate.slice(0,4)}-${s.fcstDate.slice(4,6)}-${s.fcstDate.slice(6,8)}`;
    const sTemp = parseFloat(s.TMP || s.T1H || '0');
    const sWsd = parseFloat(s.WSD || '0');
    const sPop = parseFloat(s.POP || '0');
    const sRn = s.RN1 || s.PCP || '0';
    const sRain = sRn === '강수없음' || sRn === '0' ? 0 : parseFloat(sRn.replace('mm', '')) || 0;
    
    if (!dailyMap[date]) {
      dailyMap[date] = { date, temp_min: sTemp, temp_max: sTemp, wind_max: sWsd, wind_gust_max: 0, rain_total: 0, snow_total: 0, pop_max: 0, icon: '01d', main: 'Clear', description: '' };
    }
    const d = dailyMap[date];
    d.temp_min = Math.min(d.temp_min, sTemp);
    d.temp_max = Math.max(d.temp_max, sTemp);
    d.wind_max = Math.max(d.wind_max, sWsd);
    d.rain_total += sRain;
    d.pop_max = Math.max(d.pop_max, sPop);
  }
  const daily = Object.values(dailyMap).map((d: any) => ({
    ...d,
    temp_min: Math.round(d.temp_min),
    temp_max: Math.round(d.temp_max),
    rain_total: Math.round(d.rain_total * 10) / 10,
    pop_max: Math.round(d.pop_max),
  }));

  return { current, hourly, daily };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { project_id, lat, lng, address, source } = body;

    if (!project_id) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kmaKey = Deno.env.get("KMA_API_KEY");
    const owKey = Deno.env.get("OPENWEATHER_API_KEY");
    
    if (!kmaKey && !owKey) {
      return new Response(JSON.stringify({ error: "날씨 API 키가 설정되지 않았습니다" }), {
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
    let resolvedCity = "";

    // If address provided but no coordinates, geocode it using OpenWeather (free geocoding)
    if (address && (!resolvedLat || !resolvedLng) && owKey) {
      try {
        const geoRes = await fetch(
          `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(address)}&limit=1&appid=${owKey}`
        );
        const geoData = await geoRes.json();
        console.log("Geocoding result:", JSON.stringify(geoData));
        if (geoData && geoData.length > 0) {
          resolvedLat = geoData[0].lat;
          resolvedLng = geoData[0].lon;
          resolvedCity = geoData[0].local_names?.ko || geoData[0].name || "";
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
      resolvedCity = "서울";
    }

    // Check cache
    const cacheType = (source === 'openweather') ? 'openweather' : 'kma';
    const { data: cached } = await supabase
      .from("weather_cache")
      .select("data, fetched_at")
      .eq("project_id", project_id)
      .eq("cache_type", cacheType)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();

    if (cached && cached.data && (cached.data as any)?.current?.temp !== undefined) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < CACHE_DURATION_MS) {
        console.log("Returning cached weather data, source:", cacheType);
        return new Response(JSON.stringify(cached.data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let result: any = null;

    // === Primary: KMA (날씨누리) ===
    if (source !== 'openweather' && kmaKey) {
      console.log("Fetching from KMA (기상청)...");
      const kmaData = await fetchKmaWeather(resolvedLat, resolvedLng, kmaKey);
      if (kmaData) {
        // Enrich with OpenWeather data if available (pressure, sunrise/sunset, city name)
        let owEnrich: any = null;
        if (owKey) {
          try {
            const owUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${resolvedLat}&lon=${resolvedLng}&appid=${owKey}&units=metric&lang=kr`;
            const owRes = await fetch(owUrl);
            owEnrich = await owRes.json();
          } catch (e) {
            console.error("OpenWeather enrich error:", e);
          }
        }
        
        if (owEnrich && owEnrich.cod === 200) {
          kmaData.current.pressure = owEnrich.main?.pressure || 0;
          kmaData.current.sunrise = owEnrich.sys?.sunrise || 0;
          kmaData.current.sunset = owEnrich.sys?.sunset || 0;
          kmaData.current.city = owEnrich.name || resolvedCity;
          kmaData.current.visibility = owEnrich.visibility || 10000;
          kmaData.current.wind_gust = owEnrich.wind?.gust || 0;
          kmaData.current.feels_like = Math.round(owEnrich.main?.feels_like || kmaData.current.temp);
        } else {
          kmaData.current.city = resolvedCity;
        }
        
        const alerts = generateSafetyAlerts(kmaData.current, kmaData.hourly, kmaData.daily);
        const typhoon = detectTyphoonRisk(kmaData.current, kmaData.hourly);
        
        result = {
          ...kmaData,
          alerts,
          typhoon,
          source: 'kma',
          source_label: '기상청 (날씨누리)',
          resolved_location: {
            lat: resolvedLat,
            lng: resolvedLng,
            city: kmaData.current.city || resolvedCity,
            address: address || '',
          },
          fetched_at: new Date().toISOString(),
        };
      }
    }

    // === Fallback or explicit OpenWeather ===
    if (!result) {
      if (!owKey) {
        return new Response(JSON.stringify({ error: "OpenWeather API 키가 설정되지 않았습니다" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log("Fetching from OpenWeather...");
      const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${resolvedLat}&lon=${resolvedLng}&appid=${owKey}&units=metric&lang=kr`;
      const currentRes = await fetch(currentUrl);
      const currentData = await currentRes.json();

      if (currentData.cod && currentData.cod !== 200) {
        return new Response(JSON.stringify({ error: `OpenWeather API error: ${currentData.message}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${resolvedLat}&lon=${resolvedLng}&appid=${owKey}&units=metric&lang=kr`;
      const forecastRes = await fetch(forecastUrl);
      const forecastData = await forecastRes.json();

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

      const dailyMap: Record<string, any> = {};
      (forecastData.list || []).forEach((item: any) => {
        const date = new Date(item.dt * 1000).toISOString().split("T")[0];
        if (!dailyMap[date]) {
          dailyMap[date] = { date, temp_min: item.main.temp_min, temp_max: item.main.temp_max, wind_max: item.wind?.speed ?? 0, wind_gust_max: item.wind?.gust ?? 0, rain_total: 0, snow_total: 0, pop_max: 0, icon: item.weather?.[0]?.icon ?? "01d", main: item.weather?.[0]?.main ?? "", description: item.weather?.[0]?.description ?? "" };
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

      const alerts = generateSafetyAlerts(current, hourly, daily);
      const typhoon = detectTyphoonRisk(current, hourly);

      result = {
        current,
        hourly,
        daily,
        alerts,
        typhoon,
        source: 'openweather',
        source_label: 'OpenWeather',
        resolved_location: {
          lat: resolvedLat,
          lng: resolvedLng,
          city: current.city || resolvedCity,
          address: address || '',
        },
        fetched_at: new Date().toISOString(),
      };
    }

    // Add lat/lng to current if not present
    if (result.current && !result.current.lat) {
      result.current.lat = resolvedLat;
      result.current.lng = resolvedLng;
    }

    // Cache
    if (result.current.temp !== 0 || result.current.description !== "") {
      await supabase
        .from("weather_cache")
        .upsert(
          { project_id, cache_type: cacheType, data: result, fetched_at: new Date().toISOString() },
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

  if (current.wind_speed >= 15 || current.wind_gust >= 20) {
    alerts.push({ level: "danger", title: "강풍 경보", description: `풍속 ${current.wind_speed}m/s (순간 ${current.wind_gust}m/s) — 양중/크레인 작업 금지 권고`, icon: "wind", category: "wind" });
  } else if (current.wind_speed >= 10 || current.wind_gust >= 15) {
    alerts.push({ level: "warning", title: "강풍 주의", description: `풍속 ${current.wind_speed}m/s — 크레인 작업 제한`, icon: "wind", category: "wind" });
  }

  if (current.temp >= 35) {
    alerts.push({ level: "danger", title: "극심 폭염", description: `기온 ${current.temp}°C — 옥외 작업 전면 중지 권고`, icon: "thermometer", category: "heat" });
  } else if (current.temp >= 33) {
    alerts.push({ level: "danger", title: "폭염 경보", description: `기온 ${current.temp}°C — 옥외 작업 제한, 휴식 필수`, icon: "thermometer", category: "heat" });
  } else if (current.temp >= 30) {
    alerts.push({ level: "warning", title: "고온 주의", description: `기온 ${current.temp}°C — 충분한 수분 섭취 권고`, icon: "thermometer", category: "heat" });
  }

  if (current.temp <= -10) {
    alerts.push({ level: "danger", title: "한파 경보", description: `기온 ${current.temp}°C — 동파 및 저체온 위험`, icon: "snowflake", category: "cold" });
  } else if (current.temp <= 0) {
    alerts.push({ level: "warning", title: "결빙 주의", description: `기온 ${current.temp}°C — 미끄럼/결빙 위험`, icon: "snowflake", category: "cold" });
  }

  if (current.rain_1h >= 30) {
    alerts.push({ level: "danger", title: "호우 경보", description: `시간당 강수량 ${current.rain_1h}mm — 작업 중지`, icon: "rain", category: "rain" });
  } else if (current.rain_1h >= 10) {
    alerts.push({ level: "warning", title: "강우 주의", description: `시간당 강수량 ${current.rain_1h}mm — 토공 작업 지연 위험`, icon: "rain", category: "rain" });
  } else if (current.rain_1h > 0 || current.main === "Rain" || current.main === "Drizzle") {
    alerts.push({ level: "caution", title: "강수 중", description: "토공/콘크리트 작업 지연 위험", icon: "rain", category: "rain" });
  }

  if (current.snow_1h > 0 || current.main === "Snow") {
    alerts.push({ level: "warning", title: "적설 주의", description: `적설 ${current.snow_1h}mm — 미끄럼 방지`, icon: "snowflake", category: "snow" });
  }

  if (current.visibility < 200) {
    alerts.push({ level: "danger", title: "시정 불량 경보", description: `시정 ${current.visibility}m — 작업 중지 권고`, icon: "fog", category: "visibility" });
  } else if (current.visibility < 1000) {
    alerts.push({ level: "warning", title: "안개/시정 주의", description: `시정 ${current.visibility}m`, icon: "fog", category: "visibility" });
  }

  if (current.main === "Thunderstorm") {
    alerts.push({ level: "danger", title: "낙뢰 경보", description: "번개/낙뢰 감지 — 옥외 작업 즉시 중지", icon: "lightning", category: "lightning" });
  }

  if (current.pressure > 0 && current.pressure < 990) {
    alerts.push({ level: "danger", title: "태풍/저기압 접근", description: `기압 ${current.pressure}hPa`, icon: "typhoon", category: "typhoon" });
  } else if (current.pressure > 0 && current.pressure < 1000) {
    alerts.push({ level: "warning", title: "저기압 주의", description: `기압 ${current.pressure}hPa`, icon: "typhoon", category: "pressure" });
  }

  // Future conditions
  const futureSlice = hourly.slice(0, 4);
  if (futureSlice.length > 0) {
    const maxFutureWind = Math.max(...futureSlice.map((h: any) => h.wind_speed));
    const futureRain = futureSlice.some((h: any) => h.rain > 0 || h.main === "Rain");
    const futureThunder = futureSlice.some((h: any) => h.main === "Thunderstorm");
    const maxFutureTemp = Math.max(...futureSlice.map((h: any) => h.temp));

    if (maxFutureWind >= 10 && current.wind_speed < 10) {
      alerts.push({ level: "caution", title: "풍속 상승 예보", description: `향후 풍속 최대 ${maxFutureWind.toFixed(1)}m/s 예상`, icon: "wind", category: "forecast" });
    }
    if (futureRain && current.rain_1h === 0 && current.main !== "Rain") {
      alerts.push({ level: "caution", title: "강수 예보", description: "향후 비 예보 — 일정 조정 필요", icon: "rain", category: "forecast" });
    }
    if (futureThunder && current.main !== "Thunderstorm") {
      alerts.push({ level: "warning", title: "낙뢰 예보", description: "향후 뇌우 예보", icon: "lightning", category: "forecast" });
    }
    if (maxFutureTemp >= 33 && current.temp < 33) {
      alerts.push({ level: "caution", title: "폭염 예보", description: `향후 기온 ${maxFutureTemp}°C 예상`, icon: "thermometer", category: "forecast" });
    }
  }

  if (alerts.length === 0) {
    alerts.push({ level: "safe", title: "안전 양호", description: "현재 기상 조건에 특별한 위험 요소가 없습니다", icon: "check", category: "safe" });
  }

  return alerts;
}

function detectTyphoonRisk(current: any, hourly: any[]) {
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

  return { risk, message, pressure, wind_speed: windSpeed, wind_gust: gustSpeed };
}
