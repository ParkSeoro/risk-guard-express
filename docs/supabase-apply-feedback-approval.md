# Supabase: 위험성평가 피드백(조치) 결재

파일: `supabase/migrations/20260803040000_assessment_feedback_approval.sql`

SQL Editor에서 전체 실행하세요.

적용 후:
- `assessment_runs.feedback_status` 컬럼
- 결재 엔티티 `assessment_run_feedback` 최종 승인 시 `feedback_status='closed'`
