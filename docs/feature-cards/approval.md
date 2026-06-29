# Feature Card — 통합 결재 엔진 (Unified Approval Engine)

- 담당자: -
- 관련 라우트: `/approvals`, `/m/approvals`, `/settings/approval-routes`
- 관련 테이블: `approvals`, `approval_lines`, `approval_route_templates`, `assessment_runs`, `work_plans`, `work_permits`
- 관련 RPC: `submit_approval`, `act_on_entity_approval`, `get_my_pending_entity_approvals`, `get_eligible_approvers`
- 관련 컴포넌트: `SubmitApprovalDialog`, `ApprovalLineManager`, `usePendingApprovalsCount`
- 관련 시나리오 키: `approval_submit_and_act`

---

## 1. Happy path
- [x] 작성자가 문서(위험성평가/작업계획서/작업허가서/산업안전보건관리비/사고/비상대피훈련/TBM) 상세에서 "결재 상신" → `SubmitApprovalDialog`
- [x] 템플릿 선택 또는 단계 직접 구성 → `submit_approval` RPC → `approvals` 행 N건 생성, 문서 status `결재중`
- [x] 결재자에게 알림(`notifications`) + 사이드바 뱃지(`usePendingApprovalsCount`) 즉시 갱신
- [x] 순차 결재 — 이전 단계 미승인 시 후속 승인 차단
- [x] 최종 승인 시 문서 status `승인완료`, `is_locked=true`, 작성자에게 결과 알림
- 시나리오 키: `approval_submit_and_act`

## 2. Permission (역할 × CRUD)
- [x] 상신: 작성자(또는 소속 회사 site_manager/supervisor) 만 가능 (`useProjectAccess.canSubmitApproval`)
- [x] 승인/반려: 해당 단계의 `approver_id === auth.uid()` 만 — 다른 사용자/관리자도 대신 누를 수 없음
- [x] master/project_admin: 전체 현황 탭 읽기만 가능, 결재 행위는 지정된 결재자만
- [x] 결재선 템플릿(`approval_route_templates`): master/project_admin/safety_manager 수정 가능
- 매트릭스 테스트: `src/test/permissions.matrix.test.ts` (`feature: 'approval'`)

## 3. Scope (회사/프로젝트 격리)
- [x] `approvals.project_id` RLS — 다른 프로젝트 결재 SELECT 차단
- [x] 비-관리자 사용자는 본인 회사(`company_id == userCompanyId`) 또는 본인이 결재자인 행만 노출 (`Approvals.tsx` 필터)
- [x] `get_eligible_approvers` RPC: 상신자 회사의 상위 회사(client > gc > contractor) 관리자만 반환 — 다른 시공사 인원 누출 방지
- [x] `ApprovalLineManager` 기본은 본인 회사 + 오너사(master/project_admin/safety_manager) 로 필터, "타사 포함" 체크 시 확장

## 4. Empty / Loading / Error UI
- [x] 로딩 스켈레톤 (3행 muted bar)
- [x] 0건 상태: 아이콘 + 안내문 + 첫 상신 가이드 문구
- [x] 상신 실패 시 `toast.error('상신 실패: …')` (silent fail 없음)
- [x] 결재선 로드 실패 시 토스트 + 다이얼로그는 빈 단계로 유지

## 5. Edge inputs
- [x] 결재선 0단계 상신 차단 (`steps.length === 0`)
- [x] 결재자 미지정 단계 차단
- [x] 재상신: `submit_approval` 이 기존 `대기` 행을 `취소` 처리하고 `approval_version` 증분
- [x] 반려 사유 필수 (`prompt` 가 빈 값이면 진행 중단)

## 6. State sync (문서·뱃지·알림)
- [x] 승인 단계 완료 시 다음 결재자에게 알림 + `usePendingApprovalsCount` 자동 갱신(60초/포커스)
- [x] 최종 승인 시 문서 status `승인완료`, `risk_items.is_locked=true`, 작성자 알림
- [x] 반려 시 문서 status `보완중`, 작성자 알림 (사유 포함)
- [x] entity 결재(`work_plan`/`work_permit`/…) 도 `act_on_entity_approval` 가 status 캐스케이드 처리
- [x] 사이드바 결재함 배지 = run 기반 + entity 기반 합산

## 7. Audit
- [x] 모든 승인/반려는 `audit_logs` 에 `approver_id`, `comment`, `approved_at` 기록
- [x] 재상신 시 이전 버전 `취소` 행 보존 → 결재 이력 추적 가능
- [x] 결재선 템플릿 변경은 `audit_logs.approval_template_*`

## 8. Rollback
- [x] 잘못 상신: 작성자/관리자가 "결재 취소" 가능 (status `취소`) — 후속 결재 차단
- [x] 잘못 승인된 최종 문서는 master 가 "강제 편집" 또는 "복제 후 재작성" (메모: `approved-document-handling`)
- [x] 결재선 템플릿 잘못 저장 시 `/settings/approval-routes` 에서 소프트 삭제 → `/admin/trash` 복원

---

## 회귀 테스트 링크
- vitest: 권한 매트릭스 `src/test/permissions.matrix.test.ts` (`approval` feature)
- E2E (`/admin/system-test`): `SCENARIOS.approval_submit_and_act`

## 남은 작업
- (선택) 결재 위임(delegate)·대결재(escalation) UI를 결재함에서 직접 호출 가능하도록 노출
- (선택) 대량 결재 — 같은 종류 문서 N건 한 번에 승인 (체크박스 멀티 선택)
- (선택) Slack/Kakao 외부 알림 채널 연동
