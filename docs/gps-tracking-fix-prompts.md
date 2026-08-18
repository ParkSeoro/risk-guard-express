# GPS 추적 개선 — Phase별 작업 지시서

> 진단 근거: [`gps-tracking-diagnosis.md`](./gps-tracking-diagnosis.md)
> 사용법: 아래 각 Phase 블록을 **하나씩** 커서에 붙여넣습니다. 한 번에 여러 Phase를 주지 마십시오.

---

## 공통 원칙 (모든 Phase에 적용)

아래 내용은 각 Phase 프롬프트에 이미 포함되어 있습니다. 참고용으로만 봐 주십시오.

- **안전 최우선**: 이 시스템은 중장비 접근 경보를 담당합니다. 확신이 없으면 “경보를 안 울리는” 쪽이 아니라 **물어보는** 쪽을 택할 것.
- **진단서 항목 번호(F-01 등)를 커밋 메시지에 남길 것** — 재발 추적이 가능해집니다.
- **Phase 1·2는 계획을 먼저 설명하고 승인받은 뒤 진행**할 것.
- 기존 테스트(`bun run test`)를 깨뜨리지 말 것. 패키지 매니저는 **bun**(npm 아님, `AGENTS.md` 참조).
- `bun run lint`는 **원래 실패합니다**(기존 `no-explicit-any` 다수). 새로 추가한 에러만 확인할 것.

---

## Phase 0 — 출혈 지혈 (1~2일)

> 구조를 건드리지 않고 독립 적용 가능하며 체감 개선이 가장 큰 세 가지입니다.

```
risk-guard-express 저장소에서 GPS 추적 관련 버그 3건을 수정해줘.
근거 문서는 docs/gps-tracking-diagnosis.md 이고, 아래 F-번호는 그 문서의 항목 번호야.

이 시스템은 건설현장 중장비 접근 경보를 담당해. 안전 관련 코드이므로
확신이 없으면 임의로 판단하지 말고 나에게 먼저 물어봐.

═══ 작업 1 (F-01, 최우선) · 출근 조회 창의 시간대 오프셋 누락 ═══

src/components/worker/WorkerGlobalGps.tsx:175-176 의 hasOpenCheckIn() 이
오늘 출근 기록을 찾을 때 시간대 오프셋 없는 문자열을 쓰고 있어:

    .gte("entry_at", `${day}T00:00:00`)
    .lte("entry_at", `${day}T23:59:59.999`)

todaySeoulDate() 는 서울 날짜를 주는데 오프셋이 없어서 Postgres가 UTC 자정으로
해석해. 실제 조회 창이 "오늘 09:00 KST ~ 내일 08:59 KST" 가 되어버려서,
06:30~08:00 에 출근을 찍은 근로자가 검색되지 않고 GPS 추적이 시작되지 않아.

수정 방법:
1. src/lib/dailyWorkAck.ts (todaySeoulDate 가 있는 파일) 에 공용 함수를 추가해:
     export function seoulDayRange(day = todaySeoulDate()):
       { start: string; end: string }
   start = `${day}T00:00:00+09:00`, end = `${day}T23:59:59.999+09:00`
2. 아래 6곳을 전부 이 함수로 교체해:
   - src/components/worker/WorkerGlobalGps.tsx:175-176
   - src/pages/Dashboard.tsx:141-142
   - src/pages/WorkerAttendance.tsx:110-111
   - src/lib/permitCrewSync.ts:61-62
   - src/components/permits/WorkPermitWorkersDialog.tsx:88-89
   (WorkerAttendance 는 오늘이 아니라 임의 날짜를 받으니 인자로 넘길 것)
3. 회귀 테스트를 추가해: 07:00 KST 출근 기록이 seoulDayRange 범위에 포함되는지.

주의: entry_at 은 timestamptz 야. 다른 곳에서 날짜 문자열을 쓰는 패턴이
더 있는지 `T00:00:00` 로 전체 검색해서 확인하고, GPS/출퇴근과 무관한 곳까지
바꾸지는 마. 바꾼 곳은 목록으로 보고해줘.

═══ 작업 2 (F-02) · 경보 진입/이탈 게이트 비대칭 ═══

src/components/geofence/ShellGeofenceAlerts.tsx:229-249 를 봐.
경보를 켤 때는 GPS 정확도를 전혀 확인하지 않는데, 끌 때만
"정확도 40m 이내 + 3회 연속 구역 밖" 을 요구해.

그래서 정확도 300m 짜리 쓰레기 픽스 하나가 폴리곤 안에 떨어지면
즉시 전체화면 사이렌이 울리고, 끄려면 양호한 픽스 3개를 기다려야 해.

수정 방법:
- 경보를 여는 경로에도 동일한 정확도 하한을 적용 (정확도 > 40m 이면 무시)
- 진입도 2회 연속 hit 를 요구해서 진입/이탈 히스테리시스를 대칭으로 만들 것
- 40 이라는 숫자는 이미 코드에 있으니 상수로 뽑아서 양쪽이 같은 값을 쓰게 할 것
  (src/lib/tracking/siteTrackBounds.ts 에 다른 임계값 상수들이 모여 있으니 거기 추가)

주의: 진입 연속 2회 요구는 경보를 최대 1픽스만큼 늦춰. 위험구역 안(danger 모드)
에서는 5초 주기라 문제없지만, 만약 이 지연이 위험하다고 판단되면 진입 연속 요구는
빼고 정확도 게이트만 적용한 뒤 나에게 알려줘.

═══ 작업 3 (S-02 부분) · 웹워커 15초 틱 제거 ═══

src/providers/SystemRealtimeProvider.tsx:270-293 에서, 이미 startTracking() 이
적응형 주기(5s/12s/45s/180s)로 돌고 있는데 웹워커가 조건 없이 15초마다
별도로 getCurrentPosition + track-location 을 호출하고 있어.

이 두 번째 경로는 현장 펜스 이탈 검사와 위험구역 근접 판단을 전부 우회하고,
45초/180초 절전 구간을 무효화해. 네이티브 백그라운드일 때만 스킵되는데
iPhone 은 Safari 웹/PWA 가 공식 경로라 iOS 사용자는 항상 이중으로 돌아.

수정 방법:
- 웹워커 생성/틱 경로를 제거하고 startTracking() 단일 경로로 통일
- src/workers/gpsTracker.worker.ts 가 다른 곳에서도 쓰이는지 확인하고,
  안 쓰이면 파일도 삭제
- postFix() 함수가 웹워커 전용이었다면 함께 정리 (다른 호출자 확인 필수)

주의: 이걸 제거하면 웹에서 백그라운드 추적 지속성이 떨어질 수 있어.
다만 웹워커는 원래 geolocation 에 접근할 수 없어서 메인 스레드를 깨우는
타이머 역할만 했고, 브라우저가 백그라운드 탭의 타이머를 스로틀하므로
실제 지속성 효과는 제한적이야. 제거 후 실제로 잃는 게 있다고 판단되면
제거하지 말고 나에게 먼저 설명해줘.

═══ 마무리 ═══
- 작업 1 → 2 → 3 순서로 하고, 각 작업마다 diff 를 보여줘
- bun run test 를 돌려서 기존 테스트가 깨지지 않는지 확인
- 커밋은 작업별로 분리하고 메시지에 (F-01) 같은 항목 번호를 넣어줘
```

---

## Phase 1 — 판정 권한 단일화 (약 1주)

> 이번 작업의 본체입니다. “누가 위험구역 침입을 결정하는가”를 한 곳으로 못박습니다.
> **반드시 Phase 0을 먼저 적용하고 현장에서 검증한 뒤** 진행하십시오.

```
risk-guard-express 의 GPS 추적 구조를 리팩터링해줘.
근거: docs/gps-tracking-diagnosis.md 의 S-01, S-02, F-03, F-04, F-06, F-07

이건 구조 변경이라 리스크가 커. 코드를 바로 고치지 말고,
먼저 아래 5개 항목에 대한 구체적 실행 계획을 설명하고 내 승인을 받은 뒤 진행해.

═══ 배경 ═══
지금은 하나의 GPS 픽스를 두 개의 파이프라인이 나르고, 클라이언트와 서버가
각각 다른 규칙으로 "위험구역 안인가" 를 판정해. 그래서 화면은 사이렌인데
서버 이벤트는 없거나 그 반대인 상황이 만들어져.
개별 버그를 아무리 잡아도 이 구조가 남아 있으면 재발해.

═══ 목표 상태 ═══
G1 연속성 — 출근한 근로자는 퇴근까지 끊기지 않고 추적된다
G2 정직성 — 실제로 들어갔을 때만 울리고, 나왔으면 확실히 꺼진다
G3 지속성 — 하루 8시간 배터리가 버틴다
G4 가시성 — (Phase 2 에서)

═══ 항목 1 (S-01) · 서버를 유일한 판정자로 확정 ═══
파일: src/components/geofence/ShellGeofenceAlerts.tsx:229-250
      supabase/functions/track-location/index.ts:263-284

클라이언트의 findViolatingRestrictedZone() 판정을 "예비 경보" 로 격하해줘.
- 클라이언트 판정 → 즉시 경보를 띄우되 "확인 중" 상태로 표시
- 서버 응답 도착 → 반드시 서버 결과로 덮어씀 (서버가 아니라고 하면 경보 해제)
- 서버 응답이 일정 시간 안 오면 예비 경보를 유지할지 해제할지는 나에게 물어봐

═══ 항목 2 (F-03) · 트래커를 상태 머신으로 전환 ═══
파일: src/lib/tracking/locationTracker.ts:170, 212-228, 422-438

현재 leftSite/stopped 가 단방향 래치라 한 번 현장 밖으로 판정되면
워처를 제거하고 다시는 살아나지 않아. 근로자는 재출근을 찍기 전까지 영구 정지야.

- tracking → suspended → tracking 상태 머신으로 바꿔줘
- 이탈 시 워처를 제거하지 말고 저전력 감시 모드로 강등 (예: 5분 주기)
- 복귀 판정은 이미 존재하는 isInsideResumeFence() 를 트래커 내부에서 직접 사용
  (src/lib/tracking/siteTrackBounds.ts:194 — 지금은 화면 쪽에서만 쓰이고 있어)
- 기존의 화면 쪽 20초 폴링(WorkerGlobalGps.tsx:237)은 중복이 되니 정리

배터리 영향을 반드시 함께 검토하고, 저전력 감시 주기를 얼마로 할지
근거와 함께 제안해줘.

═══ 항목 3 (F-04) · 콜백 이중 호출 분리 ═══
파일: src/lib/tracking/locationTracker.ts:463, 504

픽스 1회마다 onUpdate 가 두 번 호출돼서(로컬 좌표 / 서버 병합),
구독하는 ShellGeofenceAlerts 이펙트가 2회 돌고 exitStreak 가 2씩 증가해.
결과적으로 3회로 설정한 흔들림 방어가 실질 1.5회로 동작하고 있어.

- onUpdate 를 onPreview(로컬 즉시) / onFix(서버 확정) 로 분리
- 경보 판정 이펙트는 onFix 만 구독하게 변경
- 지도 표시 등 즉시성이 필요한 소비자만 onPreview 사용

═══ 항목 4 (F-06) · 서버 정확도 게이트 우회 차단 ═══
파일: supabase/functions/track-location/index.ts:137
      src/lib/tracking/geofenceAdminPush.ts:37

force_restricted_check: true 가 정확도 게이트까지 우회해서, 클라이언트가
오알람을 낼 때 서버 검증도 함께 무력화되고 부정확한 좌표로 unauthorized_entry
가 DB 에 기록돼.

- force_restricted_check 는 "구역 지정" 만 강제하고
  정확도 게이트는 우회하지 못하게 분리해줘

═══ 항목 5 (F-07) · 프로젝트 선택 키 통일 ═══
localStorage 에 "selectedProjectId"(20곳) 와 "currentProjectId"(21곳) 가
공존해. GPS 추적은 selectedProjectId 를, 관제지도/구역관리/도면정합/추적점검은
currentProjectId 를 봐서, 관리자가 지도에서 프로젝트를 바꿔도 추적기는
이전 프로젝트에 묶인 채로 남아.

- 단일 useActiveProject() 훅으로 접근을 통일
- 어느 키를 정본으로 할지는 사용처를 조사한 뒤 제안해줘
- 기존 사용자의 localStorage 를 깨지 않도록 마이그레이션 경로 포함
  (한쪽을 읽어 다른 쪽에 미러링하는 기간을 두는 방식)

═══ 진행 방식 ═══
1. 먼저 5개 항목 각각에 대해 "어떻게 바꿀지" 를 설명하고 내 승인을 받아
2. 승인 후 항목 1개씩 작업하고 매번 diff + 무엇을 바꿨는지 요약 보고
3. 항목 2(상태 머신)는 가장 위험하니 마지막에 하고, 작업 전에
   현재 동작을 정리한 상태 전이표를 먼저 보여줘
4. bun run test 통과 확인
```

---

## Phase 2 — 가시성 확보 (약 1주)

> 시스템이 안정된 뒤, **안정되었다는 사실을 증명할 수단**을 만듭니다.

```
risk-guard-express 에 GPS 추적 가시성을 추가해줘.
근거: docs/gps-tracking-diagnosis.md 의 F-08, F-14

═══ 배경 ═══
현재 "위치 추적 상태 점검" 화면(src/pages/AdminTrackingHealth.tsx)이 보는 건
worker_zone_events 뿐인데, 이 테이블은 구역 진입/이탈이 발생했을 때만 행이 쌓여.
하루 종일 구역 근처에 안 간 근로자는 추적이 정상이든 완전히 죽었든 똑같이 0건이야.

그래서 "김OO의 GPS가 지금 켜져 있는가" 라는 가장 기본적인 질문에 답할 수 없고,
현장에서 문제가 생기면 코드에서 추측하는 수밖에 없어. 이게 GPS 수정 커밋이
반복된 근본 이유로 보여.

═══ 작업 1 · 하트비트 집계 ═══
worker_last_positions.updated_at 이 이미 존재하니 스키마 변경 없이 시작할 수 있어.

- 프로젝트별로 "최근 5분 내 수신 / 지연(5~30분) / 두절(30분 초과)" 을 집계
- 기존 get_worker_distribution_counts 처럼 SECURITY DEFINER RPC 로 만들고
  RLS 범위(마스터 전체 / 그 외 소속 업체)를 기존 정책과 동일하게 맞출 것
  참고: supabase/migrations/20260804010000_worker_last_positions_qr_only_kill.sql
- 마이그레이션 파일은 기존 명명 규칙(날짜_설명.sql)을 따를 것

═══ 작업 2 · 중단 사유를 서버로 올리기 ═══
src/components/worker/WorkerGlobalGps.tsx:31-43 에 이미 중단 사유가 정의돼 있어:
no_consent / no_permission / no_checkin / fence_probe_failed

지금은 근로자 본인 화면에 배지로만 뜨고 관리자는 볼 수 없어.
이 값을 서버에 기록해서 관리자가 "왜 이 사람 GPS 가 꺼져 있는지" 를 알 수 있게 해줘.

- 어디에 저장할지(worker_last_positions 컬럼 추가 vs 별도 테이블)는
  제안하고 내 승인을 받은 뒤 진행
- 개인정보 최소 수집 원칙을 지킬 것 — 위치가 아니라 "상태" 만 저장

═══ 작업 3 · 추적 점검 화면 재작성 ═══
src/pages/AdminTrackingHealth.tsx 를 다시 만들어줘.
"구역 이벤트 몇 건" 이 아니라 "지금 몇 명이 추적 중이고 누가 왜 끊겼는가" 를 보여줘야 해.

- 상단: 추적중 / 지연 / 두절 인원 수
- 목록: 두절된 근로자와 그 사유
- 이 화면은 지금 localStorage "currentProjectId" 를 쓰는데,
  Phase 1 에서 키를 통일했다면 그 훅을 쓸 것

═══ 작업 4 (F-14) · 회귀 테스트 3종 ═══
지금 테스트는 순수 함수만 덮고 있어(거리 계산, 보정 수식, 펜스 반경).
이번에 발견된 결함은 전부 그 바깥이야. 최소 3개를 추가해줘:

1. 07:00 KST 출근 기록이 오늘 조회 창에 포함되는가 (F-01 재발 방지)
2. 정확도 300m 픽스가 경보를 켜지 못하는가 (F-02 재발 방지)
3. 펜스 이탈 후 복귀 시 추적이 재개되는가 (F-03 재발 방지)

vitest 를 쓰고 있고 기존 테스트는 src/test/ 에 있어. 스타일을 맞춰줘.

═══ 진행 방식 ═══
작업 1 → 2 → 3 → 4 순서. 작업 2 는 스키마 결정 전에 나에게 물어볼 것.
```

---

## Phase 3 — 정밀도와 정리 (여유 시)

> 안정성 확보 후 정확도를 끌어올리는 단계. 급하지 않지만 넓은 현장일수록 효과가 큽니다.
> 항목 간 의존성이 없으므로 **하나씩 따로 진행해도 됩니다.**

```
risk-guard-express 의 GPS 관련 남은 개선 항목들을 처리해줘.
근거: docs/gps-tracking-diagnosis.md 의 F-05, F-09, F-10, F-11, F-12, F-13

항목 간 의존성이 없으니 하나씩 독립적으로 작업하고, 각각 따로 커밋해줘.

─── F-05 · 폴리곤 거리 계산을 점–선분 방식으로 교체 ───
src/lib/tracking/restrictedZoneGeom.ts:97-101

지금 폴리곤까지의 거리를 "변" 이 아니라 "꼭짓점" 까지만 재고 있어:
    for (const p of poly) best = Math.min(best, haversineM(here, p));

긴 직사각형 구역의 변 한가운데로 접근하면 실제 거리가 5m 여도 가장 가까운
꼭짓점은 40m 밖일 수 있어. 이 값이 전력 모드를 결정하니까(80m 이내 = 고정밀),
바로 옆까지 가도 45초 절전 주기가 유지되다가 구역에 들어간 뒤에야 경보가 떠.

→ 점–선분 최단거리(각 변에 투영점을 구하는 표준 알고리즘)로 교체.
   순수 함수라 단위 테스트도 함께 넣어줘.

─── F-09 · 죽은 삼항식 수정 ───
supabase/functions/track-location/index.ts:324-330

    : subject.worker_id
    ? null      // 참이든
    : null;     // 거짓이든 null

참/거짓 모두 null 인 죽은 코드야. 그래서 QR ID·전화번호가 없으면
이름(worker_name)으로 이전 이벤트를 조회하는 경로(index.ts:348)로 빠지고,
동명이인이 서로의 구역 이벤트를 덮어써.

→ subject.worker_id ? { col: "worker_qr_id", val: subject.worker_id } : null
  로 정정하고, 이름 기반 조회 경로는 제거.
  단 이름 조회를 지우면 매칭이 안 되는 케이스가 생기는지 먼저 확인할 것.

─── F-10 · 자정 리셋으로 인한 재알람 ───
supabase/functions/track-location/index.ts:322-323

직전 이벤트를 "오늘 0시 이후" 에서만 찾아서, 야간작업 중 자정을 넘기면
같은 구역에 계속 서 있어도 unauthorized_entry 가 새로 기록되고 사이렌이 다시 울려.
게다가 이 since 도 서버 UTC 자정 기준이라 실제로는 한국시간 오전 9시에 경계가 걸려.

→ 날짜 경계 대신 "최근 12시간" 조회로 변경.

─── F-11 · 정지 판정 로직 통일 ───
src/lib/tracking/locationTracker.ts:244 (네이티브) vs :477 (웹)

네이티브는 모든 픽스마다 기준 위치를 갱신하고, 웹은 서버 전송 성공 시에만 갱신해.
그래서 네이티브에서 천천히 걷는 근로자가 계속 "정지" 로 누적돼서
2분 뒤 180초 절전 주기로 강등돼. 이동 중인데 3분에 한 번만 측위하는 상태야.

→ 정지 판정을 공용 함수로 추출하고 누적 이동 거리 기반으로 통일.

─── F-12 · 죽은 추적기 삭제 ───
src/components/geofence/GeofenceAlertBridge.tsx
src/components/worker/WorkerTrackingCard.tsx

둘 다 startTracking() 을 독립 호출하지만 현재 어디에도 마운트되지 않은 죽은 코드야
(전수 검색 결과 import 0건). 누군가 재사용하면 즉시 3중·4중 추적이 돼.

→ 삭제 전에 정말 아무 데서도 안 쓰는지 다시 확인하고 삭제.
  (테스트, 스토리북, 동적 import 포함해서 검색할 것)

─── F-13 · 보정값 캐시 일관성 ───
src/lib/tracking/gpsCalibration.ts:90-108

클라이언트는 gps_calibration 을 60초 TTL 로 캐시하는데 서버는 매 요청 조회해.
마스터가 현장에서 재보정하면 최대 1분간 클라이언트와 서버가 다른 좌표계로 판정해.

→ 재보정 시 Supabase Realtime 으로 clearGpsCalibrationCache(projectId) 브로드캐스트.
  재보정 지점: MobileMapCalibration.tsx:473,494,624 / SiteControlMap.tsx:530

  주의: 보정 설계 자체(워킹 지오레프 어파인 + 1점 바이어스 2계층)는
  docs/gps-map-calibration-design.md 에 문서화된 의도된 설계야. 바꾸지 마.
  캐시 무효화만 추가하는 거야.

═══ 진행 방식 ═══
한 항목씩 작업하고 각각 커밋. 커밋 메시지에 (F-05) 같은 항목 번호를 넣어줘.
```

---

## 부록 · 진행 체크리스트

| 항목 | Phase | 상태 |
|------|-------|------|
| F-01 출근 조회 시간대 | 0 | ☐ |
| F-02 경보 게이트 비대칭 | 0 | ☐ |
| S-02 웹워커 틱 제거 | 0 | ☐ |
| S-01 서버 단일 판정 | 1 | ☐ |
| F-03 상태 머신 전환 | 1 | ☐ |
| F-04 콜백 분리 | 1 | ☐ |
| F-06 정확도 게이트 우회 차단 | 1 | ☐ |
| F-07 프로젝트 키 통일 | 1 | ☐ |
| F-08 하트비트 + 점검 화면 | 2 | ☐ |
| F-14 회귀 테스트 3종 | 2 | ☐ |
| F-05 점–선분 거리 | 3 | ☐ |
| F-09 죽은 삼항식 | 3 | ☐ |
| F-10 자정 리셋 | 3 | ☐ |
| F-11 정지 판정 통일 | 3 | ☐ |
| F-12 죽은 추적기 삭제 | 3 | ☐ |
| F-13 보정 캐시 무효화 | 3 | ☐ |

### 결정 대기 항목

- **D-1** 경보 즉시성 vs 정확성 → Phase 1 항목 1 진행 전 결정 필요
- **D-2** 출근 이후 추적 제한 유지 여부 → Phase 2 작업 2 관련
- **D-3** iOS 웹/PWA 경로 유지 여부 → 코드 작업 아님, 제품 결정
