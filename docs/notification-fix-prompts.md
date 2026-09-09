# 알림 시스템 개선 — 단계별 작업 지시서

> 진단 근거: [`notification-system-analysis.md`](./notification-system-analysis.md)
> 사용법: 아래 각 단계 블록을 **하나씩** 커서에 붙여넣습니다. 한 번에 여러 단계를 주지 마십시오.

---

## 공통 원칙

각 단계 프롬프트에 이미 포함되어 있습니다. 참고용입니다.

- **안전 최우선**: 알림에는 작업중지·위험구역 침입 같은 안전 필수 통지가 포함됩니다. 확신이 없으면 물어볼 것.
- 진단서 항목 번호(N-01 등)를 커밋 메시지에 남길 것.
- 패키지 매니저는 **bun**(npm 아님, `AGENTS.md` 참조).
- `bun run test` 기준선은 **898 통과 / 2 실패** — 실패 2건은 Capacitor 패키지 미설치로 인한 기존 환경 문제입니다.
- `bun run lint`는 원래 실패합니다(기존 `no-explicit-any` 다수). 새로 추가한 에러만 확인할 것.

---

## 1단계 — 중복 발송 제거 (반나절)

```
risk-guard-express 알림 시스템 버그 2건을 수정해줘.
근거 문서는 docs/notification-system-analysis.md 이고, 아래 N-번호는 그 문서의 항목 번호야.

이 시스템은 건설현장 안전관리용이고, 알림에는 작업중지·위험구역 침입 같은
안전 필수 통지가 포함돼. 확신이 없으면 임의 판단하지 말고 나에게 먼저 물어봐.

═══ 배경 (먼저 이 구조를 이해할 것) ═══

알림 발송 경로가 두 개야:

[경로 A · DB 트리거]
  notifications 테이블 INSERT
   → 트리거 trg_notifications_dispatch_push (pg_net)
   → supabase/functions/dispatch-notification-push
   → 웹푸시(push_subscriptions) + FCM(device_push_tokens)

[경로 B · 클라이언트]
  src/lib/notificationService.ts 의 sendNotification()
   → supabase/functions/send-notification-email
   → 이메일(Resend) + notifications INSERT + send-push 직접 호출

문제는 경로 B가 notifications 에 INSERT 하는 순간 경로 A 의 트리거도 함께
발동한다는 거야. 그래서 웹푸시가 두 번 나가.

═══ 작업 1 (N-01, N-02, N-03) · 웹푸시 중복 발송 제거 ═══

supabase/functions/send-notification-email/index.ts:194-205

    // 6. Trigger web push (fire-and-forget)
    try {
      fetch(`${supabaseUrl}/functions/v1/send-push`, { ... })
    } catch (_) {}

이 블록을 제거해줘. 이유:
- 바로 위 index.ts:101-102 에서 notifications INSERT 를 이미 하고 있고,
  그 트리거가 dispatch-notification-push 를 호출해서 웹푸시 + FCM 을 모두 보내
- 따라서 이 fetch 는 웹푸시를 한 번 더 보내는 중복이야
- send-push 는 push_subscriptions(웹푸시)만 읽으므로 웹/PWA 사용자만 2번 받고
  네이티브 앱은 1번 받아. iPhone 이 웹/PWA 공식 경로라 iPhone 사용자가 주로 겪어

제거하면 부수적으로 두 가지가 같이 해결돼:
- (N-02) send-push 는 should_push_notify(수신설정·방해금지시간)를 확인하지 않아서
  사용자가 푸시를 꺼도 발송됐는데, 그 우회 경로가 사라짐
- (N-03) send-push 에 넘기던 url 이 레거시 경로('/m/actions', '/m/alerts')인데
  dispatch-notification-push 에는 '/m/' → '/app/worker/' 변환 로직이 있어서
  (index.ts:64-66) 중복된 두 알림이 서로 다른 곳으로 이동하던 문제도 해소됨

제거 전 확인할 것:
- send-notification-email 이 notifications INSERT 에 실패하는 경로가 있는지 확인해줘.
  INSERT 가 실패하면 트리거도 안 돌아서 푸시가 아예 안 나가게 되니까,
  그런 경로가 있으면 나에게 알려주고 대응 방법을 제안해줘.

═══ 작업 2 (N-02) · send-push 에도 수신설정 검사 추가 ═══

supabase/functions/send-push/index.ts

작업 1 이후에도 send-push 는 직접 호출돼
(src/pages/SettingsNotifications.tsx:250 의 "테스트 발송").
그런데 이 함수는 should_push_notify RPC 를 부르지 않아서 수신설정과
방해금지 시간을 무시해. 지금 있는 검사는 인가(누구에게 보낼 수 있는가, :66-76)뿐이야.

dispatch-notification-push/index.ts:191-203 에 있는 것과 동일한 검사를 추가해줘:

    const { data: allowed } = await supabase.rpc("should_push_notify", {
      _user_id: ..., _type: ...
    });
    if (allowed === false) { skipped 응답 }

주의:
- send-push 의 Payload 에 type 필드가 있는지 확인하고, 없으면 추가해서
  호출자가 넘기게 해줘. 없을 때 기본값은 'general' 로.
- 단, 수동 "테스트 발송" 은 설정과 무관하게 나가야 사용자가 테스트할 수 있어.
  bypass_prefs 같은 명시 플래그를 두고 SettingsNotifications 의 테스트 버튼만
  그 플래그를 넘기도록 해줘.

═══ 마무리 ═══
- 작업 1 → 2 순서, 각각 따로 커밋. 커밋 메시지에 (N-01) 같은 항목 번호를 넣어줘
- bun run test 통과 확인 (기준선: 898 통과 / 2 실패.
  실패 2건은 Capacitor 패키지 미설치로 인한 기존 환경 문제야)
- 엣지함수 배포가 필요한 변경이니, 배포 절차도 함께 알려줘
```

---

## 2단계 — 관측성과 사용성 (1~2주)

```
risk-guard-express 알림 시스템 개선 3건.
근거: docs/notification-system-analysis.md 의 N-04, N-08, N-09
1단계(중복 발송 제거)가 끝난 뒤에 진행해줘.

═══ 작업 1 (N-04) · 전달 기록 테이블 — 가장 중요 ═══

지금 알림 발송 실패가 3중으로 침묵해:

1. 트리거가 모든 예외를 삼킴
   supabase/migrations/20260727062104_*.sql
     EXCEPTION WHEN OTHERS THEN RETURN NEW;
2. pg_net.http_post 는 fire-and-forget 이라 응답을 안 봄
3. dispatch-notification-push 는 성공/실패 카운트를 반환만 하고 저장 안 함
   (index.ts:221-225 의 result 객체, index.ts:418 에서 반환만)

그래서 "알림이 안 왔다" 는 신고가 들어와도 조사할 방법이 전혀 없어.
FCM 서비스계정 키가 만료되거나 PUSH_TRIGGER_SECRET 이 어긋나도 아무도 모르는 상태야.

만들어줘:
- notification_deliveries 테이블
  (notification_id, user_id, channel('web'|'fcm'|'email'), status('sent'|'failed'|'skipped'),
   error_code, error_message, attempted_at)
- dispatch-notification-push 가 채널별 결과를 이 테이블에 기록
- 마이그레이션 파일명은 기존 규칙(날짜_설명.sql)을 따를 것
- RLS: 본인 기록은 본인이, 전체는 마스터가 조회.
  기존 정책 패턴은 supabase/migrations/20260818120000_gps_tracking_health.sql 참고
- 쓰기는 service_role 만 (클라이언트 INSERT 차단)

그리고 관리자가 볼 수 있는 간단한 상태 화면도 만들어줘:
최근 24시간 채널별 성공/실패 건수, 실패 상위 사유. 새 페이지를 만들지 말고
기존 관리자 화면 어디에 넣는 게 맞을지 먼저 제안해줘.

═══ 작업 2 (N-09) · 딥링크에 id 반영 ═══

supabase/functions/dispatch-notification-push/index.ts:43-56 의 ENTITY_ROUTES 에서
아래 항목들이 id 를 무시하고 목록 페이지로만 보내:

  safety_inspection: () => "/safety-inspections",
  incident: () => "/incidents",
  emergency_drill: () => "/emergency-drills",
  tbm: () => "/tbm-logs",
  todo: () => "/todo",
  worker: () => "/workers",
  chemical: () => "/health/chemicals",
  safety_cost: () => "/safety-cost",

"○○ 사고가 보고되었습니다" 알림을 눌러도 사고 목록만 떠서 사용자가 다시 찾아야 해.

- 각 엔티티의 상세 라우트가 실제로 존재하는지 src/routes/AdminAppRoutes.tsx 와
  src/routes/WorkerAppRoutes.tsx 에서 먼저 확인해줘
- 상세 라우트가 있는 것만 id 를 붙이고, 없는 건 그대로 두고 목록으로 보내
- 어떤 게 상세 라우트가 없어서 남겨뒀는지 목록으로 보고해줘

주의: work_plan / work_permit / assessment_run 은 이미 id 를 쓰고 있으니
그 패턴을 따르면 돼. 그리고 관리자 라우트(/incidents)와 근로자 라우트
(/app/worker/*)가 섞여 있으니, 수신자 역할에 따라 어느 쪽으로 보내야 하는지도
확인하고 애매하면 나에게 물어봐.

═══ 작업 3 (N-08) · 페이지네이션 + 보관 정책 ═══

지금 알림 조회가 하드컷이라 그 이전 알림은 볼 방법이 없어:
- src/components/NotificationBell.tsx:32  → .limit(30)
- src/pages/MobileAlerts.tsx:25           → .limit(50)

그리고 notifications 테이블에 보관 정책이 없어서 무한 누적돼.

- MobileAlerts 에 "더 보기" 페이지네이션 추가 (커서 기반, created_at 기준)
- NotificationBell 은 30건 유지하되 "전체 보기" 링크를 MobileAlerts 로 연결
- 오래된 알림 정리 정책을 제안해줘. 다만 삭제 기준은 내가 정할 테니
  기간(90일? 180일?)과 "읽은 것만 지울지 / 전부 지울지" 를 옵션으로 제시하고
  승인받은 뒤 마이그레이션을 만들어. 안전 관련 통지 기록은 법적 보존
  의무가 있을 수 있으니 임의로 지우지 마.

═══ 진행 방식 ═══
작업 1 → 2 → 3 순서. 작업 1 의 화면 위치와 작업 3 의 보관 기준은
구현 전에 나에게 물어볼 것. 각각 따로 커밋.
```

---

## 3단계 — 채널 확장 (정책 결정 필요)

> 아래는 외부 서비스 계약과 정책 결정이 선행되어야 하므로 프롬프트를 만들지 않았습니다.
> 진행 시점에 결정 사항을 먼저 확정한 뒤 지시서를 작성하십시오.

| 항목 | 선행 결정 |
|------|-----------|
| **카카오 알림톡** (N-06) | 발신 프로필 개설, 템플릿 사전 승인, 대행사 선정(solapi/aligo/NHN 등) |
| **SMS** (N-06) | 동일. `channel_sms` 컬럼은 이미 존재 |
| **재시도 큐** (N-05) | 재시도 횟수·간격, 최종 실패 시 처리(관리자 통보?) |
| **에스컬레이션** (제안 4) | 미처리 판정 시간, 승계 대상(상위 결재자? 안전관리자?) |
| **묶음 발송** (제안 5) | 묶을 대상 타입, 주기. 안전 필수 7종은 제외해야 함 |

---

## 부록 · 진행 체크리스트

| 항목 | 단계 | 상태 |
|------|------|------|
| N-01 웹푸시 중복 발송 | 1 | ☐ |
| N-02 send-push 수신설정 우회 | 1 | ☐ |
| N-03 레거시 딥링크 | 1 | ☐ |
| N-04 전달 기록 + 상태 화면 | 2 | ☐ |
| N-09 딥링크 id 반영 | 2 | ☐ |
| N-08 페이지네이션 + 보관 정책 | 2 | ☐ |
| N-05 재시도 큐 | 3 | ☐ |
| N-06 카카오/SMS 채널 | 3 | ☐ |
| N-07 행 단위 HTTP 발송(배치화) | 3 | ☐ |
| N-10 라우터 기본 타입 명시 | 3 | ☐ |
