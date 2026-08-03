# Feature Card — 작업계획서 (Work Plan)

> 1차 사이클 #2. 마지막 검토: 2026-06-29

- 담당자: (미정)
- 관련 라우트: `/work-plans`, `/work-plans/:id`, `/m/work-plans`
- 관련 테이블: `work_plans`, `work_plan_attachments`, `rigging_plans`, `confined_space_permits`
- 관련 RPC: `derive_permit_from_work_plan`, `derive_tbm_from_work_plan`, `submit_approval`, `act_on_entity_approval`
- 시나리오 키: `core12.work_plan_smoke`, `flow.create_work_plan`

---

## 1. Happy path ✅
- [x] 11개 법정 유형(차량계 포함) 생성 → 7탭 편집 → 결재 → PDF 출력
- [x] 결재 완료 후 `derive_permit_from_work_plan` / `derive_tbm_from_work_plan` 로 연쇄 생성
- 시나리오: `core12.work_plan_smoke`

## 2. Permission ✅
- [x] `useProjectAccess.can*('work_plan')` — 7역할 매트릭스 통과
- [x] 인라인 `role === ...` 분기 제거 — `AppSidebar`/`WorkPlanDetail` 모두 hook 경유
- 회귀: `src/test/permissions.matrix.test.ts`

## 3. Scope ✅
- [x] RLS: `work_plans` SELECT/INSERT/UPDATE/DELETE 4정책 (project + company 격리)
- [x] `work_plan_attachments` 스토리지 RLS — 작성자 회사 외 차단
- [x] 시공사 헤더 — 작성자 회사 우선 표시

## 4. Empty / Loading / Error UI ✅
- [x] 목록 0건 — 안내 + "새 작업계획서" CTA (`WorkPlans.tsx`)
- [x] 로딩 스켈레톤
- [x] 첨부 업로드 진행 표시(스피너/disabled) + 20MB 초과 토스트 (`AttachmentChecklist`)

## 5. Edge inputs ✅
- [x] `IMESafeInput`/`IMESafeTextarea` 사용
- [x] 11개 유형별 zod 검증 (`StructuredSectionForm`)
- [x] 첨부 0/다중/대용량 — `AttachmentChecklist` 처리

## 6. State sync ✅
- [x] 결재완료 시 `work_plans.status='승인완료'` 미러 (통합 결재 엔진)
- [x] 사이드바 "결재함" 뱃지 합산 (`usePendingApprovalsCount`)
- [x] 작성자/참여자 인앱 알림

## 7. Audit ✅
- [x] 생성/수정/삭제/결재 — `audit_logs` 기록
- [x] 승인 후 수정 시 사유 필수 (force-edit)

## 8. Rollback ✅
- [x] `useSoftDelete('work_plans')` — 휴지통 복원
- [x] 결재 취소/반려/재상신 — 버저닝 동작
- [x] 승인완료 문서 수정 시 clone-revision 또는 force-edit

---

## 회귀 테스트 링크
- vitest: `src/test/permissions.matrix.test.ts` (work_plan 행)
- E2E: `SCENARIOS.core12.work_plan_smoke`, `SCENARIOS.flow.create_work_plan`

## 정책 결정 (2026-08-03)
- 작업유형: **실무 확장형** 유지 (제38조 13종만으로 축소하지 않음)
- RA 회차 FK: 결재 **절대 필수 아님** (연계 권장)
- 근로자 주지(제38조②): **연결 TBM 참석**으로 증빙 (사전 승인 문서이므로)
- 결재 차단 첨부: **사업자등록증·보험가입증명서** 포함 (공통 legal 필수)

## 남은 작업
- derive_permit/tbm RPC 컬럼 매핑 보정
- 첨부 JSON vs `work_plan_attachments` 이중구조 정리

