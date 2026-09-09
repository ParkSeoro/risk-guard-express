# 알림 시스템 분석

> 작성: 2026-09-09 · 범위: 인앱 알림 / 웹푸시 / FCM / 이메일 / 수신설정
> 방법: 관련 소스 정독 (코드 수정 없음)

후속 작업 지시서: [`notification-fix-prompts.md`](./notification-fix-prompts.md)
관련: [`zone-alarm-recipients.md`](./zone-alarm-recipients.md) · [`approval-push-checklist.md`](./approval-push-checklist.md) · [`google-services-fcm.md`](./google-services-fcm.md)

---

## 0. 요약

알림의 **발송 인프라 자체는 잘 만들어져 있습니다.** FCM HTTP v1 정식 구현, iOS Critical Alert, 만료 토큰 자동 정리, 13개 타입별 수신설정과 방해금지 시간까지 갖춰져 있습니다.

문제는 **발송 경로가 두 갈래로 갈라져 있고**, 그중 하나가 수신설정을 우회하면서 같은 알림을 한 번 더 보낸다는 점입니다. 그리고 **발송 실패가 3중으로 침묵**해서 장애를 사후에 조사할 방법이 없습니다.

| 구분 | 건수 |
|------|------|
| 확인된 오류 | 5 |
| 취약·누락 | 5 |
| 추가 제안 | 7 |

가장 시급한 단일 항목은 **N-01(웹푸시 중복 발송)** 입니다. `fetch` 블록 하나를 지우면 N-01·N-02·N-03이 동시에 해결됩니다.

---

## 1. 구조

```
[경로 A · DB 트리거]  트리거 8종 / notify_masters / notify_project_roles
                        → notifications INSERT
                        → trg_notifications_dispatch_push (pg_net)
                        → dispatch-notification-push
                        → 웹푸시(VAPID) + FCM v1        ※ 이메일 없음

[경로 B · 클라이언트]  sendNotification()  (7개 페이지)
                        → send-notification-email
                        → 이메일(Resend) + notifications INSERT ─┐
                        → send-push (웹푸시) ───────────────────┘ 트리거가 또 발동
```

**테이블**

| 테이블 | 역할 |
|--------|------|
| `notifications` | 인앱 알림 본체. INSERT가 푸시 파이프라인의 트리거 |
| `notification_preferences` | 채널 on/off, 방해금지 시간, 이벤트별 플래그 |
| `device_push_tokens` | 네이티브 FCM/APNs 토큰 |
| `push_subscriptions` | 웹푸시(VAPID) 구독 |

**알림 생성 트리거 8종**
`trg_approval_notify_approver` · `trg_approvals_notify_ins` · `trg_approvals_notify_upd` ·
`trg_assessment_run_approved_notify` · `trg_incident_notify_assessment_owners` ·
`trg_todo_notify_user` · `trg_work_stop_notify` · `trg_zone_event_notify`

**경로 B를 쓰는 페이지 7곳**
`Approvals` · `AssessmentRunDetail` · `MobileDailyHealthLog` · `SafetyInspections` · `SafetyCost` · `MobileInspect` · `MobileIncident`

---

## 2. 잘 되어 있는 부분

- **FCM HTTP v1 정식 구현** — 서비스계정 JWT 서명 + OAuth 토큰 캐싱(`dispatch-notification-push/index.ts:97-135`), 레거시 서버키 폴백 유지
- **만료 토큰 자동 정리** — 웹푸시 404/410, FCM `UNREGISTERED` 응답 시 구독·토큰 삭제
- **iOS Critical Alert** — 위험구역 진입 시 `interruption-level: critical` + `siren.wav`, 무음모드 관통 (`index.ts:306-317`)
- **Android 채널 분리** — `safenex_alarms`(사이렌) vs `safenex_default`
- **수신설정이 정교함** — `should_push_notify`가 13개 타입을 개별 플래그에 매핑, 자정 넘김 방해금지 처리, **안전 필수 7종은 설정을 무시하고 강제 발송**
  (`incident`, `approval_request`, `approval_result`, `critical_alert`, `danger_zone_entry`, `emergency_drill`, `work_stop`)
- **역할 라우터 SSOT** — `notify_masters` / `notify_project_roles`로 수신자 팬아웃 일원화 (`20260808010000_notify_role_router.sql`)
- **클라이언트** — Realtime 구독, 푸시 탭 시 딥링크 라우팅, 전체 읽음 처리

> **검증됨**: 위험구역 알림은 `danger_zone_entry` 타입으로 정확히 발행되어(`20260809010000_zone_alarm_recipient_scope.sql:164,177,194`) 방해금지 시간에도 강제 발송됩니다. 안전상 가장 중요한 경로는 올바릅니다.

---

## 3. 확인된 오류

### N-01 · 웹푸시가 2번 발송됩니다 ★최우선

`supabase/functions/send-notification-email/index.ts`

| 위치 | 동작 |
|------|------|
| `:101-102` | `notifications` INSERT → 트리거 → `dispatch-notification-push` → **웹푸시 + FCM** |
| `:194-205` | `send-push` 직접 호출 → **웹푸시 (또)** |

`send-push`는 `push_subscriptions`(웹푸시)만 읽으므로 **웹/PWA 사용자만 중복 수신**하고 네이티브 앱은 1회입니다.

iPhone이 Safari 웹/PWA 공식 경로([`iphone-web-pwa-path.md`](./iphone-web-pwa-path.md))이므로 **iPhone 사용자가 주로 겪습니다.**

영향: `sendNotification()`을 쓰는 7개 페이지 전부.

---

### N-02 · `send-push`가 수신설정을 우회합니다

`supabase/functions/send-push/index.ts`

`dispatch-notification-push/index.ts:191-203`은 `should_push_notify` RPC로 수신설정·방해금지 시간을 확인하는데, `send-push`에는 **그 검사가 없습니다.**

→ 사용자가 푸시를 껐거나 방해금지 시간(예: 22:00~07:00)이어도 이 경로로는 알림이 발송됩니다. N-01과 겹치면 **"껐는데도 오고, 심지어 두 번 온다"** 가 됩니다.

`send-push`에 있는 검사는 인가(누구에게 보낼 수 있는가, `:66-76`)뿐이고 수신자 의사는 확인하지 않습니다.

---

### N-03 · 레거시 딥링크

`supabase/functions/send-notification-email/index.ts:203`

```js
url: related_type === 'safety_inspection' ? '/m/actions' : '/m/alerts',
```

`dispatch-notification-push/index.ts:64-66`에는 `/m/` → `/app/worker/` 변환 로직이 있지만 `send-push` 경로에는 없습니다.

→ N-01로 중복 발송된 두 알림이 **서로 다른 경로로 이동**합니다.

---

### N-04 · 발송 실패가 3중으로 침묵합니다

```sql
-- 20260727062104_*.sql : trg_notifications_dispatch_push
EXCEPTION WHEN OTHERS THEN RETURN NEW;   -- 모든 오류 삼킴
```

1. 트리거가 예외를 전부 삼킴 (푸시 실패가 알림 저장을 막지 않게 하려는 의도)
2. `pg_net.http_post`는 fire-and-forget이라 응답을 보지 않음
3. `dispatch-notification-push`는 채널별 성공/실패 카운트를 **반환만 하고 저장하지 않음** (`index.ts:221-225`의 `result`, `:418`에서 반환)

→ **"알림이 안 왔다"는 신고를 조사할 방법이 전혀 없습니다.** FCM 서비스계정 키가 만료되거나 `PUSH_TRIGGER_SECRET`이 어긋나도 아무도 모릅니다.

GPS 진단서의 F-08(하트비트 부재)과 **같은 구조의 관측성 공백**입니다.

---

### N-05 · 재시도가 없습니다

FCM 5xx 같은 일시 오류 = 알림 영구 소실. 결재 요청·작업중지처럼 놓치면 안 되는 알림도 동일합니다.

---

## 4. 취약·누락

### N-06 · SMS·카카오 채널이 설정에만 존재합니다

`notification_preferences`에 `channel_sms`, `channel_kakao` 컬럼이 있지만 **발송 구현이 저장소 어디에도 없습니다.** (solapi / aligo / NHN / Twilio 등 전무)

→ 토글해도 아무 일도 일어나지 않습니다.

### N-07 · 행 단위 HTTP 발송

`trg_notifications_dispatch_push`가 `FOR EACH ROW`입니다. `notify_project_roles`가 관리자 20명에게 INSERT하면 **HTTP 요청 20회**가 각각 나갑니다. 배치·큐 없음.

### N-08 · 보관 정책이 없습니다

`notifications`는 무한 누적되는데 조회는 하드컷이고 페이지네이션이 없습니다.

- `src/components/NotificationBell.tsx:32` — `.limit(30)`
- `src/pages/MobileAlerts.tsx:25` — `.limit(50)`

→ 알림이 쌓이면 그 이전 것은 영영 볼 수 없습니다.

### N-09 · 딥링크 정밀도가 낮습니다

`dispatch-notification-push/index.ts:43-56` `ENTITY_ROUTES`에서 아래는 **id를 무시하고 목록 페이지로만** 이동합니다.

`safety_inspection` · `incident` · `emergency_drill` · `tbm` · `todo` · `worker` · `chemical` · `safety_cost`

→ "○○ 사고가 보고되었습니다" 알림을 눌러도 사고 **목록**이 뜹니다.
(`work_plan` / `work_permit` / `assessment_run`은 id를 정상 사용)

### N-10 · 라우터 기본 타입이 설정 매핑에서 누락

`notify_project_roles`의 기본 `_type`은 `task_assigned`, `notify_masters`는 `warning`인데 둘 다 `should_push_notify`의 명시 매핑에 없어 `event_general`로 폴백합니다.

→ **호출 시 타입을 명시하지 않으면, 사용자가 일반 알림을 끄는 순간 함께 꺼집니다.** 안전 관련 알림을 라우터로 보낼 때는 타입을 반드시 명시해야 합니다.

---

## 5. 추가 제안

| 우선 | 기능 | 근거 |
|------|------|------|
| **1** | **카카오 알림톡** | 한국 건설현장 B2B의 사실상 표준. 근로자는 앱 미설치·푸시 거부가 흔합니다. `channel_kakao` 컬럼이 이미 있어 발송만 붙이면 됩니다 |
| **2** | **`notification_deliveries` 전달 기록** | 채널별 성공/실패/시각 저장. N-04를 조사 가능하게 만드는 전제 |
| **3** | **재시도 큐** | pg_cron으로 실패 레코드 재처리. 결재·작업중지는 유실되면 안 됩니다 |
| **4** | **에스컬레이션** | 결재 N시간 미처리 → 상위 결재자/안전관리자에게. 안전 시스템의 핵심 패턴인데 없습니다 |
| **5** | **묶음 발송(digest)** | 비긴급 알림을 5분·1시간 단위로 묶기. 현재는 이벤트마다 즉시 발송이라 알림 피로가 큽니다 |
| **6** | **수신확인 기록** | 작업중지·위험구역처럼 법적 통지 성격의 알림은 "봤다"는 기록이 필요할 수 있습니다 |
| **7** | 허가서 만료·연장 리마인더 | 건강진단(`health-checkup-reminder`)과 근로자 필수항목 D-7(`worker-daily-scheduler`)은 있는데 허가서는 없습니다 |

---

## 6. 로드맵

상세 작업 지시는 [`notification-fix-prompts.md`](./notification-fix-prompts.md)에 있습니다.

| 단계 | 기간 | 내용 | 해결 항목 |
|------|------|------|-----------|
| **1** | 반나절 | 중복 발송 제거 + 수신설정 검사 추가 | N-01, N-02, N-03 |
| **2** | 1–2주 | 전달 기록 · 딥링크 정밀도 · 페이지네이션/보관 | N-04, N-08, N-09 |
| **3** | 이후 | 카카오 알림톡 · 재시도 큐 · 에스컬레이션 | N-05, N-06, 제안 1·3·4 |

1단계 작업 1은 `fetch` 블록 하나를 지우는 것으로 N-01·N-02·N-03이 동시에 해결됩니다.
