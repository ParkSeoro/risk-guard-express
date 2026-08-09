# 위험구역 알람 수신 대상 (SSOT)

`unauthorized_entry` 발생 시 (`trg_zone_event_notify`):

| # | 대상 | 채널 | 범위 |
|---|------|------|------|
| 1 | 위반자 본인 | 로컬 사이렌/TTS + 푸시 | 본인 기기 |
| 2 | 프로젝트 관리자 (`project_admin`, 직책 `OWNER_PM`/`OWNER_CM`) | 푸시/인앱 알림 | 프로젝트 전역 |
| 3 | 위반자 소속 회사 관리자 (`safety_manager` / `site_manager` / `site_supervisor` + 대응 직책) | 푸시/인앱 알림 | **해당 회사만** |

- 다른 회사 관리자·일반 근로자 전원에게는 보내지 않음.
- 근로자/관리자 위반 모두 동일 규칙.
- 로컬 풀스크린 사이렌은 위반자 GPS(또는 본인 이벤트)만 — 관리자 기기는 푸시로만 수신.

마이그레이션: `20260809010000_zone_alarm_recipient_scope.sql`
