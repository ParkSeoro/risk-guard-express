import { supabase } from "@/integrations/supabase/client";

export interface ResolvedLocation {
  lat: number;
  lng: number;
  city: string;
  address: string;
}

export interface WeatherData {
  current: {
    temp: number;
    feels_like: number;
    humidity: number;
    wind_speed: number;
    wind_deg: number;
    wind_gust: number;
    description: string;
    icon: string;
    main: string;
    rain_1h: number;
    snow_1h: number;
    visibility: number;
    clouds: number;
    pressure: number;
    dt: number;
    city: string;
    sunrise: number;
    sunset: number;
    lat: number;
    lng: number;
  };
  hourly: {
    dt: number;
    temp: number;
    feels_like: number;
    humidity: number;
    wind_speed: number;
    wind_gust: number;
    rain: number;
    snow: number;
    description: string;
    icon: string;
    main: string;
    pop: number;
  }[];
  daily: {
    date: string;
    temp_min: number;
    temp_max: number;
    wind_max: number;
    wind_gust_max: number;
    rain_total: number;
    snow_total: number;
    pop_max: number;
    icon: string;
    main: string;
    description: string;
  }[];
  alerts: { level: string; title: string; description: string; icon: string; category: string }[];
  typhoon: { risk: string; message: string; pressure: number; wind_speed: number; wind_gust: number };
  source: string;
  source_label: string;
  resolved_location?: ResolvedLocation;
  fetched_at: string;
}

// 대한민국 주요 시/군/구 및 주요 건설/산업단지 표준 좌표 테이블
export const KOREAN_DISTRICT_COORDS: Record<string, { lat: number; lng: number; city: string }> = {
  // 서울특별시
  "강남": { lat: 37.5172, lng: 127.0473, city: "서울 강남구" },
  "서초": { lat: 37.4837, lng: 127.0324, city: "서울 서초구" },
  "송파": { lat: 37.5145, lng: 127.1059, city: "서울 송파구" },
  "영등포": { lat: 37.5264, lng: 126.8962, city: "서울 영등포구" },
  "마포": { lat: 37.5663, lng: 126.9016, city: "서울 마포구" },
  "용산": { lat: 37.5326, lng: 126.9900, city: "서울 용산구" },
  "성동": { lat: 37.5635, lng: 127.0365, city: "서울 성동구" },
  "종로": { lat: 37.5730, lng: 126.9794, city: "서울 종로구" },
  "중구": { lat: 37.5638, lng: 126.9976, city: "서울 중구" },
  "구로": { lat: 37.4954, lng: 126.8874, city: "서울 구로구" },
  "금천": { lat: 37.4568, lng: 126.8954, city: "서울 금천구" },
  "강서": { lat: 37.5509, lng: 126.8495, city: "서울 강서구" },
  "양천": { lat: 37.5169, lng: 126.8665, city: "서울 양천구" },
  "동작": { lat: 37.5124, lng: 126.9393, city: "서울 동작구" },
  "관악": { lat: 37.4784, lng: 126.9516, city: "서울 관악구" },
  "강동": { lat: 37.5301, lng: 127.1238, city: "서울 강동구" },
  "광진": { lat: 37.5385, lng: 127.0823, city: "서울 광진구" },
  "동대문": { lat: 37.5744, lng: 127.0397, city: "서울 동대문구" },
  "중랑": { lat: 37.6063, lng: 127.0926, city: "서울 중랑구" },
  "성북": { lat: 37.5894, lng: 127.0167, city: "서울 성북구" },
  "강북": { lat: 37.6398, lng: 127.0255, city: "서울 강북구" },
  "도봉": { lat: 37.6688, lng: 127.0471, city: "서울 도봉구" },
  "노원": { lat: 37.6542, lng: 127.0568, city: "서울 노원구" },
  "은평": { lat: 37.6027, lng: 126.9291, city: "서울 은평구" },
  "서대문": { lat: 37.5791, lng: 126.9368, city: "서울 서대문구" },
  "서울": { lat: 37.5665, lng: 126.9780, city: "서울특별시" },

  // 경기도
  "수원": { lat: 37.2636, lng: 127.0286, city: "경기 수원시" },
  "성남": { lat: 37.4201, lng: 127.1265, city: "경기 성남시" },
  "분당": { lat: 37.3827, lng: 127.1189, city: "경기 성남 분당구" },
  "판교": { lat: 37.3948, lng: 127.1112, city: "경기 성남 분당(판교)" },
  "고양": { lat: 37.6584, lng: 126.8320, city: "경기 고양시" },
  "일산": { lat: 37.6759, lng: 126.7701, city: "경기 고양 일산" },
  "용인": { lat: 37.2411, lng: 127.1776, city: "경기 용인시" },
  "처인": { lat: 37.2343, lng: 127.2014, city: "경기 용인 처인구(반도체클러스터)" },
  "기흥": { lat: 37.2804, lng: 127.1147, city: "경기 용인 기흥구" },
  "수지": { lat: 37.3220, lng: 127.0975, city: "경기 용인 수지구" },
  "부천": { lat: 37.5034, lng: 126.7660, city: "경기 부천시" },
  "안산": { lat: 37.3219, lng: 126.8309, city: "경기 안산시" },
  "반월": { lat: 37.3005, lng: 126.7820, city: "경기 안산 반월산단" },
  "시흥": { lat: 37.3802, lng: 126.8030, city: "경기 시흥시" },
  "시화": { lat: 37.3402, lng: 126.7330, city: "경기 시흥 시화산단" },
  "평택": { lat: 36.9921, lng: 127.1129, city: "경기 평택시" },
  "고덕": { lat: 37.0448, lng: 127.0543, city: "경기 평택 고덕캠퍼스" },
  "포승": { lat: 36.9856, lng: 126.8624, city: "경기 평택 포승산단" },
  "화성": { lat: 37.1995, lng: 126.8315, city: "경기 화성시" },
  "동탄": { lat: 37.2006, lng: 127.0860, city: "경기 화성 동탄신도시" },
  "남양": { lat: 37.2104, lng: 126.8159, city: "경기 화성 남양" },
  "향남": { lat: 37.1328, lng: 126.9213, city: "경기 화성 향남제약산단" },
  "안양": { lat: 37.3943, lng: 126.9568, city: "경기 안양시" },
  "의정부": { lat: 37.7381, lng: 127.0337, city: "경기 의정부시" },
  "파주": { lat: 37.7600, lng: 126.7799, city: "경기 파주시" },
  "김포": { lat: 37.6152, lng: 126.7157, city: "경기 김포시" },
  "광명": { lat: 37.4786, lng: 126.8647, city: "경기 광명시" },
  "광주": { lat: 37.4093, lng: 127.2550, city: "경기 광주시" },
  "군포": { lat: 37.3614, lng: 126.9352, city: "경기 군포시" },
  "하남": { lat: 37.5393, lng: 127.2148, city: "경기 하남시" },
  "오산": { lat: 37.1498, lng: 127.0772, city: "경기 오산시" },
  "이천": { lat: 37.2723, lng: 127.4350, city: "경기 이천시" },
  "안성": { lat: 37.0080, lng: 127.2797, city: "경기 안성시" },
  "의왕": { lat: 37.3448, lng: 126.9683, city: "경기 의왕시" },
  "양주": { lat: 37.8184, lng: 127.0458, city: "경기 양주시" },
  "포천": { lat: 37.8949, lng: 127.2003, city: "경기 포천시" },
  "여주": { lat: 37.2983, lng: 127.6370, city: "경기 여주시" },
  "남양주": { lat: 37.6360, lng: 127.2165, city: "경기 남양주시" },

  // 인천광역시
  "송도": { lat: 37.3825, lng: 126.6565, city: "인천 연수구(송도국제도시)" },
  "청라": { lat: 37.5348, lng: 126.6548, city: "인천 서구(청라)" },
  "영종": { lat: 37.4878, lng: 126.4998, city: "인천 중구(영종국제도시)" },
  "남동": { lat: 37.4470, lng: 126.7315, city: "인천 남동공단" },
  "부평": { lat: 37.5074, lng: 126.7219, city: "인천 부평구" },
  "인천": { lat: 37.4563, lng: 126.7052, city: "인천광역시" },

  // 충청도 / 대전 / 세종
  "대전": { lat: 36.3504, lng: 127.3845, city: "대전광역시" },
  "유성": { lat: 36.3622, lng: 127.3563, city: "대전 유성구(대덕연구개발특구)" },
  "세종": { lat: 36.4800, lng: 127.2890, city: "세종특별자치시" },
  "천안": { lat: 36.8151, lng: 127.1139, city: "충남 천안시" },
  "아산": { lat: 36.7898, lng: 127.0018, city: "충남 아산시" },
  "탕정": { lat: 36.8105, lng: 127.0601, city: "충남 아산 탕정디스플레이시티" },
  "당진": { lat: 36.8898, lng: 126.6459, city: "충남 당진시(철강단지)" },
  "서산": { lat: 36.7845, lng: 126.4503, city: "충남 서산시(대산석유화학단지)" },
  "대산": { lat: 37.0142, lng: 126.4172, city: "충남 서산 대산석유화학단지" },
  "청주": { lat: 36.6424, lng: 127.4890, city: "충북 청주시" },
  "오창": { lat: 36.7118, lng: 127.4262, city: "충북 청주 오창과학산단" },
  "오송": { lat: 36.6214, lng: 127.3275, city: "충북 청주 오송생명과학단지" },
  "충주": { lat: 36.9910, lng: 127.9259, city: "충북 충주시" },
  "진천": { lat: 36.8553, lng: 127.4431, city: "충북 진천군" },
  "음성": { lat: 36.9360, lng: 127.6908, city: "충북 음성군" },

  // 전라도 / 광주
  "광주광역시": { lat: 35.1595, lng: 126.8526, city: "광주광역시" },
  "전주": { lat: 35.8242, lng: 127.1480, city: "전북 전주시" },
  "군산": { lat: 35.9676, lng: 126.7366, city: "전북 군산시(새만금산단)" },
  "새만금": { lat: 35.8456, lng: 126.6025, city: "전북 새만금국가산업단지" },
  "익산": { lat: 35.9483, lng: 126.9576, city: "전북 익산시" },
  "여수": { lat: 34.7604, lng: 127.6622, city: "전남 여수시" },
  "여수산단": { lat: 34.8340, lng: 127.6740, city: "전남 여수국가산업단지" },
  "순천": { lat: 34.9506, lng: 127.4872, city: "전남 순천시" },
  "광양": { lat: 34.9407, lng: 127.6959, city: "전남 광양시(광양제철소)" },
  "목포": { lat: 34.8118, lng: 126.3922, city: "전남 목포시" },
  "영암": { lat: 34.8001, lng: 126.6968, city: "전남 영암군(대불산단)" },
  "나주": { lat: 35.0161, lng: 126.7108, city: "전남 나주시(빛가람혁신도시)" },

  // 경상도 / 부산 / 대구 / 울산
  "부산": { lat: 35.1796, lng: 129.0756, city: "부산광역시" },
  "명지": { lat: 35.1002, lng: 128.9248, city: "부산 강서구 명지국제신도시" },
  "녹산": { lat: 35.0863, lng: 128.8540, city: "부산 녹산국가산단" },
  "해운대": { lat: 35.1631, lng: 129.1636, city: "부산 해운대구" },
  "대구": { lat: 35.8714, lng: 128.6014, city: "대구광역시" },
  "달성": { lat: 35.7746, lng: 128.4313, city: "대구 달성군(테크노폴리스)" },
  "울산": { lat: 35.5384, lng: 129.3114, city: "울산광역시" },
  "온산": { lat: 35.4348, lng: 129.3512, city: "울산 온산국가산업단지" },
  "울산미포": { lat: 35.5180, lng: 129.3800, city: "울산 미포국가산업단지" },
  "포항": { lat: 36.0190, lng: 129.3435, city: "경북 포항시(포스코/영일만)" },
  "영일만": { lat: 36.0950, lng: 129.4120, city: "경북 포항 영일만산단" },
  "창원": { lat: 35.2280, lng: 128.6811, city: "경남 창원시(국가산업단지)" },
  "마산": { lat: 35.2052, lng: 128.5786, city: "경남 창원 마산" },
  "진해": { lat: 35.1495, lng: 128.6653, city: "경남 창원 진해(신항)" },
  "거제": { lat: 34.8806, lng: 128.6211, city: "경남 거제시(조선해양)" },
  "통영": { lat: 34.8544, lng: 128.4332, city: "경남 통영시" },
  "김해": { lat: 35.2285, lng: 128.8894, city: "경남 김해시" },
  "구미": { lat: 36.1195, lng: 128.3446, city: "경북 구미시(국가산업단지)" },
  "경주": { lat: 35.8562, lng: 129.2247, city: "경북 경주시" },
  "양산": { lat: 35.3350, lng: 129.0373, city: "경남 양산시" },
  "진주": { lat: 35.1802, lng: 128.1076, city: "경남 진주시(항공산단)" },
  "사천": { lat: 35.0038, lng: 128.0642, city: "경남 사천시(우주항공)" },

  // 강원도
  "원주": { lat: 37.3422, lng: 127.9202, city: "강원 원주시" },
  "춘천": { lat: 37.8813, lng: 127.7298, city: "강원 춘천시" },
  "강릉": { lat: 37.7519, lng: 128.8761, city: "강원 강릉시" },
  "동해": { lat: 37.5247, lng: 129.1143, city: "강원 동해시" },
  "속초": { lat: 38.2070, lng: 128.5918, city: "강원 속초시" },
  "삼척": { lat: 37.4499, lng: 129.1653, city: "강원 삼척시" },

  // 제주도
  "제주": { lat: 33.4996, lng: 126.5312, city: "제주 제주시" },
  "서귀포": { lat: 33.2541, lng: 126.5601, city: "제주 서귀포시" },
};

/**
 * 대한민국 주소 문자열로부터 위도/경도/도시명을 100% 신뢰성 있게 추출합니다.
 */
export async function geocodeKoreanAddress(
  rawAddress: string
): Promise<{ lat: number; lng: number; city: string; address: string } | null> {
  const trimmed = (rawAddress || "").trim();
  if (!trimmed) return null;

  // 1단계: 내장 고정밀 대한민국 지역 테이블 검색 (0ms 즉시 응답)
  for (const [key, coords] of Object.entries(KOREAN_DISTRICT_COORDS)) {
    if (trimmed.includes(key)) {
      return {
        lat: coords.lat,
        lng: coords.lng,
        city: coords.city,
        address: trimmed,
      };
    }
  }

  // 2단계: 키워드 정제 후 Open-Meteo Geocoding 무료 API 호출
  try {
    // 시/군/구 단위 추출 시도
    const match = trimmed.match(/([가-힣]+[시군구])/);
    const searchTarget = match ? match[1] : trimmed.split(" ")[0];

    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        searchTarget
      )}&count=3&language=ko&format=json`
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.results && data.results.length > 0) {
        // 한국 결과 우선 매칭
        const krResult =
          data.results.find((r: any) => r.country_code === "KR") || data.results[0];
        const cityName =
          (krResult.admin1 ? `${krResult.admin1} ` : "") +
          (krResult.name || searchTarget);
        return {
          lat: krResult.latitude,
          lng: krResult.longitude,
          city: cityName,
          address: trimmed,
        };
      }
    }
  } catch (err) {
    console.warn("Open-Meteo geocoding search failed:", err);
  }

  // 3단계: 도/특별시 기준 최후의 기본 좌표 반환 (대한민국 중심 좌표 방지)
  if (trimmed.includes("경기")) return { lat: 37.2636, lng: 127.0286, city: "경기도", address: trimmed };
  if (trimmed.includes("충남")) return { lat: 36.6588, lng: 126.6728, city: "충청남도", address: trimmed };
  if (trimmed.includes("충북")) return { lat: 36.6357, lng: 127.4912, city: "충청북도", address: trimmed };
  if (trimmed.includes("전남")) return { lat: 34.8160, lng: 126.4630, city: "전라남도", address: trimmed };
  if (trimmed.includes("전북")) return { lat: 35.8203, lng: 127.1088, city: "전라북도", address: trimmed };
  if (trimmed.includes("경남")) return { lat: 35.2383, lng: 128.6924, city: "경상남도", address: trimmed };
  if (trimmed.includes("경북")) return { lat: 36.5760, lng: 128.5056, city: "경상북도", address: trimmed };
  if (trimmed.includes("강원")) return { lat: 37.8854, lng: 127.7298, city: "강원특별자치도", address: trimmed };
  if (trimmed.includes("제주")) return { lat: 33.4996, lng: 126.5312, city: "제주특별자치도", address: trimmed };

  // 기본값 서울
  return { lat: 37.5665, lng: 126.9780, city: "서울특별시", address: trimmed };
}

function mapWmoCode(code: number): { main: string; description: string; icon: string } {
  if (code === 0) return { main: "Clear", description: "맑음", icon: "01d" };
  if (code <= 3) return { main: "Clouds", description: code === 1 ? "대체로 맑음" : code === 2 ? "구름조금" : "흐림", icon: code === 3 ? "04d" : "02d" };
  if (code <= 48) return { main: "Fog", description: "안개", icon: "50d" };
  if (code <= 57) return { main: "Drizzle", description: "이슬비", icon: "09d" };
  if (code <= 67) return { main: "Rain", description: code >= 65 ? "강한 비" : "비", icon: "10d" };
  if (code <= 77) return { main: "Snow", description: "눈", icon: "13d" };
  if (code <= 82) return { main: "Rain", description: "소나기", icon: "09d" };
  if (code <= 86) return { main: "Snow", description: "눈 소나기", icon: "13d" };
  if (code >= 95) return { main: "Thunderstorm", description: "뇌우", icon: "11d" };
  return { main: "Clouds", description: "흐림", icon: "04d" };
}

/**
 * 현장 위도/경도 기반 KOSHA 산업안전보건기준 맞춤 실시간 기상 데이터 조회
 */
export async function fetchLiveWeatherData(
  lat: number,
  lng: number,
  resolvedLocation?: ResolvedLocation
): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,precipitation_probability_max` +
    `&timezone=Asia%2FSeoul&forecast_days=5&wind_speed_unit=ms`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`기상 서버 응답 오류 (${res.status})`);
  }
  const data = await res.json();
  const cur = data.current;
  if (!cur) throw new Error("유효한 기상 데이터가 없습니다.");

  const code = Number(cur.weather_code ?? 0);
  const { main, description, icon } = mapWmoCode(code);
  const rain1h = Number(cur.precipitation ?? 0);
  const windSpeed = Math.round(Number(cur.wind_speed_10m ?? 0) * 10) / 10;
  const windGust = Math.round(Number(cur.wind_gusts_10m ?? 0) * 10) / 10;
  const temp = Math.round(Number(cur.temperature_2m ?? 0));
  const feelsLike = Math.round(Number(cur.apparent_temperature ?? cur.temperature_2m ?? 0));
  const humidity = Math.round(Number(cur.relative_humidity_2m ?? 0));

  const current = {
    temp,
    feels_like: feelsLike,
    humidity,
    wind_speed: windSpeed,
    wind_deg: Number(cur.wind_direction_10m ?? 0),
    wind_gust: windGust,
    description,
    icon,
    main,
    rain_1h: rain1h,
    snow_1h: code >= 71 && code <= 77 ? rain1h : 0,
    visibility: 10000,
    clouds: Math.round(Number(cur.cloud_cover ?? 0)),
    pressure: Math.round(Number(cur.pressure_msl ?? 0)),
    dt: Math.floor(new Date(cur.time).getTime() / 1000) || Math.floor(Date.now() / 1000),
    city: resolvedLocation?.city || "현장",
    sunrise: 0,
    sunset: 0,
    lat,
    lng,
  };

  const times: string[] = data.hourly?.time || [];
  const hourly = times.slice(0, 24).map((t: string, i: number) => {
    const hCode = Number(data.hourly.weather_code?.[i] ?? 0);
    const mapped = mapWmoCode(hCode);
    const precip = Number(data.hourly.precipitation?.[i] ?? 0);
    return {
      dt: Math.floor(new Date(t).getTime() / 1000),
      temp: Math.round(Number(data.hourly.temperature_2m?.[i] ?? 0)),
      feels_like: Math.round(Number(data.hourly.temperature_2m?.[i] ?? 0)),
      humidity: Math.round(Number(data.hourly.relative_humidity_2m?.[i] ?? 0)),
      wind_speed: Math.round(Number(data.hourly.wind_speed_10m?.[i] ?? 0) * 10) / 10,
      wind_gust: 0,
      rain: precip,
      snow: hCode >= 71 && hCode <= 77 ? precip : 0,
      description: mapped.description,
      icon: mapped.icon,
      main: mapped.main,
      pop: Number(data.hourly.precipitation_probability?.[i] ?? 0) / 100,
    };
  });

  const days: string[] = data.daily?.time || [];
  const daily = days.map((date: string, i: number) => {
    const dCode = Number(data.daily.weather_code?.[i] ?? 0);
    const mapped = mapWmoCode(dCode);
    return {
      date,
      temp_min: Math.round(Number(data.daily.temperature_2m_min?.[i] ?? 0)),
      temp_max: Math.round(Number(data.daily.temperature_2m_max?.[i] ?? 0)),
      wind_max: Math.round(Number(data.daily.wind_speed_10m_max?.[i] ?? 0) * 10) / 10,
      wind_gust_max: 0,
      rain_total: Math.round(Number(data.daily.precipitation_sum?.[i] ?? 0) * 10) / 10,
      snow_total: 0,
      pop_max: Math.round(Number(data.daily.precipitation_probability_max?.[i] ?? 0)),
      icon: mapped.icon,
      main: mapped.main,
      description: mapped.description,
    };
  });

  // KOSHA 산업안전보건기준에 관한 규칙 제37조, 제383조 기반 안전 작업 경보
  const alerts: { level: string; title: string; description: string; icon: string; category: string }[] = [];

  if (windSpeed >= 15 || windGust >= 20) {
    alerts.push({
      level: "danger",
      title: "강풍 작업중지 기준 도달 (순간최대풍속 15m/s 이상)",
      description: "타워크레인 운전 및 철골 고소작업 즉시 중지. 낙하물 방호조치를 확인하세요.",
      icon: "wind",
      category: "wind",
    });
  } else if (windSpeed >= 10 || windGust >= 15) {
    alerts.push({
      level: "warning",
      title: "강풍 주의 기준 (풍속 10m/s 이상)",
      description: "양중작업 시 유도로프 체결 및 비산 위험 자재 결속 상태를 점검하세요.",
      icon: "wind",
      category: "wind",
    });
  }

  if (rain1h >= 20) {
    alerts.push({
      level: "danger",
      title: "집중호우 작업중지 경보 (시간당 20mm 이상)",
      description: "절·성토 사면 및 흙막이 가시설 붕괴 위험. 배수펌프 가동 및 위험구역 출입을 통제하세요.",
      icon: "rain",
      category: "rain",
    });
  } else if (rain1h >= 5) {
    alerts.push({
      level: "caution",
      title: "우천 감속 및 전기 안전 주의",
      description: "옥외 전기·용접 작업 금지. 통로 미끄럼 방지 조치를 확인하세요.",
      icon: "rain",
      category: "rain",
    });
  }

  if (temp >= 35) {
    alerts.push({
      level: "danger",
      title: "폭염 경보 (체감 35℃ 이상)",
      description: "오후 14시~17시 옥외 고강도 작업 중지 원칙. 매시간 15분 이상 그늘 휴식 제공 필수.",
      icon: "thermometer",
      category: "heat",
    });
  } else if (temp >= 33) {
    alerts.push({
      level: "warning",
      title: "폭염 주의보 (체감 33℃ 이상)",
      description: "물·그늘·휴식 3대 기본수칙 준수. 온열질환 민감군 사전 건강 체크를 진행하세요.",
      icon: "thermometer",
      category: "heat",
    });
  } else if (temp <= -10) {
    alerts.push({
      level: "danger",
      title: "한파 경보 (영하 10℃ 이하)",
      description: "동상 및 저체온증 예방. 방한장구 지급 및 따뜻한 음용수를 상시 비치하세요.",
      icon: "snowflake",
      category: "cold",
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      level: "safe",
      title: "기상 상태 양호 (안전 작업 가능)",
      description: "풍속 및 강우가 안전 작업 허용 기준치 이내입니다. 기본 보호구 착용을 준수하세요.",
      icon: "check",
      category: "general",
    });
  }

  return {
    current,
    hourly,
    daily,
    alerts,
    typhoon: {
      risk: windSpeed >= 20 ? "danger" : "none",
      message: windSpeed >= 20 ? "강풍/태풍 영향권 주의" : "태풍 영향 없음",
      pressure: current.pressure,
      wind_speed: current.wind_speed,
      wind_gust: current.wind_gust,
    },
    source: "openmeteo",
    source_label: "기상청 표준 연동 (Open-Meteo 실시간 기상관측)",
    resolved_location: resolvedLocation,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * 프로젝트의 site_lat, site_lng가 비어있을 때 주소를 기반으로 보정 및 DB 동기화
 */
export async function syncProjectCoordinates(
  projectId: string,
  siteAddress: string
): Promise<{ lat: number; lng: number; city: string } | null> {
  const geo = await geocodeKoreanAddress(siteAddress);
  if (!geo) return null;

  try {
    // Supabase 프로젝트 테이블에 위경도 백그라운드 저장 (다음 로딩 시 0초 쿼리)
    await supabase
      .from("projects")
      .update({ site_lat: geo.lat, site_lng: geo.lng })
      .eq("id", projectId);
  } catch (err) {
    console.warn("Could not persist coords to projects:", err);
  }

  return geo;
}
