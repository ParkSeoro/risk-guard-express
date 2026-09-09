# 위험구역 2단화 + 위치 신뢰도 표시 — 작업 지시서

> 배경 분석: [`gps-tracking-diagnosis.md`](./gps-tracking-diagnosis.md) · [`gps-map-calibration-design.md`](./gps-map-calibration-design.md)
> 사용법: 아래 프롬프트를 커서에 붙여넣습니다.

---

## 왜 이걸 하는가

현장 위치가 안 맞는 건 코드 결함이 아니라 **물리적 한계**입니다.

| 환경 | 실제 GPS 오차 |
|------|--------------|
| 개활지 | 3~10m |
| 철골·타워크레인·거푸집 근처 | 20~50m (다중경로) |
| 구조물 내부·지하 | 사용 불가 |

문제의 핵심은 **다중경로**입니다. 신호가 철골에 반사돼 들어오면 폰은 그걸 정상 신호로 착각하고, **그러면서도 `accuracy`는 "10m"라고 보고합니다.** 지금 코드가 정확도 임계값(40/55/100m)으로 걸러내지만 기준값 자체가 신뢰할 수 없습니다.

그리고 워킹 보정(`fitAffineFromControlPoints`)은 **도면을 GPS에 맞추는 것**이지 GPS를 정확하게 만드는 게 아닙니다. 다중경로는 위치마다 다르고 무작위라 보정으로 못 없앱니다.

**결론**: 미터급 실시간 침입 감지는 폰 GNSS로 불가능합니다. 그래서 두 가지를 합니다.

1. **오차를 설계로 흡수** — 구역을 2단(완충대 + 핵심부)으로
2. **오차를 숨기지 않고 표시** — 위치 신뢰도를 사용자에게

> 이건 근본 해결이 아니라 **비콘 도입 전까지의 완화책**입니다. "접근 경고"이지 "침입 경보"가 아니라는 걸 제품 사양으로 명확히 하고 시작하십시오.

---

## 설계 요약

```
      ┌─────────────────────────┐
      │  완충대 (진동 + 배너)      │  ← 경계에서 바깥 buffer_m
      │   ┌──────────────────┐   │
      │   │  핵심부 (사이렌)    │   │  ← 지금 그려둔 구역 그대로
      │   └──────────────────┘   │
      └─────────────────────────┘
```

- **핵심부** = 지금 동작 그대로. 사이렌·TTS·전체화면 모달. **변경 없음**
- **완충대** = 새로 추가. 진동 1회 + 상단 배너. **사이렌 없음**

핵심 원칙: 완충대는 **조용해야 합니다.** 구역 근처에서 하루 종일 일하는 근로자에게 사이렌을 계속 울리면 알람을 무시하게 됩니다.

---

## 프롬프트 1 — 위험구역 2단화

```
risk-guard-express 의 위험구역을 2단(완충대 + 핵심부)으로 확장해줘.
배경은 docs/gps-two-tier-zone-prompts.md 를 먼저 읽어봐.

이 시스템은 건설현장 중장비 접근 경보를 담당해. 안전 관련 코드이니
확신이 없으면 임의 판단하지 말고 나에게 먼저 물어봐.

═══ 목표 ═══
현장 GPS 오차(20~50m)를 구역 설계로 흡수한다.
- 핵심부(지금 그려둔 구역) 진입 → 사이렌. 기존 동작 그대로, 절대 건드리지 말 것
- 완충대(경계에서 바깥 buffer_m) 진입 → 조용한 접근 경고(진동 + 배너). 사이렌 금지

═══ 작업 1 · 마이그레이션 ═══
supabase/migrations/ 에 새 파일 (기존 명명 규칙: 날짜_설명.sql)

  ALTER TABLE public.restricted_zones
    ADD COLUMN IF NOT EXISTS buffer_m numeric NULL;

  -- 오타 하나가 현장 전체를 경고 구역으로 만들지 않도록 상한
  ALTER TABLE public.restricted_zones
    ADD CONSTRAINT restricted_zones_buffer_m_range
    CHECK (buffer_m IS NULL OR (buffer_m >= 0 AND buffer_m <= 200));

  COMMENT ON COLUMN public.restricted_zones.buffer_m IS
    '완충대 폭(m). 경계에서 바깥으로 이 거리 안이면 접근 경고(사이렌 아님). NULL=기본 25m, 0=완충대 없음';

의미: NULL = 클라이언트 기본값 25m, 0 = 완충대 없음(기존 동작과 동일)

═══ 작업 2 · 순수 로직 (새 파일) ═══
src/lib/tracking/zoneProximity.ts

먼저 src/lib/tracking/restrictedZoneGeom.ts 에서 단일 구역까지의 거리를 구하는
함수를 export 로 뽑아줘. 지금은 minDistanceToRestrictedZoneEdge 안에 인라인으로
들어가 있어서 재사용이 안 돼:

  export function distanceToZoneEdgeM(lat, lng, zone): number
  // 구역 안이면 0, 밖이면 경계까지 거리, 지오메트리 없으면 +Infinity
  // 폴리곤은 이미 있는 distanceToPolygonEdgeM(점-선분 거리)을 쓸 것

그리고 minDistanceToRestrictedZoneEdge 를 이 함수 기반으로 재작성해서
로직이 두 벌 존재하지 않게 해줘. 기존 테스트가 통과해야 해.

그 다음 zoneProximity.ts 에:

  export const ZONE_BUFFER_DEFAULT_M = 25;
  export const ZONE_BUFFER_MAX_M = 200;   // 마이그레이션 CHECK 와 같은 값

  export type ZoneTier = "core" | "buffer" | "outside";

  export function zoneBufferM(zone): number
  // buffer_m 이 null/undefined → DEFAULT, 0 이하 → 0, 그 외 MAX 로 clamp

  export function classifyZoneTier(lat, lng, zone): { tier, distanceM }

  export function findZoneProximity(lat, lng, zones, subject): {
    zone, tier: "core" | "buffer", distanceM
  } | null
  // core 가 buffer 보다 항상 우선. 같은 tier 면 가까운 구역이 이김
  // is_active === false 는 건너뜀
  // isSubjectBanned 로 대상자 아니면 건너뜀 (기존 로직 재사용)

RestrictedZoneGeom 타입에 buffer_m?: number | null 추가.

═══ 작업 3 · 정확도 임계값 ═══
src/lib/tracking/siteTrackBounds.ts 에 추가:

  export const ZONE_APPROACH_MAX_ACCURACY_M = 60;  // 완충대는 사이렌(40m)보다 관대
  export const ZONE_APPROACH_EXIT_STREAK = 2;       // 깜빡임 방지

완충대가 더 관대한 이유: 애매한 위치에서 조용한 배너를 띄우는 건 값이 싸지만
사이렌을 울리는 건 비싸. 기존 SIREN_MAX_ACCURACY_M = 40 은 건드리지 마.

═══ 작업 4 · 배너 UI (새 파일) ═══
src/components/geofence/ZoneApproachBanner.tsx

- 상단 고정 배너. 전체화면 모달 아님
- 진동 짧게 1회 (navigator.vibrate) — 구역당 1회지 GPS 픽스마다가 아님
- 사이렌·TTS 절대 금지 (DangerZoneAlertModal 의 playDangerAlarm 계열 쓰지 마)
- 문구: "위험구역 접근 · 약 12m 앞" + 구역명 + "출입 전 관리감독자에게 확인하세요"
- 닫기 버튼. 닫으면 그 구역을 벗어날 때까지 다시 안 뜸
- role="status" aria-live="polite", 키보드 포커스 표시

═══ 작업 5 · 연결 ═══
src/components/geofence/ShellGeofenceAlerts.tsx

- restricted_zones select 문에 buffer_m 컬럼 추가 (지금 컬럼을 명시 나열하고 있음)
- 메인 판정 effect 에서 완충대 판정을 추가. 단 기존 사이렌 경로
  (findViolatingRestrictedZone + 서버 veto + nextSirenHysteresis)는 그대로 두고
  완충대는 별도 상태로 관리해줘
- 사이렌이 떠 있으면 배너는 숨김 (둘이 겹치면 안 됨)
- 현장 밖(shouldSuppressLocalSirenOffsite)이면 배너도 함께 해제

═══ 작업 6 · 구역 편집 UI ═══
src/pages/RestrictedZones.tsx 에 완충대(m) 입력 추가
- 반경/폴리곤 둘 다에 적용되니 지오메트리 분기 밖에 배치
- 기본값 25, 0~200 검증
- 도움말 문구: 현장 GPS 오차가 보통 20~50m라 기본 25m 권장,
  0을 넣으면 완충대 없이 사이렌만 사용한다는 설명

═══ 작업 7 · 테스트 ═══
src/test/zoneProximity.test.ts (vitest, 기존 스타일 참고)
최소 이 케이스들:
- buffer_m null → 기본 25m / 0 → 완충대 없음 / 과대값 → 200 clamp
- 구역 안 = core, 경계 밖 10m = buffer, 100m = outside
- core 가 buffer 보다 우선 (더 가까운 buffer 구역이 있어도)
- 대상자 아니면 null, 비활성 구역이면 null

═══ 마무리 ═══
- bun run test 통과 확인. 기준선은 1385 통과 / 2 실패
  (실패 2건은 Capacitor 패키지 미설치로 인한 기존 환경 문제)
- 작업 1~7 을 하나씩 하고 각 단계마다 diff 를 보여줘
- 기존 사이렌 동작이 바뀌지 않았다는 걸 어떻게 확인했는지 알려줘
```

---

## 프롬프트 2 — 위치 신뢰도 표시

```
risk-guard-express 에 GPS 위치 신뢰도 표시를 추가해줘.

═══ 왜 ═══
지금은 GPS 정확도가 나쁘면 조용히 무시해. 그래서 근로자도 관리자도
"왜 알림이 안 오지?" 를 알 방법이 없어. 침묵 대신 상태를 보여줘야 해.

정확도 표시 코드는 이미 있는데 관리자 화면에만 있어
(MobileGeofenceDrop.tsx, MobileMapCalibration.tsx). 근로자 셸에는 없어.

═══ 작업 ═══
src/lib/tracking/gpsStatusUi.tsx

1. GpsUiState 에 accuracyM?: number | null 추가
   (GpsUiProvider 의 useMemo 의존성 배열에도 넣을 것 — 빠뜨리면 갱신 안 됨)

2. 신뢰도 구간 함수 추가:
     export type GpsQuality = "good" | "fair" | "poor" | "unknown";
     good  ≤ 20m
     fair  ≤ 40m
     poor  > 40m
     unknown = 값 없음/NaN  ← 이걸 good 으로 취급하면 안 됨

3. GpsStatusChip 이 accuracyM 을 받아서:
   - good  → 지금처럼 "GPS 현장" (초록)
   - fair  → "GPS 보통" (연한 호박색)
   - poor  → "GPS 불량" (호박색)
   - title 툴팁에 "±32m" 처럼 실제 값과 사유를 넣어줘
     (poor 문구 예: "구조물·실내 영향으로 위치가 부정확합니다.
      위험구역 경고가 늦을 수 있습니다")
   - data-gps-quality 속성을 붙여서 E2E 에서 잡을 수 있게

4. 배선:
   - src/components/worker/WorkerGlobalGps.tsx 가 useSystemRealtime() 에서
     lastGpsFix 를 받아 setGpsUi 에 accuracyM 을 넘기게
   - src/components/mobile/MobileShell.tsx 의 <GpsStatusChip> 에 accuracyM 전달

5. 테스트: gpsQualityOf 구간 판정 + null/NaN 이 unknown 인지

═══ 주의 ═══
- 이건 표시일 뿐이야. 경보 판정 로직(SIREN_MAX_ACCURACY_M 등)은 건드리지 마
- 색만으로 구분하지 말고 반드시 텍스트 라벨도 함께 (색각 이상 고려)
```

---

## 이 작업으로 해결되지 않는 것

명확히 해두어야 혼선이 없습니다.

| 항목 | 상태 |
|------|------|
| 미터급 실시간 침입 감지 | ❌ 여전히 불가. 비콘 필요 |
| 구조물 내부·지하 측위 | ❌ 여전히 불가 |
| iOS 화면 꺼짐 시 추적 | ❌ 플랫폼 제약. 비콘(iBeacon 리전)으로만 우회 가능 |
| 근로자가 몰래 들어가는 것 | ❌ 완충대는 경고이지 통제가 아님 |

**다음 단계 판단 기준**: 완충대를 몇 달 운영해 보고 "경고가 떠도 그냥 들어가는 사고가 실제로 나는가"를 확인한 뒤, 그때 비콘 투자를 결정하십시오.
