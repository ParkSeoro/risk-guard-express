# Supabase: 가스측정 후속결재 필수 해제

파일: `supabase/migrations/20260803070000_optional_permit_gas_closure.sql`

SQL Editor에서 전체 실행하세요.

적용 후:
- `permit_gas_closure_gate`가 항상 `ok` — 종료/작업완료 결재·요청이 가스 미입력으로 막히지 않음
- 가스측정 입력·저장은 계속 가능 (선택)
