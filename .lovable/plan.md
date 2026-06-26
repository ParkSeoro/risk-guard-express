## 문제

회사 관리 → 조직도 에서 부서(예: 청원산기(주) · 시공팀)에 인원을 등록했지만, 위험성평가 "일괄 적용" 패널에서 "해당 부서에 기본 담당자 매핑이 없습니다" 가 표시됨.

원인: `AssessmentRunDetail.tsx`가 부서별 기본 담당자를 **오직 `department_assignees` 테이블**(별도 매핑 화면에서 수동 지정해야 채워지는 SSOT 이전 잔재)에서만 찾고 있음. 회사 관리에 등록한 `company_managers` 정보는 무시되고 있음.

## 해결 방향

회사 관리 조직도(`company_departments` + `company_managers`)를 부서 담당자의 **SSOT**로 삼는다. 별도 매핑 화면은 보조 오버라이드로만 사용.

부서별 "기본 담당자" 결정 우선순위:
1. `department_assignees.default_user_id` (수동 오버라이드가 있으면 우선 — 기존 운영 보호)
2. 해당 부서 `company_managers` 중 `is_primary = true` 이면서 `user_id`가 있는 사람
3. 해당 부서 `company_managers` 중 `user_id`가 있는 첫 사람 (이름순)
4. 없으면 "매핑 없음" 경고

## 작업 항목 (frontend만 수정)

### `src/pages/AssessmentRunDetail.tsx`
- 데이터 로드 단계에서 `company_managers` (id, department_id, user_id, name, position, is_primary, is_deleted=false) 를 해당 프로젝트의 회사들로 스코프해서 함께 fetch.
- `deptDefaults: Map<department_id, { user_id, display_name }>` 를 위 우선순위로 계산해 state로 보관.
- 다음 3 군데를 `deptAssignees.find(...)` → `deptDefaults.get(deptId)` 로 교체:
  - `handleDepartmentChange` (line ~469): 자동 채움 + 매핑 없음 토스트
  - 일괄 적용 `onValueChange` (line ~2547): 자동 채움
  - 일괄 적용 경고/미리보기 (line ~2590-2598): "기본 담당자: …" or "매핑 없음" 표시
- 담당자 드롭다운(라인 ~1797, ~2573)에 회사 관리자가 빠지지 않도록, `projectMembers` 리스트에 `company_managers`에서 가져온 user_id 매핑 인원들도 머지(중복 user_id 제거). 표시 라벨: `이름 (회사 · 직책)`.

### 별도 매핑 화면 (`DepartmentAssigneeMapping.tsx`)
- 동작은 유지하되 안내 문구를 "회사 관리 조직도에 부서별 담당자를 지정하면 자동으로 사용됩니다. 이 화면은 예외적인 경우의 오버라이드용입니다." 로 변경.

## 검증

1. 회사 관리 → 조직도에서 부서 1개와 그 부서의 `is_primary` 관리자 1명 등록되어 있는 상태로 위험성평가 → 일괄 적용 → 책임부서 선택 시 "기본 담당자: 이름 (회사)" 가 보여야 한다.
2. 표 안에서 부서 셀을 바꿀 때 담당자가 자동 채워져야 한다.
3. 같은 부서에 `department_assignees` 오버라이드가 있으면 그 값이 우선되어야 한다.

## 비대상

- DB 스키마 변경 없음 (`company_managers`, `company_departments`, `department_assignees`는 그대로).
- TBM/안전점검 등 다른 화면은 이미 `useProjectAssigneePool` 사용 중이라 영향 없음.
