# 알림 숫자와 허가서 최종승인 지연

상태: **제안. 코드는 아직 고치지 않는다.**
작성: 2026-11-08 (Asia/Seoul)
대상: 이 저장소를 읽는 사람, 그리고 이 문서를 보고 설계를 검토할 다른 AI

이 문서는 구현 지시가 아니다. 승인 전에는 코드를 고치지 않는다.
예전 알림 진단(`docs/notification-system-analysis.md`, 2026-09-09)은 푸시가 두 번 나가는 문제다. 이 문서의 주제는 그 문제가 아니다. 화면의 숫자가 늦게 올라가는 것, 그리고 허가서 최종승인 버튼이 기다리는 것이다.

---

## 0. 결론

숫자가 늦게 올라가는 이유는 카운트 SQL이 무겁기 때문이 아니다.

- 종 모양과 데스크톱 **알림** 배지는 카운터를 들고 있지 않다. 알림이 도착하면 목록을 다시 읽고, 그 결과가 끝난 뒤에 숫자를 그린다.
- 웹 사이드바 **전자결재** 배지는 결재 행이 바뀌어도 바로 세지 않는다. 60초마다, 그리고 창을 다시 볼 때만 센다. 이 60초가 “조금 늦다”의 본체다.
- 운영 DB에서 진행중 결재는 20건이다. `count_my_pending_entity_approvals`를 매 사건마다 다시 돌려도, 그 쿼리 자체는 지금 규모에서 체감 지연의 원인이 아니다.

**`-1` 이벤트는 만들지 않는다.** 화면에 “-1”을 보여 주지도 않는다. 이유는 4절.

허가서 최종승인 버튼이 기다리는 시간의 뒤쪽은 승인 저장이 아니다. 저장이 끝난 뒤 화면이 TBM 생성을 기다리고, 위험성평가가 연결된 허가서는 그 자리에서 Gemini를 기다린다. 이어서 그 프로젝트의 결재 전체를 다시 읽어 화면을 로딩으로 바꾼다.

---

## 1. 사용자가 본 증상

1. 결재나 다른 알림이 오면 알림이 뜨고, 알림 옆 숫자가 올라간다. 전자결재 옆 숫자도 그렇다. 그 숫자가 조금 늦다. 숫자를 세는 구조가 잘못된 것이 아닌지 의심이 있다.
2. 허가서 최종승인에도 약간의 로딩이 있다. 코드로 이유를 찾고, 더 나은 방법을 본다.
3. 배지를 `-1` 하는 설계를 굳이 둘 필요가 있는지는 따로 본다.

이 문서에서 “특이사항”은 별도의 카운터 기능이 아니다. 결재 결과 외에 알림 표에 들어오는 다른 사건(공지, 작업중지 등)도 같은 알림 배지를 탄다는 뜻으로 읽었다. 별도 화면의 특이사항 칸은 이 지연과 연결되어 있지 않다.

---

## 2. 2026-11-08 운영 DB에서 본 크기

프로젝트 `qhntxmggacorqjjmjqgo`. 사람 이름과 계정 id는 적지 않는다.

| 대상 | 값 |
|---|---|
| `notifications` | 30,039행. 안 읽음 15,383행. 안 읽음이 있는 계정 680개 |
| 계정별 안 읽음 | 중앙값 5, 90퍼센트 약 23, 최대 676 |
| `notifications` 인덱스 | `notifications_pkey`, `idx_notifications_user_created (user_id, created_at DESC)` |
| 안 읽음만 보는 인덱스 | 없음 |
| `approvals` | 9,899행. 승인 8,655, 취소 930, 반려 270, 대기 24, **진행중 20** |
| `work_permits` | 1,168행 |
| 결재 인덱스 | `idx_approvals_pending_approver (approver_id) WHERE status = '진행중' AND entity_type IS NOT NULL` 가 이미 있다 |

읽는 법: 전자결재 배지가 늦는 이유를 “진행중 결재를 전수 조사해서”로 설명하면 현재 데이터와 맞지 않는다. 알림 배지가 최근 30건만 세면, 안 읽음이 676건인 계정에서는 배지가 실제 안 읽음과 달라지고 `9+`에 고정되기 쉽다.

---

## 3. 숫자가 올라가기까지 코드가 하는 일

배지가 세 군데다. 세는 방식이 서로 다르다.

### 3.1 웹 종 모양 — 최근 30건을 다시 읽고 센다

`src/components/NotificationBell.tsx`

- `fetchNotifications`는 `notifications`에서 내 행을 `created_at DESC`로 30건 읽고 `select('*')` 한다.
- 그 다음 `fetchRevealedWorkStopNames`, `fetchProjectNames`가 끝나야 `setNotifications` 이후의 화면 숫자가 안정된다. 숫자는 `notifications.filter(n => !n.is_read).length` 다. 30건 창 안의 안 읽음이지, 내 안 읽음 전체가 아니다. 10건 이상이면 `9+`로 그린다.
- Realtime `postgres_changes` (`event: '*'`, `user_id` 필터)가 와도 payload를 숫자로 쓰지 않는다. 콜백은 `fetchNotifications()` 뿐이다.
- 같은 조회가 60초마다, 그리고 탭이 다시 보일 때 한 번 더 돈다. 이 60초는 끊김 대비다. 웹 전자결재 배지의 60초와는 역할이 다르다. 종은 실시간 이벤트가 오면 그 전에 갱신할 수 있다.

`src/providers/SystemRealtimeProvider.tsx`는 같은 테이블을 또 구독하고, 이벤트가 올 때마다 `count: exact`로 안 읽음을 다시 센다. 종 모양은 이 값을 그리지 않는다. 종은 자기 30건 창을 그린다. 같은 사건으로 조회가 두 번 나간다.

### 3.2 웹 사이드바 전자결재 — 60초 폴링

`src/hooks/usePendingApprovalsCount.ts`
`src/components/AppSidebar.tsx`의 `badgeKey: "approvals"`

- 마운트, 60초, `focus`, 탭이 다시 보일 때 `count_my_pending_entity_approvals`를 부른다.
- `approvals` Realtime 구독이 없다.
- 그래서 다음 결재자에게 진행중 행이 생긴 뒤, 그 사람 화면에 숫자가 올라가는 데 최대 약 60초가 걸린다. 창을 다시 누르면 그 전에 올라간다.

카운트 함수는 `supabase/migrations/20260919120000_disk_io_approvals_indexes.sql`의 `count_my_pending_entity_approvals`다. 진행중이고 문서가 있는 행만 센다. 내 `approver_id`이거나, 결재자가 비어 있고 내가 그 현장 관리자인 행이다. 행마다 `approval_entity_is_deleted`, `approval_entity_is_voided`를 부른다. 지금은 진행중이 20건이라 이 함수 호출이 배지 지연의 본체는 아니다. 진행중이 수천 건이 되면 그때는 인덱스를 타지 못하는 행별 함수가 무거워질 수 있다.

### 3.3 데스크톱 레일 — 알림과 전자결재를 같이 다시 센다

`src/components/desktop/DesktopRailSidebar.tsx`

- 알림 메뉴 배지 = `unreadNotificationsCount`. 안 읽음 `count: exact`.
- 전자결재 메뉴 배지 = `pendingApprovalsCount`. 위와 같은 카운트 RPC.
- `loadBadges`는 채팅 안 읽음(`get_chat_unread_total`), 전자결재 수, 알림 수를 `Promise.all`로 같이 부른다. 배지 state는 셋이 모두 끝나야 한 번에 갱신된다.
- 이 함수는 경로가 바뀔 때, 그리고 `notifications` 또는 `chat_room_messages`의 Realtime이 올 때마다 돈다.
- 토스트는 INSERT payload의 제목으로 바로 뜬다. 숫자는 `loadBadges`가 끝난 뒤에 올라간다. 채팅이 하나 와도 알림 수와 전자결재 수를 다시 센다.

### 3.4 알림 행이 생기기까지

결재 알림은 `trg_approval_notify` (`supabase/migrations/20260908010000_ra_approval_phase_labels.sql`)가 `approvals` INSERT/UPDATE 안에서 `notifications`에 넣는다. 최종 결과 알림은 수신자마다 INSERT가 한 번씩이다.

푸시는 `trg_notifications_dispatch_push` (`supabase/migrations/20260917231430_batch_notification_push.sql`)가 INSERT 문마다 `net.http_post`로 큐에 넣는다. pg_net은 응답을 기다리지 않는다. 배지가 늦는 이유를 푸시 HTTP 대기로 보면 이 트리거와 맞지 않는다. 수신자별 INSERT가 여러 문이면 큐 적재는 문 개수만큼이다. 한 결재선의 수신자 수 정도다.

Realtime은 그 트랜잭션이 커밋된 뒤에야 구독자에게 간다. 배지는 그 이벤트 이후에 3.1~3.3의 다시 세기를 한다.

---

## 4. `-1`은 만들지 않는다

앞선 초안은 “새 알림이면 +1, 읽으면 -1”이었다. 그 -1은 빼는 편이 맞다.

늦다고 한 것은 숫자가 **올라갈 때**다. 내려가는 쪽은 다른 문제이고, 이벤트마다 -1을 하면 숫자가 어긋난다.

- 사용자가 종에서 읽으면 `markRead`가 이미 그 행만 로컬에서 읽음으로 바꾼다. 배지는 그 목록에서 다시 계산된다. 서버 이벤트를 -1로 번역할 필요가 없다.
- 모두 읽음은 -1이 아니라 창 안의 안 읽음을 한 번에 지운다.
- Realtime `UPDATE`는 읽음 외에도 온다. 모든 UPDATE를 -1로 보면 두 번 빠지거나, 창 밖에 있는 옛 행 때문에 빠진다.
- 전자결재에서 내가 승인하면 내 진행중 행은 사라지고, 다음 사람의 행이 진행중이 된다. 한 사건을 양쪽 화면에 같은 -1로 적용할 수 없다. 다음 사람에게는 올라가야 하고, 나에게는 빠져야 한다.
- 로컬 카운터를 +1만 하고 -1 이벤트로 대칭을 맞추면, 이벤트를 한 번 놓치거나 두 번 받으면 그 오차가 남는다. 30건 창으로 세던 숫자 위에 -1을 얹으면 더 빨리 어긋난다.

그래서 이렇게 나눈다.

| 상황 | 배지가 할 일 |
|---|---|
| 내 알림 INSERT가 온다 | 그 행이 안 읽음이면 화면에 바로 반영하고 숫자를 올린다. 목록 전체와 작업중지 이름, 현장명을 기다리지 않는다 |
| 내가 이 화면에서 읽거나 결재를 처리한다 | 이미 가진 목록에서 그 건을 뺀다. 별도 -1 프로토콜은 없다 |
| 다른 기기에서 읽음, 회수, 놓친 이벤트 | 창을 다시 볼 때와 기존 60초 주기에 **전체를 한 번 다시 센다**. 이 다시 세기는 올라감을 빨리 하려고 두는 것이 아니다. 어긋난 숫자를 맞추려고 둔다 |
| 화면 표시 | “-1”이라는 표시, 감소 애니메이션, 감소 토스트는 넣지 않는다 |

전자결재 배지가 바로 올라가야 하는 경우는 하나다. **내 앞으로 진행중 행이 새로 생겼을 때.** 그때만 숫자를 올린다. 내가 처리해서 빠진 것은 그 화면의 목록에서 이미 빠지므로, 배지도 그 목록을 따른다. 다른 이유로 빠지는 것은 다시 세기가 맞춘다.

안 읽음이 많은 계정(최대 676)에서 배지를 진짜 총액으로 바꿀지는 이 문서가 정하지 않는다. 지금 종은 30건 창이고 10 이상이면 `9+`다. 총액으로 바꾸면 676이 보이고, 창을 유지하면 `9+`가 유지된다. 어느 쪽이 맞는지는 5절 질문에 남겨 둔다. 어느 쪽을 골라도 -1 이벤트는 필요 없다.

---

## 5. 다른 AI가 반박해 주었으면 하는 지점

1. **-1을 없애면 배지가 높게 머물지 않는가.** 제안은 “올라갈 때만 낙관적으로 반영하고, 내려감과 유실된 이벤트는 포커스와 60초 다시 세기로 맞춘다”이다. 유실이 잦으면 다시 세기 주기가 너무 느린지, 아니면 Realtime INSERT만으로 충분한지 판단해 달라.
2. **전자결재 +1의 조건.** “내 `approver_id`로 진행중이 된 행”만 올리면, 결재자가 비어 있고 현장 관리자라서 세는 행은 빠진다. 그 경우를 낙관적 +1에 넣을지, 그 경우만 카운트 RPC를 부를지.
3. **종 배지를 진짜 총액으로 바꿀 것인가.** 30건 창과 `9+`를 유지할지, 안 읽음 총액으로 바꿀지. 총액으로 바꾸면 `(user_id) WHERE is_read = false` 인덱스가 의미 있다. 창을 유지하면 그 인덱스는 이 증상의 필수 조건이 아니다.
4. **데스크톱 `loadBadges`를 쪼갤 때** 채팅 배지 갱신이 느려지지 않는지. 알림 INSERT가 채팅 수를 다시 세우지 않게 하는 것이 목표다.
5. **카운트 함수의 행별 `is_deleted` / `is_voided`.** 진행중 20건에서는 지금 고치지 않아도 된다. 목록 RPC `get_my_pending_entity_approvals` (`20260813030000_retire_inactive_accounts.sql`)는 그 두 조건을 보지 않는다. 배지와 목록이 어긋날 수 있다. 이번 지연 수정에 넣을지, 따로 둘지.
6. **최종승인과 배지를 한 변경으로 묶을지.** 파일도 다르고 원인도 다르다. 한 번에 하는 편이 나은지, 나눠야 하는지.

이 질문들에 “그렇게 하지 말라”는 답이 있으면, 그 이유를 이 문서의 결론보다 우선해서 적어 달라. 코드부터 고치지 말라.

---

## 6. 허가서 최종승인이 기다리는 것

최종 단계의 저장은 `act_on_entity_approval`이다. 최신 정의는 `supabase/migrations/20261023232054_permit_void_request_approval_branches.sql`이다. 승인하면 결재 행을 `승인`으로 바꾸고, 허가서면 도장 jsonb를 넣고, 다음 대기 단계가 없으면 `work_permits.status`를 `승인`으로 바꾼다. 이 트랜잭션 안의 `trg_approval_notify`가 결과 알림을 넣는다. 여기까지가 승인 저장이다.

버튼이 그 다음을 기다린다. `src/pages/Approvals.tsx`의 `runEntityApproval`은 RPC가 끝나면, 일반 단계 승인이고 결과가 최종 발행이면 `ensureTbmAfterPermitIssued`를 **await** 한다. 그 다음에 `fetchEntityPending()`과 `fetchData()`를 부른다.

`src/lib/tbmLifecycle.ts`의 `ensureTbmAfterPermitIssued`는 최종 발행(`finalized === true`, `action === 'approved'`)일 때만 TBM을 만든다. `src/lib/tbmFromPermit.ts`의 `ensureTbmForPermit`은 허가서 행을 `select('*')`로 읽고, `useAiDraft`가 켜져 있으면 `draftTbmBriefingAi`를 기다린 뒤에 INSERT 한다. `Approvals.tsx`는 `useAiDraft: true`로 부른다.

`draftTbmBriefingAi`는 `assessment_run_id`가 있을 때 `generate-education-material`을 부른다. 그 함수는 `supabase/functions/generate-education-material/index.ts`에서 `gemini-2.5-flash`로 `tbm_summary`를 만든다. 연결된 위험성평가가 없으면 양식 문장(`templateBriefingSummary`)으로 바로 간다. 그래서 로딩은 허가서마다 같지 않다. 위험성평가가 연결된 최종승인이 길다.

TBM 행을 넣은 뒤 `link_work_permit_tbm`, `syncPermitCrewToTbm`까지 버튼이 기다린다.

`fetchData`는 그 프로젝트의 `approvals`를 `select('*')`로 읽고 `assessment_runs`도 읽고, 제목을 다시 붙이며 `setLoading(true)`를 한다. 같은 화면은 `approvals` Realtime에서도 `fetchData`와 `fetchEntityPending`을 다시 부른다. 클릭 경로와 구독이 같은 목록을 두 번 다시 읽는다.

중간 단계 승인(다음 사람에게 넘어가는 경우)은 TBM을 만들지 않는다. 그때의 기다림은 RPC와 목록 다시 읽기다. 사용자가 말한 “최종승인 로딩”의 추가분은 TBM과, 연결된 경우의 Gemini다.

모바일도 같은 클라이언트 함수를 기다린다. `src/lib/actOnApprovalClient.ts`의 `submitApprovalAction`, `src/pages/MobileApprovals.tsx`, `src/pages/MobileApprovalDetail.tsx`.

---

## 7. 최종승인 쪽에서 제안하는 동작

승인 RPC가 성공하면 버튼을 푼다. 토스트는 그 시점에 띄운다.

- TBM은 그 다음에 만든다. 실패해도 승인을 되돌리지 않는다. 지금 구조도 TBM 실패는 `console.warn`일 뿐 승인을 취소하지 않는다. 바꾸는 것은 버튼을 그 실패와 그 지연에서 떼는 것이다.
- 일지 본문은 먼저 `templateBriefingSummary`로 저장한다. `assessment_run_id`가 있을 때의 Gemini 요약은 버튼 밖에서 채운다. 승인자가 그 문안을 보지 않은 채로 기다리지 않게 한다.
- 처리한 결재 한 건은 이미 받아 둔 목록에서 뺀다. 프로젝트의 결재 전체를 `select *`로 다시 읽어 페이지를 로딩 상태로 만들지 않는다. 목록을 맞추는 읽기는 뒤로 보내고, Realtime이 같은 읽기를 한 번 더 하게 두지 않는다.
- 결과 알림 INSERT를 수신자마다 한 문씩 하지 않고 한 문으로 모으면, 푸시 큐 적재도 한 번이 된다. 이건 버튼 체감의 본체가 아니다. 최종승인 지연을 고친다고 이 트리거를 먼저 뜯지 않는다.

건드리지 않을 것:

- 결재 순서, 도장에 들어가는 이름과 시각, 누가 알림을 받는지, 반려 시 아직 도착하지 않은 윗단계를 빼는 규칙
- 허가서 상태 값의 뜻, 작업취소·종료·연장 분기
- TBM이 생긴다는 사실. 빠지는 것은 승인 버튼이 Gemini를 기다리는 일이다
- 푸시 파이프라인(`dispatch-notification-push`)과 수신설정
- `docs/notification-system-analysis.md`의 N-01 중복 발송. 이 제안과 같이 고치지 않는다

---

## 8. 승인 후 구현할 때의 확인

아직 구현하지 않는다. 구현하게 되면 아래만 보면 된다.

알림 숫자

- 다른 계정이 결재를 올렸을 때, 다음 결재자 화면의 전자결재 숫자가 60초를 기다리지 않고 올라가는지
- 알림 토스트와 알림 숫자가 같은 사건에서 따로 늦게 돌지 않는지
- 내가 읽은 뒤 숫자가 그 건만큼 빠지는지. 화면에 “-1”이 보이지 않는지
- 모두 읽음, 다른 기기에서 읽음, 회수 뒤에 포커스나 60초 다시 세기로 숫자가 맞는지
- 채팅이 와도 알림·전자결재 수를 다시 세우지 않는지
- 안 읽음이 많은 계정에서 배지가 창(30건, `9+`)인지 총액인지, 5절에서 정한 쪽과 같은지

허가서 최종승인

- 위험성평가가 연결된 허가서의 최종승인에서, 성공 토스트가 Gemini 응답 전에 뜨는지
- 그 다음 TBM 일지가 생기고, 교육 요약이 나중에 채워지는지
- Gemini나 TBM이 실패해도 허가서는 `승인`으로 남는지
- 승인 직후 전자결재 페이지 전체가 로딩 상태로 바뀌지 않는지
- 중간 단계 승인, 반려, 종료, 연장, 작업취소는 지금과 같은 결과인지

테스트는 배지 조건과 “최종 발행만 TBM을 만든다”는 기존 단위 테스트를 유지한다. 운영 DB에 시험 허가서를 넣지 않는다.
