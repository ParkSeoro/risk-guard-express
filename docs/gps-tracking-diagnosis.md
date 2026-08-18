# GPS 추적 계통 진단서

> 작성: 2026-08-18 · 범위: 추적 / 지오펜스 / GPS 출퇴근 / 관제
> 방법: 관련 소스 21개 파일 정독 (코드 수정 없음)

관련 문서: [`gps-map-calibration-design.md`](./gps-map-calibration-design.md) · [`iphone-web-pwa-path.md`](./iphone-web-pwa-path.md) · [`zone-alarm-recipients.md`](./zone-alarm-recipients.md)
후속 작업 지시서: [`gps-tracking-fix-prompts.md`](./gps-tracking-fix-prompts.md)

---

## 0. 요약

“GPS가 불안정하다”의 원인은 **수신 품질이 아니라 설계**입니다.

`fix(gps)` / `fix(geofence)` 커밋이 10건 넘게 누적됐는데도 증상이 재발하는 이유는, 하나의 위치 픽스를 **두 개의 파이프라인이 나르고 두 개의 판정자가 서로 다른 규칙으로 심판**하기 때문입니다. 개별 버그를 하나씩 잡는 방식으로는 수렴하지 않습니다.

| 구분 | 건수 |
|------|------|
| 구조적 결함 | 3 |
| 치명 버그 | 4 |
| 높음 | 5 |
| 중간 | 5 |

가장 시급한 단일 항목은 **F-01 (아침 출근자 GPS 미시작)** 입니다. 오프셋 한 줄 누락으로 06:30–08:00 출근자의 추적이 통째로 시작되지 않습니다.

---

## 1. GPS가 담당하는 업무

GPS는 부가 기능이 아니라 4개 업무의 공통 기반입니다. 한 곳이 흔들리면 4곳이 동시에 흔들립니다.

| 업무 | 경로 |
|------|------|
| **출퇴근** | 현장 펜스 안에서 출근 → `worker_entry_logs` (RPC `worker_gps_daily_lifecycle`이 entry/ack/exit 처리) |
| **추적** | `locationTracker.ts` → `track-location` 엣지 함수 → `worker_last_positions` |
| **경보** | `restricted_zones` 교차 판정 → 위반자 전체화면 사이렌·TTS + 관리자 FCM |
| **관제** | `SiteControlMap` 도면 위 인원 분포 (도면 정합은 워킹 지오레프 + `gps_calibration` 잔여 보정) |

### 현재 픽스 1회가 지나가는 경로

```
                 ┌─ 파이프라인 A ─ watchPosition + 적응주기(5/12/45/180s) ─┐
   GPS 픽스 1회 ─┤                                                          ├─→ track-location ─→ 서버 판정 (정확도 게이트 O)
                 └─ 파이프라인 B ─ 웹워커 고정 15s 틱 (절전정책 무시) ──────┘
                          │
                          └──────────────────────────────→ 클라이언트 판정 (정확도 게이트 X)
```

네이티브 백그라운드 플러그인이 잡히면 파이프라인 B는 생략됩니다.
그러나 **iPhone은 Safari 웹/PWA가 공식 경로**([`iphone-web-pwa-path.md`](./iphone-web-pwa-path.md))이므로 iOS 사용자는 항상 이중 파이프라인으로 동작합니다.

---

## 2. 목표 정의

“정확하게 굴러간다”를 검증 가능한 문장으로 옮긴 것입니다. 이하 모든 진단은 이 4개 기준으로 판단했습니다.

| ID | 목표 | 현재 달성 가능? |
|----|------|-----------------|
| **G1 연속성** | 출근한 근로자는 퇴근까지 끊기지 않고 추적된다 | ✗ — 단방향 종료 래치(F-03) |
| **G2 정직성** | 실제로 들어갔을 때만 울리고, 나왔으면 확실히 꺼진다 | ✗ — 비대칭 경보 게이트(F-02) |
| **G3 지속성** | 하루 8시간 배터리가 버틴다 | ✗ — 이중 파이프라인(S-02) |
| **G4 가시성** | 관리자가 “지금 누가 추적 중인가”를 확인할 수 있다 | ✗ — 하트비트 부재(F-08) |

---

## 3. 구조적 결함

코드 한 줄로 해결되지 않는 항목입니다. GPS 수정이 반복 재발한 근본 원인입니다.

### S-01 · 판정자가 둘이다 (치명)

`src/components/geofence/ShellGeofenceAlerts.tsx:229-250`
`supabase/functions/track-location/index.ts:263-284`

클라이언트는 `findViolatingRestrictedZone()`으로, 서버는 `track-location`이 각각 독립적으로 “위험구역 안인가”를 판정합니다. 문제는 **두 판정자의 규칙이 다르다**는 점입니다.

- 서버: 정확도 100m 초과 픽스 폐기 (`index.ts:137`)
- 클라이언트: 정확도를 아예 보지 않음

→ 화면은 사이렌인데 서버 이벤트는 없거나, 서버는 침입 기록인데 화면은 조용한 상태가 만들어집니다.

**방향**: 최종 판정 권한을 **서버 단일화**. 클라이언트 판정은 “예비 경보(빠른 반응)”로 격하하고 서버 응답이 오면 반드시 덮어씁니다.

### S-02 · 파이프라인이 둘이다 (치명)

`src/providers/SystemRealtimeProvider.tsx:270-293`
`src/lib/tracking/locationTracker.ts:401`

`startTracking()`이 적응형 주기(위험구역 안 5s / 근처 12s / 평상시 45s / 정지 180s)로 절전하는 동안, 같은 화면에서 웹워커가 **조건 없이 15초마다** 별도 측위해 서버로 전송합니다.

- 45s·180s 절전 구간이 15s 틱에 덮여 무효화
- 이 두 번째 경로는 현장 펜스 이탈 검사와 위험구역 근접 판단을 **전부 우회**

**방향**: 웹워커 틱 제거, `startTracking()` 단일 경로로 통일. 백그라운드 지속성은 네이티브 플러그인 쪽에서 해결.

### S-03 · 좌표계가 둘이다 (높음)

`src/lib/tracking/locationTracker.ts:205-211, 234`
`supabase/functions/track-location/index.ts:149-160, 441-454`

현장 펜스 이탈은 **원본 GPS**, 위험구역 판정은 **보정 좌표**로 합니다. 의도된 설계지만 같은 변수명(`lat`/`lng`)으로 두 좌표계가 함수 사이를 오갑니다. 이미 “보정 이중 적용” 버그가 발생해 별도 커밋(`b72cd4c`)으로 수정된 이력이 있습니다.

여기에 더해 **클라이언트는 보정값을 60초 캐시**(`gpsCalibration.ts:91`)하고 **서버는 매 요청 조회**(`index.ts:151-160`)합니다. 재보정 직후 최대 1분간 두 판정자가 다른 좌표계로 동작합니다.

**방향**: 타입 수준 분리(`RawFix` / `AlignedFix`) + 재보정 시 캐시 무효화 브로드캐스트.

---

## 4. 결함 등록부

### F-01 · 아침 출근자는 GPS가 켜지지 않는다 (치명) ★최우선

`src/components/worker/WorkerGlobalGps.tsx:175-176`

```js
.gte("entry_at", `${day}T00:00:00`)        // ← 시간대 오프셋 없음
.lte("entry_at", `${day}T23:59:59.999`)
```

`todaySeoulDate()`는 서울 날짜(`2026-08-18`)를 주지만 붙이는 값에 오프셋이 없어 Postgres가 **UTC 자정**으로 해석합니다.

**실제 조회 창 = 오늘 09:00 KST ~ 내일 08:59 KST**

건설현장 출근 시각인 **06:30–08:00에 찍은 출근은 이 창 밖**이라 검색되지 않습니다.
→ `checkedIn = false` → GPS 미시작 → “GPS 꺼짐 · 출근 후 추적” 배지만 표시.
근로자는 분명히 출근을 찍었는데 추적이 안 되는 상태입니다.

**같은 패턴 5곳 추가** — 출역 통계·작업허가 인원 동기화도 오전 인원 누락:

- `src/pages/Dashboard.tsx:141-142`
- `src/pages/WorkerAttendance.tsx:110-111`
- `src/lib/permitCrewSync.ts:61-62`
- `src/components/permits/WorkPermitWorkersDialog.tsx:88-89`

```diff
- .gte("entry_at", `${day}T00:00:00`)
- .lte("entry_at", `${day}T23:59:59.999`)
+ .gte("entry_at", `${day}T00:00:00+09:00`)
+ .lte("entry_at", `${day}T23:59:59.999+09:00`)
```

**처방**: 경계 계산을 `seoulDayRange(day)` 공용 함수로 추출해 6곳이 같은 값을 쓰게 합니다. 07:00 KST 출근이 포함되는지 회귀 테스트로 고정합니다.

---

### F-02 · 경보는 조건 없이 켜지고, 끄는 데만 조건이 걸린다 (치명)

`src/components/geofence/ShellGeofenceAlerts.tsx:229-249`

- **켤 때**: 정확도를 전혀 보지 않음
- **끌 때**: 정확도 40m 이내 + 3회 연속 “구역 밖” 필요

정확도 300m짜리 픽스 하나가 폴리곤 안에 떨어지면 즉시 전체화면 사이렌이 울리고, 끄려면 양호한 픽스 3개를 기다려야 합니다. 실내·건물 그늘·기기 웨이크업 직후 정확도 급락을 감안하면 **오알람이 구조적으로 보장**됩니다.

**처방**: 여는 쪽에도 동일 정확도 하한(≤40m) 적용 + **진입도 2회 연속** 요구 → 진입·이탈 히스테리시스 대칭화.

---

### F-03 · 현장 이탈로 추적이 죽으면 되살아나지 않는다 (치명)

`src/lib/tracking/locationTracker.ts:170, 212-228, 422-438`

`leftSite`/`stopped`가 **단방향 래치**입니다. 한 번 true가 되면 워처를 제거하고 트래커 내부에 되돌릴 경로가 없습니다.

복귀용 히스테리시스 `isInsideResumeFence()`와 상수 `SITE_TRACK_RESUME_M`이 **이미 존재하지만 트래커 내부에서는 쓰이지 않습니다**. 복귀는 화면 쪽(`WorkerGlobalGps.tsx:237`)의 20초 폴링에만 의존하고, 그마저도 **관리자에게만** 적용됩니다.

→ **근로자는 재출근을 찍기 전까지 추적이 영구 정지**합니다.

**처방**: 트래커를 상태 머신(`tracking → suspended → tracking`)으로 전환. 이탈 시 워처 제거 대신 **저전력 감시 모드**로 강등하고, 복귀 판정에 기존 `isInsideResumeFence()`를 트래커 내부에서 직접 사용.

---

### F-04 · 픽스 1회에 콜백이 2번 — 흔들림 방어가 절반으로 깎인다 (치명)

`src/lib/tracking/locationTracker.ts:463, 504`

픽스 하나마다 `onUpdate`가 두 번 호출됩니다(서버 응답 전 로컬 좌표 / 서버 응답 병합). 각각 `setLastGpsFix()`를 호출하고 매번 `at: Date.now()`로 새 객체를 만들기 때문에, 구독 중인 `ShellGeofenceAlerts` 이펙트가 **픽스 1회당 2회** 실행됩니다.

→ `exitStreak`가 픽스당 2씩 증가해 3회 설정된 흔들림 방어가 **실질 1.5회**로 동작합니다. F-02와 겹치면 경보가 켜졌다 꺼졌다를 반복합니다.

**처방**: 콜백을 `onPreview`(로컬 즉시) / `onFix`(서버 확정)로 분리. 경보 판정은 `onFix`만 구독.

---

### F-05 · 폴리곤 구역까지의 거리를 꼭짓점으로만 잰다 (높음)

`src/lib/tracking/restrictedZoneGeom.ts:97-101`

```js
for (const p of poly) {
  best = Math.min(best, haversineM(here, p));   // 변이 아니라 꼭짓점
}
```

긴 직사각형 구역의 변 한가운데로 접근하면 실제 거리 5m여도 가장 가까운 꼭짓점은 40m 밖일 수 있습니다. 이 값이 전력 모드를 결정하므로(80m 이내 = 고정밀), 바로 옆까지 다가가도 **45초 절전 주기가 유지**되다가 구역에 들어간 뒤에야 경보가 뜹니다.

**처방**: 점–선분 최단거리로 교체. 순수 함수라 단위 테스트 용이.

---

### F-06 · 클라이언트가 서버 정확도 방어선을 강제로 뚫는다 (높음)

`src/lib/tracking/geofenceAdminPush.ts:37`
`supabase/functions/track-location/index.ts:137`

```js
if (body.accuracy_m > 100 && ... && !body.force_restricted_check) { /* 폐기 */ }
```

클라이언트 경보 경로는 항상 `force_restricted_check: true`로 전송합니다.
→ **클라이언트가 오알람을 낼 때 서버 검증까지 함께 무력화**되어, 부정확한 좌표로 `unauthorized_entry`가 DB에 기록되고 관리자 푸시까지 나갑니다. F-02의 오알람이 기록으로 굳는 경로입니다.

**처방**: `force_restricted_check`가 “구역 지정”만 강제하고 **정확도 게이트는 우회하지 못하게** 분리.

---

### F-07 · 프로젝트 선택 키가 두 개 (높음)

`localStorage`: `"selectedProjectId"` (20곳) vs `"currentProjectId"` (21곳)

- GPS 추적 → `selectedProjectId` (`WorkerGlobalGps.tsx:29`)
- 관제 지도 / 구역 관리 / 도면 정합 / 추적 점검 → `currentProjectId`
  (`SiteControlMap`, `GeorefMapControl`, `SiteMaps`, `ZoneEvents`, `AdminTrackingHealth`)

관리자가 지도 화면에서 프로젝트를 바꿔도 **추적기는 이전 프로젝트에 묶인 채**입니다. A현장 구역을 그리면서 B현장 기준으로 추적되는 상황 → “구역을 만들었는데 알람이 안 온다”.

**처방**: 키 통일 + 단일 `useActiveProject()` 훅. 마이그레이션 기간에는 한쪽을 읽어 다른 쪽에 미러링.

---

### F-08 · 추적이 살아 있는지 확인할 방법이 없다 (높음)

`src/pages/AdminTrackingHealth.tsx:24-29`

“위치 추적 상태 점검” 화면이 보는 것은 `worker_zone_events`뿐인데, 이 테이블에는 **구역 진입·이탈이 발생했을 때만** 행이 쌓입니다. 하루 종일 구역 근처에 안 간 근로자는 추적이 정상이든 완전히 죽었든 **똑같이 0건**입니다.

“김OO의 GPS가 지금 켜져 있는가”라는 기본 질문에 답할 수 없습니다. 이것이 GPS 수정 커밋이 반복된 근본 이유로 보입니다.

부가로 이 화면은 `currentProjectId`를 쓰므로 F-07의 영향도 받습니다.

**처방**: `worker_last_positions.updated_at` 기준으로 “최근 5분 내 수신 / 지연 / 두절” 집계 (스키마 변경 없이 시작 가능) + 중단 사유(`no_consent`/`no_permission`/`no_checkin`/`fence_probe_failed`)를 서버로 올려 관리자도 보게 함.

---

### F-09 · 근로자 식별이 이름 비교로 떨어진다 — 죽은 삼항식 (높음)

`supabase/functions/track-location/index.ts:324-330`

```js
const workerKey = body.worker_qr_id
  ? { col: "worker_qr_id", val: body.worker_qr_id }
  : body.worker_phone
  ? { col: "worker_phone", val: body.worker_phone }
  : subject.worker_id
  ? null      // ← 참이든
  : null;     // ← 거짓이든 null
```

마지막 분기가 **참/거짓 모두 null**인 죽은 코드입니다. 그 결과 QR ID·전화번호가 없으면 이름(`worker_name`)으로 이전 이벤트를 조회하는 경로(`index.ts:348`)로 빠집니다.

→ **동명이인이 서로의 구역 이벤트를 덮어써** 진입/이탈 판정이 어긋나고, 이름이 비면 매칭 실패로 같은 구역에서 진입 이벤트가 반복 생성됩니다.

**처방**: `subject.worker_id ? { col: "worker_qr_id", val: subject.worker_id } : null`로 정정하고 이름 기반 조회 제거.

---

### F-10 · 자정이 지나면 같은 구역에 다시 “진입”한다 (중간)

`supabase/functions/track-location/index.ts:322-323`

직전 이벤트를 **오늘 0시 이후**에서만 찾습니다. 야간작업 중 자정을 넘기면 이전 진입 기록이 조회 범위에서 사라져, 같은 구역에 계속 서 있어도 `unauthorized_entry`가 새로 기록되고 사이렌·푸시가 재발생합니다.

덧붙여 이 `since`도 서버 UTC 자정 기준이라 **한국시간 오전 9시**에 경계가 걸립니다(F-01과 동일 원인). 주간작업에서도 오전 9시 재알람 가능.

**처방**: 날짜 경계 대신 **최근 N시간**(예: 12시간) 조회로 변경.

---

### F-11 · 정지 판정 로직이 네이티브와 웹에서 다르다 (중간)

`src/lib/tracking/locationTracker.ts:244` (네이티브) vs `:477` (웹)

- 네이티브: **모든 픽스마다** 기준 위치 갱신
- 웹: **서버 전송에 성공한 픽스에서만** 갱신

네이티브에서는 천천히 걷는 근로자가 픽스 간 이동 12m 미만이라 계속 “정지”로 누적되어 2분 뒤 **180초 절전 주기로 강등**됩니다. 이동 중인데 3분에 한 번 측위 → 위험구역 접근을 놓칩니다. 웹은 반대로 누적 표류가 이동으로 오인됩니다.

**처방**: 정지 판정을 공용 함수로 추출, 누적 이동 거리 기반으로 통일.

---

### F-12 · 쓰이지 않는 추적기 두 개가 남아 있다 (중간)

`src/components/geofence/GeofenceAlertBridge.tsx:156`
`src/components/worker/WorkerTrackingCard.tsx:46`

둘 다 `startTracking()`을 독립 호출하지만 현재 어디에도 마운트되지 않은 **죽은 코드**입니다(전수 검색 결과 import 0건). 과거 아키텍처 잔재.

당장 문제는 없지만 누군가 재사용하는 순간 **즉시 3중·4중 추적**이 됩니다. S-02 재발의 가장 쉬운 경로.

**처방**: 삭제. 경보 UI가 필요하면 통합된 `ShellGeofenceAlerts` 사용.

---

### F-13 · 보정이 2계층인데 캐시 일관성이 없다 (중간)

`src/lib/tracking/gpsCalibration.ts:90-108`

현재 보정은 2계층 설계입니다 ([`gps-map-calibration-design.md`](./gps-map-calibration-design.md) 참조):

1. **워킹 지오레프** — 다중 기준점 어파인 (`fitAffineFromControlPoints.ts`), `site_maps.geo_transform`에 저장. **주 경로**
2. **1점 바이어스** — `projects.gps_calibration`, 잔여 오차 보정. 워킹/위성 저장 시 자동 초기화 (`MobileMapCalibration.tsx:624`, `SiteControlMap.tsx:530`)

설계 자체는 타당합니다. 문제는 **캐시 계층**입니다 — 클라이언트는 60초 TTL 캐시, 서버는 매 요청 DB 조회. 재보정 후 최대 1분간 클라이언트와 서버가 다른 좌표계로 판정하며, 이는 이미 “이중 보정” 버그로 한 번 터진 지점입니다.

**처방**: 재보정 시 Supabase Realtime으로 `clearGpsCalibrationCache(projectId)` 브로드캐스트. 설계 변경 불필요.

---

### F-14 · 테스트가 순수 함수만 덮고 있다 (중간)

`src/test/` — `gpsCalibration`, `siteTrackBounds`, `geofenceAdminPush`, `calculateDistance`, `recommendControlPoints`, `walkSlotStability`

거리 계산·보정 수식·펜스 반경 같은 **순수 함수는 잘 테스트되어 있습니다**. 반면 이번에 발견된 결함은 전부 그 바깥 — 추적기 생명주기, 출근 조회 창, 경보 히스테리시스, 이중 파이프라인. 어느 것도 테스트가 없습니다.

**처방**: 수정과 함께 회귀 테스트 3종 추가 (Phase 2 참조).

---

## 5. 오해하기 쉬운 부분 — 정상인 것들

진단 과정에서 “문제로 보이지만 실제로는 정상”인 항목입니다. **수정 대상이 아닙니다.**

### 안드로이드 위치 권한 — 정상

커밋된 `android/app/src/main/AndroidManifest.xml`에는 위치 권한이 없지만, `scripts/prepare-native.mjs`가 빌드 시점에 `ACCESS_FINE_LOCATION` / `ACCESS_BACKGROUND_LOCATION` / `FOREGROUND_SERVICE_LOCATION` / `POST_NOTIFICATIONS`를 주입하고, CI(`.github/workflows/android-aab.yml:183-203`)가 누락 시 빌드를 실패시킵니다.

⚠️ 단, **로컬에서 `cap sync` 후 Android Studio로 직접 빌드하면 권한 없는 앱이 나옵니다.** 현장 테스트가 “어떤 빌드에서는 되고 어떤 빌드에서는 안 되는” 경험의 원인일 수 있으니 확인 필요.

### 원본/보정 좌표 분리 — 의도된 설계

펜스는 원본 GPS, 구역은 보정 좌표를 쓰는 것은 올바릅니다(`geofenceAdminPush.test.ts`가 이중 보정을 회귀 테스트로 고정하고 있음). S-03은 “분리가 틀렸다”가 아니라 “타입으로 강제되지 않아 실수하기 쉽다”는 지적입니다.

### iOS 백그라운드 GPS 제한 — 문서화되어 있음

[`iphone-web-pwa-path.md`](./iphone-web-pwa-path.md)에 “백그라운드 GPS: 제한”으로 이미 명시되어 있습니다. 플랫폼 제약이므로 코드로 해결 불가. 다만 이 제약이 **제품 사양으로 사용자에게 전달되는지**는 별도 확인이 필요합니다(6장 결정사항 참조).

---

## 6. 결정이 필요한 사항

기술적 정답이 하나가 아니라 운영 방침에 따라 갈리는 항목입니다.

### D-1 · 경보의 즉시성 vs 정확성

클라이언트 판정을 없애면 오알람은 크게 줄지만 서버 왕복만큼(수백 ms–수 초) 경보가 늦어집니다.

> **권고**: 예비 경보는 유지하되 **정확도 40m 이내에서만** 울리고, 서버 확정이 오면 즉시 정정. 중장비 접근 경보라는 성격상 “늦은 경보”보다 “정확한 경보”가 낫습니다.

### D-2 · 근로자 추적을 출근 이후로 계속 제한할 것인가

현재 정책은 “출근을 찍어야 추적”입니다. 개인정보 측면에서 타당하지만, F-01 같은 버그가 생기면 **추적이 통째로 정지**하는 단일 실패 지점이 됩니다.

> **권고**: 정책 유지. 대신 출근 판정 실패 시 **관리자에게 보이도록** 합니다(Phase 2의 중단 사유 집계).

### D-3 · iOS를 계속 웹/PWA 경로로 갈 것인가

iPhone이 Safari 웹/PWA인 한 브라우저가 백그라운드에서 `watchPosition`을 중단시키므로 **화면을 끄면 추적이 사실상 멈춥니다**. 코드로 해결 불가.

> **권고**: 안드로이드는 네이티브 백그라운드로 정상 동작하므로, iOS는 **“화면이 켜져 있을 때만 추적”임을 앱 내 안내 문구로 노출**하거나 네이티브 앱 배포를 검토. 현재 `iphone-web-pwa-path.md`에 개발 문서로는 있으나 **사용자에게 보이는 안내는 없습니다**.

---

## 7. 로드맵 요약

상세 작업 지시는 [`gps-tracking-fix-prompts.md`](./gps-tracking-fix-prompts.md)에 있습니다.

| Phase | 기간 | 내용 | 해결 항목 |
|-------|------|------|-----------|
| **0** | 1–2일 | 출혈 지혈 — 시간대 오프셋, 경보 정확도 게이트, 웹워커 제거 | F-01, F-02, S-02(부분) |
| **1** | 약 1주 | 판정 권한 단일화 + 상태 머신 전환 | S-01, S-02, F-03, F-04, F-06, F-07 |
| **2** | 약 1주 | 가시성 확보 — 하트비트, 중단 사유, 회귀 테스트 | F-08, F-14 |
| **3** | 여유 시 | 정밀도와 정리 | F-05, F-09, F-10, F-11, F-12, F-13, S-03 |

**순서가 중요합니다.** 구조(Phase 1)를 정리하기 전에 개별 버그만 잡으면 지금까지처럼 재발합니다.
