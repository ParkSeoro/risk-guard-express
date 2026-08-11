# Feature Card — 위험성평가 (Risk Assessment)

> 1차 사이클 #1. 마지막 검토: 2026-06-29

- 담당자: (미정)
- 관련 라우트: `/assessment-runs`, `/assessment-runs/:id`, `/risk-assessment`
- 관련 테이블: `assessment_runs`, `risk_items`, `risk_item_versions`, `risk_item_feedback`, `assessment_run_participants`, `assessment_notices`, `ai_risk_cache`
- 관련 RPC: `generate-risk-ai`(edge), `validate_risk_items`, `apply_remediation_actions`
- 시나리오 키: `core12.risk_assessment_smoke`, `admin.create_assessment_run`, `flow.create_ra`, `flow.ra_risk_item_create`

---

## 1. Happy path ✅
- [x] 회차 생성 → 자동/수동 항목 생성 → 검증 → 결재 → PDF 출력 동작 확인
- [x] AI 자동생성 빈 결과 시 명시적 토스트 (`AssessmentRunDetail.tsx:659`)
- 시나리오: `admin.create_assessment_run`, `core12.risk_assessment_smoke`

## 2. Permission ✅
- [x] `useProjectAccess.canEdit('risk_assessment')` / `canApprove('risk_assessment')` 사용
- [x] **작성 주체 = 관리감독자(`site_supervisor`)** — 위험성평가 고시 §7 (유해·위험요인 파악·개선조치)
- [x] 안전관리자(`safety_manager`) = 보좌·지도·조언·검토 (매트릭스 ALL 유지, 단독 작성자 아님)
- [x] 감리(`supervisor`) = 위험성평가 RO (작성 주체 아님)
- [x] 회차 생성 UI: `AssessmentRuns` `canCreateRun`에 `site_supervisor` 포함
- [x] worker = CRU(승인 제외), viewer = RO 매트릭스 (`useProjectAccess.ts` `PERMISSION_MATRIX`)
- 회귀: `src/test/permissions.matrix.test.ts`

## 3. Scope ✅
- [x] RLS: `risk_items` SELECT/INSERT/UPDATE/DELETE 4정책 (project + company 격리)
- [x] `ai_risk_cache` 교차 프로젝트 읽기 차단 (오늘 보안 픽스)
- [x] 시공사 헤더 표시 — 작성자 회사 우선, 마스터/관리자만 전체 GC 표시 (`AssessmentRunDetail.tsx`)

## 4. Empty / Loading / Error UI ✅
- [x] 0건 표 — "AI 자동생성 / 수동으로 추가" CTA (`AssessmentRunDetail.tsx:1796`)
- [x] AI 생성 실패/0건 — 토스트로 사유 안내
- [x] 모든 catch 블록 토스트 노출 (ESLint `no-empty` 가드)

## 5. Edge inputs ✅
- [x] `IMESafeInput`/`IMESafeTextarea` 사용
- [x] 위험성 등급 zod 검증 (`risk_grade.ts`)
- [x] 첨부 0/다중 — `evidence-attachments` 메모리에 정책 명시

## 6. State sync ✅
- [x] 결재완료 시 `assessment_runs.status='승인완료'` 미러 (`trg_assessment_run_approved_notify` 보강 후)
- [x] 작성자/참여자 인앱 알림
- [x] 사이드바 "결재함" 뱃지 — `usePendingApprovalsCount` 훅이 위험성평가 포함 모든 entity 합산

## 7. Audit ✅
- [x] 자동생성/일괄적용/등급 변경 — `audit_logs` 기록
- [x] 위험등급 수동 변경 시 사유 필수 (`risk-grade-override`)

## 8. Rollback ✅
- [x] `useSoftDelete('risk_items')` — 휴지통 복원
- [x] 결재 취소/반려 후 재상신 버저닝 (`approval-resubmission-versioning`)
- [x] 자동생성 항목도 개별 삭제/일괄 제외 가능

---

## 회귀 테스트 링크
- vitest: `src/test/permissions.matrix.test.ts` (risk_assessment 행)
- E2E: `SCENARIOS.admin`, `SCENARIOS.flow`, `SCENARIOS.core12`

## 남은 작업
- (없음 — 1차 사이클 #1 완료)

