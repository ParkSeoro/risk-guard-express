# Feature Card — 법정업무 & 할 일 (#15)

법적 근거: 산안법 §15~17 (안전보건관리책임자/관리감독자), §29 (안전보건교육), §36 (위험성평가), §41 (휴게시설), §63 (도급사업), 시행규칙 별표 3 (관리책임자 업무).

## Scope
- `/legal-duties` (LegalDuties.tsx) — 법정업무 마스터(자동생성/주기·활성 관리)
- `/todo-dashboard` (TodoDashboard.tsx) — 업무 주기 기반 자동 할 일 + 통계
- 테이블: `legal_duties`, `todo_items` (둘 다 soft delete)
- 템플릿: `src/lib/legalDutyTemplates.ts` (공종별 매핑)

## 8-Dim Checklist
1. Happy path — "자동 생성"으로 공종별 업무 적재 → 주기/활성 조정 → 할 일 자동 생성(매일/주/월/분기) → 체크박스 완료 → 통계 갱신.
2. Permission — 작성/수정/삭제: master, project_admin, safety_manager. 시공사는 본인 회사 업무만 노출(RLS+applyCompanyFilter).
3. Scope — `project_id` 필터 + RLS. `is_deleted=false`. 법정(시스템) 업무는 수정/삭제 잠금.
4. Empty/Loading — Skeleton 카드 + CTA("자동 생성"). 할 일 0건시 안내+CTA.
5. Edge inputs — 검색(제목/설명), 상태 필터(미완료/완료/지연/전체), 분류 탭(daily/weekly/monthly/event).
6. State sync — 토글 즉시 로컬+DB 동기화. 완료/미완료 전환시 completed_at·completed_by 정합.
7. Audit — 추가/수정/삭제/완료 audit_logs 기록(삭제는 사유 필수).
8. Rollback — soft delete + `/admin/trash` 복원. 통계는 활성 항목 기준.

## UX 강화
- D-Day 배지(`D-3`, `D-Day`, `D+5 초과`)로 마감 시각화
- 검색 + 상태 필터(미완료/완료/지연/전체)
- 통계 카드(오늘/이번 주/이번 달) + Pie/Bar 차트
- Skeleton 로딩
- 법정 업무 잠금(`Lock` 아이콘)로 시스템/사용자 구분
- 회사 필터(MultiCompanyFilter)와 연동
