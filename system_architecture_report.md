# Risk Guard Express — 시스템 아키텍처·정합성 감사 보고서

> 목적: 근로자용 **GPS 100m 지오펜싱 기반 출퇴근 및 일일 TBM/무재해 서약 파이프라인**을 기존 시스템에 통합하기 위한 현황 파악  
> 기준일: 2026-07-29  
> 스캔 범위: `src/**`, `supabase/migrations/**`, `supabase/functions/**`, `src/integrations/supabase/types.ts`

---

## 1. DB 스키마 및 ERD 연결 상태

### 1.1 핵심 엔티티 관계도 (논리 ERD)

```text
auth.users ──1──* profiles (user_id)
auth.users ──1──* user_roles (role=master)
auth.users ──1──* project_members (role_new: project_admin|safety_manager|…|worker|viewer)

projects ──1──* assessment_runs
projects ──1──* work_plans
projects ──1──* work_permits          ※ project_id FK 미선언 (소프트 참조)
projects ──1──* tbm_sessions          ※ project_id FK 미선언
projects ──1──* workers               ※ project_id FK 미선언
projects ──1──* restricted_zones      ✅ FK 있음
projects ──1──* worker_zone_events    ✅ FK 있음
projects ──1──* worker_entry_logs     ※ project_id FK 미선언

assessment_runs ──1──* risk_items
assessment_runs ──1──* work_plans          (assessment_run_id)
assessment_runs ──1──* work_permits        (assessment_run_id) ← 20260729030000 FK
assessment_runs ──1──* tbm_sessions        (run_id)            ← 20260729030000 FK
assessment_runs ──*──* work_permits
        via work_permit_assessment_links                       ← 20260729030000 신설

work_plans ──1──* work_permits             ← 20260729030000 FK
work_plans ──1──* tbm_sessions             ← 20260729030000 FK

work_permits *──1 tbm_sessions             (tbm_session_id)    ← 20260729030000 FK

tbm_sessions ──1──* tbm_participations     ✅ FK (전화번호 UNIQUE)

workers ←소프트→ tbm_participations.worker_phone
workers ←소프트→ worker_entry_logs.worker_id   ※ FK 없음
workers ←소프트→ work_permit_workers.worker_id ※ FK 없음

restricted_zones ──1──* worker_zone_events (restricted_zone_id)
```

### 1.2 사용자·역할 (Worker / Admin)

| 테이블 | 주요 컬럼 (타입) | FK |
|--------|------------------|-----|
| `profiles` | `id uuid`, `user_id uuid`, `display_name text`, `phone text`, `account_status text` | `user_id → auth.users` |
| `user_roles` | `user_id uuid`, `role global_role` (`master`) | `user_id → auth.users` |
| `project_members` | `project_id uuid`, `user_id uuid`, `company_id uuid`, `role_new project_role`, `position_new project_position` | → `projects`, `auth.users`, `companies` |
| `workers` | `id uuid`, `project_id uuid`, `company_id uuid`, `name/phone text`, `qr_token text`, `job_type text`, `is_active bool` | **FK 없음** (프로젝트·회사 모두 소프트) |

- 별도 `admins` 테이블 없음. 관리 권한은 `user_roles.master` + `project_members.role_new` 조합.
- 근로자 신원은 **이중 체계**: (A) Supabase Auth 사용자(`profiles.phone` ↔ `010…@worker.local`), (B) QR 토큰 기반 `workers` 레코드(`WorkerPortal`, localStorage `workerToken`).

### 1.3 위험성평가 · 작업허가 · TBM

| 테이블 | 핵심 FK / 타입 | 비고 |
|--------|----------------|------|
| `assessment_runs` | `project_id→projects`, `period_label text`, `status text`, `start_date/end_date date` | `created_by` FK 없음 |
| `risk_items` | `run_id→assessment_runs`, `project_id→projects` | |
| `approvals` | `run_id`, `risk_item_id`, `entity_type+entity_id` 다형 | work_plan / assessment_run / work_permit 공용 |
| `work_plans` | `assessment_run_id→assessment_runs`, `company_id→companies`, `parent_id→self` | |
| `work_permits` | `company_id→companies`, `form_template_id→permit_form_templates`; **추가 FK(번들)**: `assessment_run_id`, `work_plan_id`, `tbm_session_id` | `project_id` FK 미선언; `linked_assessment_run_ids uuid[]` 잔존 |
| `work_permit_assessment_links` | `work_permit_id→work_permits`, `assessment_run_id→assessment_runs`, `is_primary bool` | 20260729030000 신설 |
| `tbm_sessions` | `run_id→assessment_runs`, `work_plan_id→work_plans`; 컬럼 `tbm_date date`, `title text` | `project_id`/`company_id` FK 미선언. **`tbm_logs` 테이블 없음** |
| `tbm_participations` | `tbm_session_id→tbm_sessions`, UNIQUE`(tbm_session_id, worker_phone)` | `worker_id` 컬럼 자체 없음 |

### 1.4 제한구역 · GPS · 출입

| 테이블 | 핵심 컬럼 | FK |
|--------|-----------|-----|
| `restricted_zones` | `geometry_type`, `geo_polygon jsonb`, `center_lat/lng`, `radius_m`, `access_rules jsonb`, `rule_type ALLOW\|DENY`, `zone_category`, `banned_* uuid[]` | `project_id→projects` |
| `worker_zone_events` | `lat/lng`, `accuracy_m`, `source qr\|gps\|wifi\|manual`, `event_type` | `project_id`, `zone_id→site_zones`, `restricted_zone_id→restricted_zones`, `worker_qr_id→worker_daily_qr` |
| `site_maps` / `site_zones` | georef anchors, `geo_polygon`, Wi-Fi fingerprint | 프로젝트·맵 FK 있음 |
| `worker_entry_logs` | `worker_id`, `work_permit_id`, `tbm_confirmed`, `no_accident_confirmed`, 출입 시각 | **핵심 FK 대부분 없음**; 뷰 `v_worker_attendance_today` 존재 |
| `projects` | `site_lat`, `site_lng` | 현장 기준점 (100m 반경 파이프라인의 후보 앵커) |

### 1.5 `v_safety_work_bundle` 적용 상태

마이그레이션: `supabase/migrations/20260729030000_safety_work_bundle_fks.sql`

| 항목 | 상태 |
|------|------|
| 파일 존재 | ✅ |
| 뷰 SQL (교정 후) | `ts.tbm_date AS tbm_session_date` (`session_date` 오류 수정본은 PR #64 브랜치) |
| `main` 반영 | ⚠️ `main`에는 아직 `ts.session_date` 오타본이 남아 있을 수 있음 → `db push` 실패 이력과 일치 |
| 원격 DB 적용 | ⚠️ `20260729021000`(결재 스탬프)까지 적용된 환경에서 `20260729030000`이 뷰 오류로 실패 → **번들 FK·뷰·`ai_accident_cache` 미적용 가능** |
| 클라이언트 | `src/lib/safetyWorkBundle.ts`가 `.from("v_safety_work_bundle" as any)` / `work_permit_assessment_links as any` 로 타입 우회 |
| `types.ts` | `v_safety_work_bundle`, `work_permit_assessment_links`, `ai_accident_cache` **미반영** |

뷰 정의(의도):

```sql
CREATE OR REPLACE VIEW public.v_safety_work_bundle AS
SELECT
  wp.id AS work_permit_id, wp.project_id, wp.status AS permit_status,
  wp.permit_date, wp.work_name,
  wp.assessment_run_id AS primary_assessment_run_id,
  ar.period_label AS assessment_period_label, ar.status AS assessment_status,
  wp.tbm_session_id, ts.title AS tbm_title, ts.tbm_date AS tbm_session_date,
  wp.work_plan_id, wpl.title AS work_plan_title
FROM work_permits wp
LEFT JOIN assessment_runs ar ON ar.id = wp.assessment_run_id
LEFT JOIN tbm_sessions ts ON ts.id = wp.tbm_session_id
LEFT JOIN work_plans wpl ON wpl.id = wp.work_plan_id;
```

### 1.6 출퇴근·TBM·무재해 서약 관련 기존 자산

- RPC: `worker_has_tbm_today`, 출입 기록 RPC(`_no_accident`, `_signature`, `_token` 인자)
- `worker_entry_logs.no_accident_confirmed`, `tbm_confirmed`
- `WorkerPortal`: 출근 전 TBM 참여 게이트 + 서명/출입 UI
- **GPS 100m 현장 반경 출퇴근 전용 파이프라인은 미구현**. 현재 GPS는 `restricted_zones` 위험구역 경보·`track-location` 중심.

---

## 2. 라우팅 및 앱 분할 구조

### 2.1 Canonical prefix

| Prefix | 모듈 | 역할 |
|--------|------|------|
| `/app/worker/*` | `WorkerAppRoutes.tsx` | 근로자/모바일 번들 (lazy pages, Leaflet 미포함 목표) |
| `/app/admin/*` | `AdminAppRoutes.tsx` | 관리자/데스크톱 번들 (`AppLayout` + sidebar) |
| `/m/*`, bare `/*` | `LegacyPathRedirect` | canonical로 리다이렉트 |
| `/worker/*`, `/tbm/:token`, `/z/:code` | 공개·QR 경로 | Auth 세션 없이 동작 |

정의 위치: `src/App.tsx`, `src/routes/*`, `src/architecture/safetySystemMap.ts`

### 2.2 Lazy 분할

- 공개 페이지: `App.tsx`에서 `React.lazy`
- Worker/Admin 페이지: `src/routes/lazyPages.ts` (약 91개 export)
- `WorkerAppRoutes` / `AdminAppRoutes` 모듈은 static import, 내부 페이지는 lazy → Suspense 이중 래핑

### 2.3 Auth Guard 흐름

```text
main.tsx → App
  QueryClient → Tooltip → BrowserRouter
    → AuthProvider
      → SystemRealtimeProvider
        → Routes
           ├ /login|/auth  → AuthRoute (로그인 후 기본 /app/admin)
           ├ /app/worker/* → WorkerAppRoutes  【공통 로그인/역할 Guard 없음】
           └ /app/admin/*  → AdminAppRoutes
                               1) !user → /login
                               2) account_status pending/inactive 차단
                               3) master 아니면 project_members 존재 확인
                               4) AppLayout → ContractorGate → Routes
                               5) 일부 설정/감사 페이지만 RoleGuard
```

| Guard | 파일 | 실제 범위 |
|-------|------|-----------|
| Admin shell 인증 | `AdminAppRoutes` | 로그인 + membership (역할≠admin이어도 membership 있으면 진입 가능) |
| `RoleGuard` | `components/RoleGuard.tsx` | 설정·감사·AI 테스트 등 **일부** admin 경로만 |
| Worker shell | — | **공통 Auth/Role Guard 부재**. `MobileHome`은 비로그인도 허용 |
| `MobileRedirectGuard` | viewport&lt;768 → worker로 강제 | 역할 기반이 아닌 디바이스 기반 |
| 데이터 경계 | RLS + `useProjectAccess` / `useMobileAccess` | UI 메뉴 숨김 ≠ 라우트 보안 |

### 2.4 GPS/출퇴근·TBM 관련 기존 라우트

| 경로 | 용도 |
|------|------|
| `/app/worker` + `GeofenceAlertBridge` | 위험구역 추적 (홈에서만 마운트) |
| `/app/worker/geofence-drop` | Walk&Drop 구역 생성 |
| `/app/worker/tbm` | TBM 세션 생성(로그인 사용자) |
| `/tbm/:token` | 공개 TBM 참여·서명 |
| `/worker/portal/:token` | QR 근로자 포털(출입·TBM·추적) |
| `/z/:code` | 구역 QR 체크인 |
| `/app/admin/site-control-map` | 통합 관제맵 |
| `/app/admin/zone-events`, `worker-distribution`, `admin/tracking-health` | 이벤트·분포·추적 헬스 |
| `/app/admin/tbm-logs` | TBM 로그(세션/참여 조회 UI; DB 테이블명 `tbm_logs` 아님) |
| `/app/admin/workers?tab=attendance` | 입퇴장 현황 |

---

## 3. 상태 관리 및 전역 Provider

### 3.1 마운트 트리 (최상단)

```text
QueryClientProvider          ← React Query (서버 상태)
└─ TooltipProvider
   └─ BrowserRouter
      └─ AuthProvider         ← 세션·프로필·역할 (localStorage persist via supabase-js)
         └─ SystemRealtimeProvider  ← 알림/구역 Realtime + GPS API(미소비)
            ├ Routes…
            ├ MobileRedirectGuard
            ├ InstallPrompt
            ├ OfflineSyncMount      ← 60s 오프라인 동기화 폴링
            └ PushNotificationBridge
```

Admin 한정 추가: `AppLayout` 내부 `ProjectAccessContext` (`selectedProjectId` localStorage).

### 3.2 세션 영구 유지

`src/integrations/supabase/client.ts`:

- `persistSession: true`
- `autoRefreshToken: true`
- `storage: localStorage`
- `detectSessionInUrl: true`

`AuthProvider`는 `onAuthStateChange` + `getSession` 이중 초기화. 별도 `AuthManager`/`SessionManager` 클래스는 없음.

QR 근로자 세션은 Auth와 분리되어 `workerToken` localStorage에 저장.

### 3.3 GPS 추적

| 경로 | 구현 | 소비 여부 |
|------|------|-----------|
| `SystemRealtimeProvider.startGpsTracking` | Web Worker tick(15s) + `getCurrentPosition` | **호출처 없음 (dead API)** |
| `lib/tracking/locationTracker.ts` | Native BG → Capacitor → browser watch | **실사용** (`WorkerTrackingCard`, `GeofenceAlertBridge`) |
| Edge `track-location` | 서버 권위 구역 판정 + `worker_zone_events` insert | 실사용 |

`GeofenceAlertBridge` 마운트 위치: **`MobileHome`, `WorkerPortal`만**. 다른 `/app/worker/*` 페이지로 이동 시 추적 중단.

### 3.4 Realtime WebSockets

- 전부 Supabase `postgres_changes` (Broadcast/Presence 미사용).
- 전역: `notifications`, `worker_zone_events` (SystemRealtimeProvider) — **훅 소비처 없음**; `NotificationBell`이 알림을 중복 구독.
- 페이지 로컬: Dashboard, Approvals, ZoneEvents, WorkerDistribution, TBM, AI jobs 등 다수.
- **Publication 마이그레이션**: `ai_generation_jobs`, `ai_generated_items_buffer`만 `supabase_realtime`에 ADD. `notifications`/`worker_zone_events` 등은 버전관리된 publication 기록이 없어 **원격에서 수동 활성화되지 않았다면 이벤트가 오지 않음**.

---

## 4. API 및 AI 연동 현황

### 4.1 엔드포인트 분리

| 기능 | Edge Function | 클라이언트 |
|------|---------------|------------|
| 위험성평가 | `generate-risk-ai` | `generateRiskItemsStreaming()` (`riskAutoGenAI.ts`) |
| 사고사례 | `generate-accident-ai` | `generateAccidentCasesStreaming()` |
| 백그라운드 배치 | `risk-job-orchestrator` | Settings AI / jobs |

- 프롬프트·정규화·캐시 테이블·SSE 이벤트 타입이 명확히 분리됨.
- 모델 계층: `_shared/gemini.ts` → 실제로는 **NVIDIA NIM** (`NVIDIA_API_KEY`).

### 4.2 캐싱 (DB First) — 의도 vs 실제

의도 파이프라인:

```text
Client → Edge (SSE)
       → 1) exact ai_*_cache
       → 2) approved DB corpus (library / assessment_accidents)
       → 3) LLM
       → 4) upsert cache
```

| 항목 | 위험성평가 | 사고사례 |
|------|------------|----------|
| 캐시 테이블 | `ai_risk_cache` ✅ | `ai_accident_cache` (20260729030000, **원격 미적용 가능**) |
| 클라이언트 DB 직접 조회 | 없음 (서버 위임) | 없음 |
| 정상 UI 경로 | **phase_id 단위 호출 → exact cache 우회** | 첫 호출 LLM 성공 가능 / **캐시 히트 SSE 비호환** |
| `types.ts` | 반영됨 | **미반영** |

공유 헬퍼: `_shared/aiResponseCache.ts` 존재하나 엔드포인트마다 키·조회·SSE 로직이 중복/불일치.

### 4.3 기타 API

- `track-location`: GPS/지오펜스 서버 판정 (service role)
- TBM/출입 RPC: `worker_has_tbm_today`, 서명·무재해 확인 인자 RPC
- 오프라인: `useOfflineSync` 60초 폴링

---

## 5. 결함 및 단절 경고 (Integrity Warnings)

GPS 100m 출퇴근·일일 TBM/무재해 파이프라인 통합 전에 **반드시 인지·해소해야 할** 항목.

### 5.1 스키마·마이그레이션

1. **`v_safety_work_bundle` / 번들 FK 원격 미적용 위험** — `db push`가 `session_date` 오타로 실패했으므로 `work_permit_assessment_links`, 핵심 FK 3종, `ai_accident_cache`가 원격에 없을 수 있다. (`tbm_date` 수정 + version uniquify는 PR #64)
2. **`types.ts` 드리프트** — 번들 뷰/junction/`ai_accident_cache`/`rule_type` 등 미반영 → `as any` 남발, 컴파일 타임 안전망 상실.
3. **`workers` · `work_permits.project_id` · `tbm_sessions.project_id` · `worker_entry_logs` · `work_permit_workers` FK 공백** — 출퇴근·TBM 파이프라인의 핵심 조인이 전부 소프트 참조.
4. **`tbm_participations.worker_id` 부재** — 전화번호 문자열만으로 `workers`와 연결; 번호 변경·중복 시 출입/서약 이력 단절.
5. **`tbm_logs` 테이블 없음** — UI 라우트명과 스키마 불일치; 실제는 `tbm_sessions`+`tbm_participations`.
6. **`approvals.entity_id` 다형 참조** — DB 레벨 무결성 없음.
7. **배열 FK 부재** — `banned_worker_ids`, `linked_assessment_run_ids`, `target_company_ids` 등.
8. **`work_permit_assessment_links` RLS** — authenticated 전원 `USING (true)` 쓰기 가능(프로젝트 격리 없음).

### 5.2 라우팅·권한

9. **`/app/worker` 공통 Auth Guard 부재** — URL 직접 접근 시 UI만 열리고 보안은 RLS에만 의존.
10. **로그인 후 기본 목적지 항상 `/app/admin`** — worker 역할 판정 없음; 모바일은 viewport redirect로 보정.
11. **Admin shell이 “관리자 역할”이 아닌 “membership”만 검사** — worker/viewer도 admin URL 진입 가능.
12. **`ContractorGate` prefix가 레거시 bare 경로** — `/app/admin/...` canonical과 불일치 → 잘못된 redirect/루프 위험.
13. **`RoleGuard` 거부 목적지 `/`** — 다시 `/app/admin`으로 canonical 변환되어 “거부”가 명확하지 않음.
14. **Auth `loading=false` 레이스** — 프로필/역할 fetch 완료 전 RoleGuard가 저권한으로 오판 가능.
15. **이중 근로자 신원(Auth vs QR token)** — GPS 100m 출퇴근을 어디에 귀속할지 SSOT 미정.

### 5.3 GPS·Realtime·전역 상태

16. **`SystemRealtimeProvider` GPS/알림 API dead code** — `useSystemRealtime` 소비처 0; 실제 추적은 페이지 로컬.
17. **`GeofenceAlertBridge`가 홈/포털에만 마운트** — worker 하위 페이지 이동 시 추적 중단 → 상시 출퇴근 지오펜스에 부적합.
18. **`WorkerPortal`에서 트래커 이중 기동** — `WorkerTrackingCard` + `GeofenceAlertBridge` 동시 가능 → 중복 `track-location` 호출.
19. **Provider GPS payload 스키마 불일치** — `{accuracy, source}` vs Edge 기대 `accuracy_m` (Zod strip → 정확도 0으로 취급).
20. **Realtime publication 미버전화** — `notifications`/`worker_zone_events` 등이 publication에 없으면 UI 구독이 무반응(폴링 fallback 일부만 존재).
21. **클라이언트 vs Edge `accessRules` 로직 불일치** — `rule_type` 컬럼 vs JSON 우선순위 다름 → 로컬 경보와 서버 이벤트가 어긋날 수 있음.
22. **`track-location` service-role + 호출자-좌표/신원 바인딩 약함** — 위조 좌표·타인 전화 스푸핑 여지; anonymous insert 정책도 존재.
23. **퇴장 이벤트가 이전 zone_id를 유지** — 재진입/중복 exit 판정 왜곡 가능.
24. **현장 기준 100m 출퇴근 반경 로직 부재** — `projects.site_lat/lng`는 있으나 “출근=현장 100m 진입” 상태머신이 없음. 현 GPS는 위험구역 DENY/ALLOW 중심.
25. **PWA/백그라운드 신뢰성** — Web Worker 타이머는 백그라운드 중단; Capacitor BG 플러그인은 portal/card 경로에만 연결.

### 5.4 AI·캐시

26. **사고사례 캐시 히트 SSE ↔ 클라이언트 파서 불일치** — 서버 `type:"item"` / 클라 `type:"accident"` → 재호출 시 0건·에러.
27. **위험성평가 정상 UI가 phase 단위라 exact cache 우회** — DB First 캐시가 사실상 미사용.
28. **`standard_risk_library.process_name` / `assessment_accidents.title` 등 존재하지 않는 컬럼 조회** — library short-circuit 실패.
29. **리스크 라이브러리 매퍼 필드명 불일치** — `process`/`hazard_situation` 등 클라 기대 스키마와 불일치.
30. **`risk-job-orchestrator`가 SSE 응답을 `resp.json()`으로 파싱** — 배치 실패.
31. **캐시 키에 `project_id` 미포함 + 전역 UNIQUE** — 프로젝트 간 캐시 오염; accident RLS SELECT가 전 authenticated 공개.
32. **`ai_accident_cache` 자체가 번들 마이그레이션에 묶여 원격 미생성 가능**.

### 5.5 출퇴근·TBM·무재해 파이프라인 관점 단절

33. **입퇴장(`worker_entry_logs`)과 GPS 이벤트(`worker_zone_events`) 미연동** — 출퇴근 SSOT가 QR/RPC 중심이며 GPS 진입이 출근으로 승격되지 않음.
34. **무재해 서약(`no_accident_confirmed`)은 포털/RPC에 존재하나 GPS 게이트와 무관**.
35. **일일 TBM 게이트(`worker_has_tbm_today`)는 QR 포털에 존재하나 `/app/worker` Auth 근로자 홈 플로우와 단절**.
36. **MobileHome `attendance` 타일이 bare `/worker-attendance`** — admin으로 legacy redirect 후 모바일이 다시 worker로 튕길 수 있음.
37. **`manifest.json` start_url이 여전히 `/m`** — canonical `/app/worker`와 불일치.
38. **성능**: 다수 페이지가 Realtime+폴링 병행; 전역 zone 채널이 프로젝트 필터 없이 구독되면(publication 활성화 시) 이벤트 폭주 가능. AI phase N회 순차 호출은 레이턴시·비용 병목.

---

## 부록 A. GPS 100m 파이프라인 통합 시 권장 앵커 포인트

| 레이어 | 재사용 | 신규 필요 |
|--------|--------|-----------|
| 위치 | `locationTracker`, `track-location`, Capacitor BG | 현장 중심 100m 상태머신, 출퇴근 이벤트 타입 |
| 신원 | `workers`, `profiles.phone`, QR token | Auth↔QR SSOT 통합 또는 명시적 브릿지 |
| 출입 | `worker_entry_logs`, RPC, `no_accident_confirmed` | GPS 진입 → entry_log upsert 트랜잭션 |
| TBM | `tbm_sessions`, `tbm_participations`, `worker_has_tbm_today` | 일일 파이프라인 오케스트레이션(출근→TBM→서약) |
| 구역 | `restricted_zones` (위험) vs `projects.site_lat/lng` (현장) | **개념 분리**: 위험구역 ≠ 출퇴근 지오펜스 |
| UI | `WorkerPortal`, `MobileHome`, admin attendance | worker shell 전역 GPS Provider 마운트 + Auth Guard |

## 부록 B. 주요 파일 인덱스

| 영역 | 경로 |
|------|------|
| 라우트 | `src/App.tsx`, `src/routes/WorkerAppRoutes.tsx`, `src/routes/AdminAppRoutes.tsx`, `src/routes/lazyPages.ts` |
| Auth | `src/contexts/AuthContext.tsx`, `src/components/RoleGuard.tsx`, `src/lib/workerAuth.ts` |
| Provider | `src/providers/SystemRealtimeProvider.tsx` |
| GPS | `src/lib/tracking/locationTracker.ts`, `src/components/geofence/GeofenceAlertBridge.tsx`, `supabase/functions/track-location` |
| 번들 ERD | `supabase/migrations/20260729030000_safety_work_bundle_fks.sql`, `src/lib/safetyWorkBundle.ts` |
| AI | `supabase/functions/generate-risk-ai`, `generate-accident-ai`, `src/lib/riskAutoGenAI.ts` |
| 타입 | `src/integrations/supabase/types.ts` |
| 맵 주석 | `src/architecture/safetySystemMap.ts` |

---

*본 보고서는 코드·마이그레이션 정적 스캔 결과이며, 원격 Supabase 대시보드의 수동 publication/마이그레이션 이력은 로컬 저장소와 다를 수 있다.*
