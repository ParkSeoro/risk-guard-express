# Supabase: GPS 추적 하트비트

파일: `supabase/migrations/20260818120000_gps_tracking_health.sql`

SQL Editor에서 해당 마이그레이션 전체를 실행하세요. merge만으로는 RPC가 생기지 않습니다.

적용 후:
- `worker_gps_status` — 위치 없이 중단 사유만 저장
- `report_worker_gps_status(project_id, reason)` — 근로자 앱이 상태만 보고 (좌표 없음)
- `get_gps_tracking_health(project_id)` — 추적중(5분) / 지연(5~30분) / 두절
  - 버킷은 `worker_last_positions.updated_at` 기준. 사유만 올린 인원은 두절
- 관리자 화면: `/admin/tracking-health` (헤더 프로젝트 = `selectedProjectId`)
- 프론트 OTA는 SQL 적용 후에 배포하세요.
