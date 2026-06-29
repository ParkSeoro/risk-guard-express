# Feature Card #19 — 알림 센터 (`notifications` + `notification_preferences`)

대상: `NotificationBell.tsx`, `SettingsNotifications.tsx`, `MobileAlerts.tsx`, `lib/notificationService.ts`

## 1. Happy Path
- 결재 요청/승인/반려, 위험성평가 완료, 작업허가 만료 임박, 사고/대피훈련, 무재해 만료 등 이벤트가 발생하면 `notifications` 가 생성된다.
- 우상단 종(Bell)에 미읽음 배지 표시 → 클릭 시 안읽음/전체 탭 + 클릭 시 해당 화면으로 딥링크.
- 모바일 사용자는 `/mobile/alerts` 에서 전체 목록 확인, 설정에서 채널별 ON/OFF.

## 2. Permission
- `notifications` RLS: `user_id = auth.uid()` 본인만 조회/업데이트.
- 발신은 트리거 또는 `notificationService` 를 통한 service-role 기반 insert.

## 3. Scope
- Bell 은 최근 30건만 조회 (그 이상은 "전체 보기" 페이지로 이동).
- Realtime postgres_changes(`user_id` 필터)로 즉시 반영 + 60초 폴백 폴링.

## 4. Empty / Loading
- 탭별 분리 빈 상태 메시지(안읽음 없음 / 알림 없음).
- 로딩 자체는 빠른 단일 쿼리라 스피너 생략(드롭다운 UX 우선).

## 5. Edge Inputs
- `related_type` 가 매핑 테이블에 없으면 비클릭(딥링크 X) 처리.
- `message` 가 없으면 본문 영역 자동 숨김.

## 6. State Sync
- Realtime + 폴백 폴링 동시 운용.
- 모두 읽음·개별 읽음 클릭 시 옵티미스틱 업데이트.

## 7. Audit
- 알림 자체는 사용자 메시지라 audit 대상에서 제외(트리거 발화원이 audit 처리).

## 8. Rollback
- 미발송/잘못된 알림은 마스터가 직접 삭제 가능. preferences로 채널별 disable.

## 추가 개선
- `ROUTE_MAP` SSOT: assessment_run / approval / work_permit / work_plan / safety_inspection / incident_report / emergency_drill / todo / work_stop / safety_cost_report / education / worker / chemical.
- 알림 설정 단축 버튼(헤더 톱니), 전체 보기 풋터 버튼.
- 안읽음/전체 탭 + 카운트 배지.
