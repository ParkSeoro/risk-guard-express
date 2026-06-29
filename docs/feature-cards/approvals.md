# Feature Card #20 — 결재 센터 (`approvals` + `approval_lines` + `approval_route_templates`)

대상: `pages/Approvals.tsx`, `components/ApprovalLineManager.tsx`, `components/approval/SubmitApprovalDialog.tsx`, `pages/SettingsApprovalRoutes.tsx`

## 1. Happy Path
- 작성자가 위험성평가/작업계획서/작업허가서를 상신 → 직책 기반 4단계(작성 → 안전관리자 검토 → 현장대리인 확인 → 최종승인)로 순차 결재.
- 결재자는 "결재함" 에서 내 대기 건을 즉시 처리, 모든 단계 승인 시 본문 잠금(`risk_items.is_locked`) + 작성자 알림 발송.
- 반려 시 `assessment_runs.status = 보완중`, 작성자에게 사유 동봉 알림.

## 2. Permission
- 본인 지정 단계만 승인/반려 가능(`approver_id = auth.uid()`).
- 마스터·프로젝트 관리자만 "전체 현황" 탭(읽기전용) 가능.
- 작업계획/허가는 RPC `act_on_entity_approval` 로 별도 권한 체크.

## 3. Scope
- 프로젝트 + 회사 격리: 비-관리자/마스터는 자기 회사(`company_id`) 결재 + 본인 지정 단계만 표시.
- 최신 `approval_version` 만 표시 (이전 차수는 자동 숨김).

## 4. Empty / Loading
- Skeleton 3행 펄스 로딩.
- 탭별 빈 상태 메시지(내 대기/상신/완료/반려/전체).

## 5. Edge Inputs
- 순차 결재 enforcement: 이전 단계 미승인 상태에서 시도하면 차단 + 토스트.
- 반려는 사유 필수.

## 6. State Sync
- Realtime postgres_changes(`approvals` 테이블, project_id 필터) 즉시 갱신.
- 옵티미스틱 X → 정합성 우선 재조회.

## 7. Audit
- 모든 승인/반려는 `useAuditLog().log('승인'|'반려', 'approval', id, projectId)` 로 기록.
- 결재완료 시 본문 잠금 + 작성자 알림(`notifications`).

## 8. Rollback
- 마스터가 재상신/취소 가능. `approval_version` 증가로 이전 결재 무효화.

## 추가 개선
- KPI 카드 4종: 내 대기 / 상신 / 완료 / 반려.
- 통합 검색(제목·결재자·코멘트), 엔터티 유형 필터(작업계획서/작업허가서).
- 신규 탭: 완료 / 반려.
- Realtime 즉시 반영 + 60초 폴링 제거(중복 호출 방지).
