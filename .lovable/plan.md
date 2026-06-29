# 통합 결재 시스템 (Unified Approval)

현재 위험성평가·작업계획서·작업허가서·산안비·사고보고·비상훈련 등에 결재 로직이 분산돼 있어 UX가 제각각입니다. 공통 결재 엔진으로 묶고, "사전 결재선 + 상신 시 라인 선택/수정"을 모든 문서에 동일하게 제공합니다.

## 1. 데이터 모델 정비

- `approval_route_templates` 확장
  - `entity_type` 컬럼 추가 (`assessment_run | work_plan | work_permit | safety_cost | incident | emergency_drill | tbm`)
  - `company_id` 추가(시공사별 라인 가능, NULL=프로젝트 공용)
  - `steps` JSONB 구조 표준화: `[{order, label, position, company_id?, user_id?, required:true}]`
- `approvals` 테이블 그대로 사용 (이미 `entity_type/entity_id/step_order/approval_version` 존재)
- `approval_lines`는 레거시(위험성평가 전용) → 신규 템플릿으로 마이그레이션, 호환을 위해 유지

## 2. 공통 RPC (SECURITY DEFINER)

- `submit_approval(_entity_type, _entity_id, _project_id, _company_id, _steps jsonb, _reason text)`
  - 권한: 작성자(소속 회사) 본인만 상신 가능
  - 기존 PENDING 차수 자동 취소 후 새 `approval_version` 생성
  - `steps` 인자에 따라 `approvals` 행 일괄 INSERT
  - 결재자에게 알림 발송(첫 단계만)
- `cancel_approval(_entity_type, _entity_id)` / `delegate_approval`(기존) 재사용
- `get_eligible_approvers(_project_id, _submitter_company_id)` returns table
  - 위계: CLIENT - GC - CONTRACTOR 트리에서 **본인 회사 + 상위 회사** 관리자만 반환
  - 직책 필터: `project_admin / safety_manager / site_manager / supervisor`
  - 마스터는 항상 포함

## 3. 프론트엔드 공용 컴포넌트

`src/components/approval/` 신설
- `ApprovalRouteEditor.tsx` — 단계 추가/삭제/순서 변경, 각 단계에 회사·직책·담당자 선택. `get_eligible_approvers` 결과만 노출
- `SubmitApprovalDialog.tsx` — 어떤 문서에서도 호출하는 공용 상신 다이얼로그
  1) 기본 템플릿(entity_type+company) 자동 로드
  2) 사용자가 그 자리에서 라인 수정 가능
  3) "이번만 사용" / "내 기본으로 저장" 선택지
- `ApprovalStatusTimeline.tsx` — 진행 단계 시각화(이미 부분 구현된 것 흡수)
- `useApprovalSubmit(entityType)` 훅으로 RPC 호출 표준화

## 4. 기존 문서 페이지 적용

다음 페이지의 결재 버튼을 `SubmitApprovalDialog`로 교체:
- `AssessmentRunDetail.tsx`
- `WorkPlanDetail.tsx`
- `WorkPermits.tsx` (모바일 `MobilePermits.tsx`도)
- `SafetyCost.tsx` (월별 보고서 결재)
- `Incidents.tsx`, `EmergencyDrills.tsx`
- `TbmLogs.tsx`

문서별 고유 사전조건(예: 위험성평가 검증 통과)은 기존 가드 유지.

## 5. 결재함 통합

- `/approvals` 와 `/m/approvals` 가 entity_type 별로 탭/필터 표시 (현재는 assessment_run 위주)
- 카드 클릭 시 entity_type에 맞는 상세 라우트로 이동 (라우팅 매핑 테이블 추가)

## 6. 설정 화면

- `Settings.tsx` → "결재선 관리" 항목 추가, `/settings/approval-routes` 페이지에서 entity_type/company별 템플릿 CRUD

## 7. 기술 메모 (개발자용)

- 마이그레이션 1건: ALTER `approval_route_templates` ADD entity_type, company_id + 인덱스, 기존 행은 `assessment_run`/NULL로 백필
- RPC 3개 추가: `submit_approval`, `get_eligible_approvers`, (옵션)`save_my_default_route`
- RLS: 신규 컬럼 정책은 `is_project_member` + `can_access_company_data`로 일관 유지
- 회사 위계 조회는 `companies.parent_company_id`(있으면) 재귀 CTE, 없으면 `company_managers`/`project_members` 역할 기반 fallback

## 확인 사항

- "상위 회사"의 정의: 발주처(CLIENT) → 원청(GC) → 협력사(CONTRACTOR) 트리를 그대로 사용하는 것으로 가정했습니다. 다른 정의(예: 협력사가 또 하위 협력사 보유) 있으면 알려주세요.
- 산안비 결재는 이미 자체 `safety_cost_approval_steps`가 있는데, 통합 엔진으로 흡수할지 / 별도로 두고 UI만 통일할지 선택 필요합니다 (기본은 "UI만 통일, 데이터는 별도 유지" 권장).
