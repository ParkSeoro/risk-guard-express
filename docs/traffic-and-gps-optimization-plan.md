# SafeNex 시스템 트래픽, GPS 및 알림(허가서·작업계획서) 최적화 설계서
> **문서 목적**: 커서(Cursor) 및 엔지니어 간 공유용 종합 최적화 설계 문서  
> **핵심 원칙**: **"근로자 생명 안전(위험구역 접근 경보) 효용성 100% 유지 + 서버 트래픽·DB 부하·Supabase 과금 90% 이상 절감"**

---

## 1. 배경 및 문제 진단

SafeNex는 실시간 안전관리(근로자 위치 관제, 위험구역 진입 차단, TBM, 비전 스트리밍, 작업허가서 및 법적 의무 알림)를 제공하는 복합 시스템입니다.  
현재 코드베이스를 정밀 분석한 결과, **사용자(근로자/관리자) 수가 증가할 때 서버 리소스 고갈 및 요금 폭탄을 유발할 수 있는 지점**이 식별되었습니다.

### 🚨 주요 병목 및 과금 유발 요소 종합 현황

| 구분 | 발생 지점 (코드) | 현재 동작 방식 | 부하 및 과금 위험 |
| :--- | :--- | :--- | :--- |
| **GPS 위치 보고** | `src/lib/tracking/locationTracker.ts`<br>→ `supabase/functions/track-location` | 이동 시 12~45초, 위험 시 5초마다 **Edge Function 호출** | 근로자 500명 동시 작업 시 **일 10~20만 회 호출**<br>👉 Supabase 무료 한도(월 50만 회) 며칠 만에 초과, DB Write IOPS 폭증 |
| **비전 CCTV 스트리밍** | `src/components/vision/VisionLivePane.tsx` | HLS 비디오 스트림 상시 수신 + 10초마다 viewer-hold ping | 1채널당 1.5~4Mbps Egress 소모<br>👉 4분할 시 시간당 3.6~7.2GB 아웃바운드 트래픽 발생 |
| **초단기 DB 폴링** | `src/pages/MobileTbm.tsx` (154행)<br>`src/pages/AssessmentRunDetail.tsx` (894, 902행)<br>`src/components/geofence/ShellGeofenceAlerts.tsx` (222행) | 4초~15초 주기로 `setInterval`을 통한 DB 테이블 직접 SELECT | 아침 출근(TBM) 시간대 및 관리자 다중 접속 시 **DB 커넥션 풀 고갈 및 쿼리 지연** |
| **알림 및 스케줄러 부하** | `src/pages/Approvals.tsx` (134행)<br>`src/pages/MobileApprovals.tsx` (54행)<br>`trg_notifications_dispatch_push` | 결재 화면 열 때마다 전체 허가서 스캔 RPC 실행,<br>알림 INSERT마다 pg_net ➔ Push Edge Function 연쇄 호출 | 결재함 진입 시마다 무거운 일괄 DB Scan 발생,<br>대량 알림 시 푸시 Edge Function 호출 쿼터 급증 및 Thundering Herd |
| **Realtime 채널 누적** | `src/components/NotificationBell.tsx`<br>`src/components/geofence/ShellGeofenceAlerts.tsx` | 유저별/현장별 WebSocket Realtime 채널 상시 구독 | 동시 접속자(CCU) 증가 시 Supabase 요금제 한도(200~500개) 도달 |

---

## 2. 근로자 안전 보장형 고효율 GPS 위치 추적 아키텍처

> ⚠️ **현장 원칙**: 위험구역(중장비 작업반경, 개구부, 붕괴 위험지 등) 접근 감지는 1초만 늦어도 인명 사고로 이어질 수 있습니다.  
> 따라서 **"서버 트래픽을 아끼기 위해 근로자 안전 판정을 희생시키는 방식"은 절대 불가**합니다.  
> 대신 **"판정은 스마트폰 단말에서 실시간 0ms로 즉각 수행하고, 서버 보고만 고효율 적응형으로 최적화"**하는 **온디바이스 엣지(On-Device Edge) 지오펜싱**을 도입합니다.

```
[ 종 전 ]
스마트폰 GPS Fix ──(5~12초마다 Edge Function 호출)──▶ Supabase Edge Function ──▶ DB 연산 ──▶ 알람 응답
(문제점: 네트워크 지연 300ms~1s 발생 + 서버 호출 비용 월 수백만 건 폭증 + 통신 음영지역 알람 불능)

[ 개선 설계: 온디바이스 1차 판정 + 적응형 하이브리드 보고 ]
스마트폰 GPS Fix
   │
   ├─▶ [온디바이스 실시간 연산] 로컬 캐시된 위험구역과의 거리/진입 판정 (0ms 지연)
   │      ├─ 위험구역 내부/30m 접근: 🚨 스마트폰 자체 사이렌/진동 즉시 발령 (생명 안전 100% 보장)
   │      └─ 일반 안전 구역: 무음 유지
   │
   └─▶ [적응형 서버 동기화 & API 경량화]
          ├─ Tier 0 (위험/접근): 3~5초 즉시 전송 (관리자 관제 지도에 실시간 표출)
          ├─ Tier 1 (일반 이동): 60~120초 주기 (또는 15m 이상 유의미한 이동 시에만)
          ├─ Tier 2 (정지/휴식): 3~5분 하트비트 전송 (동일 좌표 무한 중복 저장 방지)
          ├─ Tier 3 (현장 이탈): 추적 일시 중지 (복귀 감시만 5분 주기)
          └─ API 최적화: 단순 일상 보고는 Edge Function 대신 경량 DB RPC로 직접 전송
```

### 1) 온디바이스 로컬 지오펜싱 (On-Device Geofencing)
- **원리**: 현장의 위험구역(Restricted Zones) 폴리곤 및 반경 데이터는 앱 시작 시 1회 다운로드하여 메모리에 캐싱합니다.
- **동작**:
  - 스마트폰 GPS가 새 좌표를 잡을 때마다 단말 로컬에서 Haversine / Point-in-Polygon 연산을 즉시 수행합니다 (연산 시간 < 1ms).
  - 위험구역 진입 시 **서버 응답을 기다리지 않고 단말에서 즉시 사이렌·진동·음성(TTS) 경보를 발령**합니다.
  - 지하/철골 구조물 등으로 인해 일시적으로 LTE/5G 통신이 끊겨도 **근로자 안전 경보는 로컬에서 정상 작동**합니다.
- **구역 동기화**: 위험구역이 관리자에 의해 새로 등록/수정될 때만 Supabase Realtime 또는 10분 주기 캐시 갱신을 통해 로컬로 내려받습니다.

### 2) 적응형 4단계 전송 주기 (Adaptive Transmission Tier)
근로자의 상태와 위치 위험도에 따라 서버 전송 빈도를 동적으로 자동 조절합니다:

| 등급 | 판정 조건 | 전송 주기 | 목적 |
| :--- | :--- | :---: | :--- |
| **Tier 0: 위험 (Danger/Near)** | 위험구역 반경 30m 이내 또는 구역 내부 | **3초 ~ 5초** | 관리자 관제 지도에 실시간 위험 상황 표출 및 긴급 기록 |
| **Tier 1: 일반 작업 (Safe Moving)** | 위험구역 30m 밖 + 15m 이상 지속 이동 | **60초 ~ 120초** | 작업자 대략적 위치 파악 및 이동 동선 파악 |
| **Tier 2: 정지/휴식 (Idle)** | 2분 이상 제자리 (12m 이내 미세 이동) | **3분 ~ 5분** | 무의미한 동일 좌표 중복 저장 방지 및 단말 배터리 보호 |
| **Tier 3: 현장 이탈 (Off-Site)** | 현장 경계 밖 100m 이상 이탈 (퇴근/식사) | **추적 일시중지** (5분 복귀 감시) | 퇴근 근로자 프라이버시 보호 및 불필요 트래픽 100% 차단 |

### 3) API 호출 경로 경량화: Edge Function 탈피 및 Direct RPC 전환
- **현재 구조**: 매 위치 보고마다 `supabase.functions.invoke("track-location")`를 호출.
  - 문제: Edge Function의 콜드스타트 지연, CPU 시간 소비, 월 50만 회 무료 호출 쿼터 고갈.
- **개선 구조**:
  - **일반 일상 위치 보고**: Supabase의 경량 Postgres RPC `rpc('report_worker_position', { ... })` 또는 PostgREST 직접 `UPSERT`로 전송. Edge Function 호출 횟수 **0회로 절감**.
  - **비인가 위험구역 침범(Unauthorized Entry) 발생 시에만**: `track-location` Edge Function을 호출하여 관리자 긴급 푸시 알림, 이메일, 현장 방송 연동 실행.
- **기대 효과**:
  - Edge Function 월 호출 건수 **500만 건 이상 → 1~2만 건 이하로 99% 급감**.
  - Supabase Pro 요금제 내에서 추가 과금 없이 안정적 운영 가능.

---

## 3. 알림 시스템(작업허가서·작업계획서 등) 트래픽 및 병목 진단 & 개선안

알람과 만료 통지 시스템에서 **트래픽 낭비와 불필요한 서버 부하**를 일으키는 핵심 지점들을 진단하고 대책을 수립합니다.

### 🚨 1) 클라이언트 진입 시 일괄 배치 RPC 실행 문제
- **코드 위치**: `src/pages/Approvals.tsx:134`, `src/pages/MobileApprovals.tsx:54`
  ```typescript
  // Approvals.tsx / MobileApprovals.tsx
  try { await supabase.rpc('promote_permits_to_closure_pending'); } catch { /* ignore */ }
  ```
- **문제 진단**:
  - `promote_permits_to_closure_pending`은 원래 하루 1회 자정(KST 00:00)에 스케줄러가 돌아야 하는 **무거운 일괄 상태 갱신 함수**입니다 (전체 작업허가서를 Full Scan하여 만료 건을 찾고 결재선 행들을 대량 INSERT/UPDATE함).
  - 그런데 관리자/근로자가 **결재 화면을 열 때마다 클라이언트 브라우저에서 이 RPC를 매번 실행**하고 있습니다.
  - 사용자 수십 명이 수시로 결재함을 열면 매번 DB 전체 스캔과 행 락(Row Lock)이 발생하여 심각한 DB CPU 피크와 지연을 유발합니다.
- **해결책**:
  - **클라이언트 화면 로드 시점의 `promote_permits_to_closure_pending` 호출을 즉시 제거**합니다.
  - 상태 승격 및 결재선 생성은 오직 백엔드 스케줄러(`pg_cron` 또는 `worker-daily-scheduler`)에서만 1일 1회 정기 실행하도록 격리합니다.

### 🚨 2) 작업허가서(PTW) 종료시간 실시간 알림의 비효율 방어
- **문제 진단**:
  - 현재 `promote_permits_to_closure_pending`은 작업 당일 실시간이 아니라 **"작업일 다음날(CURRENT_DATE - 1)"**에만 일괄 종료대기로 승격합니다.
  - 만약 "당일 작업 종료 시간(예: 17:00, 18:00) 30분 전 알림" 또는 "종료 즉시 안전점검 확인 요청"을 구현하기 위해 **매 1분~5분마다 전체 허가서 테이블을 스캔하는 크론을 돌리면 DB에 치명적인 부하**가 걸립니다.
- **해결책 (인덱스 기반 핀포인트 쿼리)**:
  - `work_permits` 테이블에 `(status, work_end_at)` 복합 인덱스를 생성합니다.
  - 전체 스캔 대신 `WHERE status = '승인' AND work_end_at BETWEEN now() AND now() + interval '30 minute' AND end_warned_at IS NULL` 조건으로 **해당 30분 내 종료 예정인 허가서 1~2건만 정확히 집어내어 알림을 발송**하고 `end_warned_at = now()`로 마킹합니다.
  - 불필요한 Full Table Scan을 100% 방지합니다.

### 🚨 3) 작업계획서 만료(D-1) 경고 중복 및 다중 스케줄러 정리
- **코드 위치**: `supabase/applied-manually/20261024_scan_work_plan_end_warnings.sql`
- **현황**:
  - `scan_work_plan_end_warnings()` 함수는 `end_warning_notified_at IS NULL` 가드가 있어 다행히 중복 알림은 방어되어 있습니다.
  - 그러나 이 함수가 `pg_cron` (자정 0 15 * * *)과 `worker-daily-scheduler` (Edge Function) 양쪽에서 호출되는 잠재적 중복 실행 구조를 갖고 있습니다.
- **해결책**:
  - 작업계획서 만료 스캔의 실행 주체를 `pg_cron` 단일 파이프라인으로 일원화하여 불필요한 Edge Function 실행 비용을 제거합니다.

### 🚨 4) 알림 생성 시 푸시 연쇄 호출 및 동시 수신 폭풍 (Thundering Herd)
- **코드 위치**: `supabase/migrations/20260917231430_batch_notification_push.sql` (`trg_notifications_dispatch_push`)
- **문제 진단**:
  - `notifications` 테이블에 행이 INSERT될 때마다 트리거를 통해 `dispatch-notification-push` Edge Function을 호출하여 FCM 푸시를 쏩니다.
  - 공지사항이나 안전점검 지시 등으로 수백 명에게 일제히 알림이 발송되면:
    1. Edge Function이 연속 호출되어 쿼터를 소모합니다.
    2. 푸시/Realtime 알림을 수신한 수백 대의 단말이 일제히 `fetchNotifications()`를 호출하여 **단 몇 초 사이에 수백 건의 SELECT 쿼리가 DB로 쏟아지는 Thundering Herd 현상**이 발생합니다.
- **해결책**:
  - **클라이언트 조회 분산 (Jitter)**: Realtime 알림 수신 시 즉시 조회하지 않고, 0 ~ 5초 사이의 무작위 지연(Random Jitter)을 두어 DB 쿼리 피크를 완만하게 분산시킵니다.
  - **인앱 알림 묶음(Digest)**: 동일 문서/이벤트에 대한 알림은 개별 건마다 푸시를 쏘지 않고 1건으로 묶어 발송합니다.

---

## 4. 화면별 단축 폴링 및 대역폭 최적화 설계

### 1) TBM 모바일 출결 실시간화 (`src/pages/MobileTbm.tsx`)
- **현상**: 관리자가 TBM 화면을 열고 있는 동안 **4초마다** `tbm_participations` 테이블을 무조건 SELECT.
- **개선안**:
  - 4초 폴링을 제거하고, `tbm_participations` 테이블의 `INSERT` 이벤트를 Supabase Realtime으로 1회 구독.
  - 근로자가 QR을 찍을 때만 화면에 즉시 1줄이 추가되도록 변경.
  - 폴백 폴링은 60초 간격으로 완화하며, `document.hidden`일 경우 중단.

### 2) 위험성평가 상세 조회 백오프 (`src/pages/AssessmentRunDetail.tsx`)
- **현상**: AI 생성 중 4초마다, 결재 진행 중 15초마다 `fetchAll()` 실행 (탭이 백그라운드여도 계속 조회).
- **개선안**:
  - `document.visibilityState === 'visible'` 조건을 필수 적용하여 사용자가 보고 있을 때만 조회.
  - 결재 진행 중 폴링 주기를 **15초 → 45~60초**로 완화 (결재 상태 변경 시 실시간 브로드캐스트 도입 권장).

### 3) CCTV / Vision Fleet 대역폭 방어 (`src/components/vision/VisionLivePane.tsx`)
- **현상**: 관제 PC에서 탭을 내려두거나 다른 작업을 해도 HLS 비디오 스트림이 백그라운드에서 계속 수신되어 기가바이트 단위 Egress 발생.
- **개선안**:
  - `document.visibilityState !== 'visible'` 감지 시 비디오 요소를 즉시 `pause()`하고 HLS 스트림 버퍼링 중단.
  - `VIEWER_HOLD_MS` 핑도 탭이 비활성 상태일 때는 전송 중단하여 영상 송출 릴레이 서버의 트래픽 차단.
  - 10분 이상 마우스/키보드 조작이 없는 경우 "절전 모드(스트리밍 일시정지, 클릭하여 계속)" 모달 표시.

---

## 5. 결론 및 기대 성과

1. **안전성 향상**:
   - 서버 왕복 통신 지연(0.5~1초) 없이 스마트폰에서 **0ms 즉시 경보**가 울리므로 현장 근로자의 충돌/추락 방지 골든타임 확보.
   - 일시적 통신 음영 구역에서도 로컬 지오펜싱 경보가 중단 없이 작동.
2. **비용 및 트래픽 절감**:
   - Supabase Edge Function 월간 호출 건수: **약 500만 건 → 10만 건 이하 (98% 절감)** (추가 과금 완전 방어).
   - DB 쓰기/조회 쿼리 부하: **85% 이상 절감** (결재 화면 배치 RPC 제거 및 폴링 제거).
   - 알림 수신 시 DB 커넥션 피크(Thundering Herd) 원천 차단.
   - 비전 영상 Egress 대역폭: 백그라운드 탭 차단으로 **불필요한 트래픽 50% 이상 절감**.
