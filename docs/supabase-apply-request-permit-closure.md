# Supabase: 작업완료 결재 요청 RPC

파일: `supabase/migrations/20260803060000_request_work_permit_closure.sql`

SQL Editor에서 전체 실행하세요.

적용 후:
- `request_work_permit_closure(permit_id)` — 발행 완료 허가서에서 가스측정 후 수동으로 종료(작업완료) 결재 단계 생성
- 상태 `종료대기` + `closure_supervisor` → `closure_sm` (또는 SM 단독)
- 가스 미입력 시 `GAS_MEASUREMENT_REQUIRED`
