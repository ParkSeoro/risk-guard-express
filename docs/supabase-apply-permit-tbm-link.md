# Supabase: 허가서 ↔ 당일 TBM 링크 잠금 예외

파일: `supabase/migrations/20260803020000_link_work_permit_tbm.sql`

SQL Editor에서 해당 마이그레이션 전체를 실행하세요.

적용 후:
- 결재중/승인 허가서에도 `tbm_session_id` 연결이 가능합니다 (본문 수정은 계속 잠김).
- RPC `link_work_permit_tbm(_permit_id, _tbm_session_id)` 가 1:1 링크를 수행합니다.
