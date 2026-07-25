## 원인 분석

두 문제 모두 **동일한 회사가 DB에 중복 등록**된 것이 근본 원인입니다.

DB 조회 결과, "청원산기"가 두 개의 서로 다른 `companies` 레코드로 존재합니다:


| 회사명       | id          | 소속 사용자                                 |
| --------- | ----------- | -------------------------------------- |
| `(주)청원산기` | `905f2d5d…` | 박현호(supervisor), 정대용(supervisor)       |
| `청원산기(주)` | `d313393e…` | 최형기(site_manager), 강은혜(safety_manager) |


`project_companies` 상으로도 두 레코드가 모두 같은 프로젝트에 링크되어 있고, `d313393e` 쪽만 발주처(에어리퀴드코리아) 아래에 매달려 있습니다. `905f2d5d`는 `parent_company_id`가 NULL 이라 상위 회사 체인이 끊겨 있습니다.

### 문제 1 — 결재선에 정대용/박현호가 안 뜨는 이유

`get_eligible_approvers` RPC는 상신자 회사에서 시작해 상위 회사 체인(ancestors)만 후보로 인정합니다. 상신자(강은혜)의 회사는 `d313393e`이므로 ancestors = {d313393e, 에어리퀴드}. 박현호/정대용은 다른 회사 레코드(`905f2d5d`) 소속이라 후보에서 제외됩니다. RPC 로직은 정상이며, **회사 레코드가 쪼개져 있는 것이 원인**.

### 문제 2 — 권한관리에서 어떤 사람만 회사 chip이 뜨는 이유

`SettingsPermissions`가 사용자의 프로필/회사와 `project_members.company_id`를 비교해 "다른 회사"일 때만 회사 chip을 추가로 표시하는 로직 때문입니다. 두 그룹이 서로 다른 회사 ID에 매달려 있어 표시가 갈라집니다. 회사 레코드가 통합되면 자연스럽게 일관되게 표시됩니다.

### 연동 영향

중복 회사가 남아 있으면 결재선, 권한 표시뿐 아니라 회사관리 카운트, 위험성평가/작업허가서의 소속회사 SSOT, TBM 참여집계, KPI 등 회사 ID를 join하는 모든 모듈에서 동일한 유형의 어긋남이 계속 발생합니다.

## 수정 계획 (모두 마이그레이션 하나로 처리)

**Canonical**: `d313393e…` (`청원산기(주)`, 발주처 하위로 이미 정상 등록됨)
**Duplicate → 삭제**: `905f2d5d…` (`(주)청원산기`)

1. `905f2d5d`를 참조하는 모든 테이블의 `company_id` / `parent_company_id`를 `d313393e`로 재배치
  - `project_members`, `project_companies`, `company_managers`, `company_departments`, `company_construction_info`, `company_daily_qr`, `workers`, `work_permits`, `work_plans`, `tbm_sessions`, `risk_items`, `assessment_runs`, `safety_cost_*`, `worker_entry_logs`, `chemical_workers`, `worker_zone_events`, `incident_reports`, `emergency_drills`, `approvals`, `approval_route_templates`, 기타 `company_id` 컬럼을 가진 테이블 전체를 동적 스캔하여 일괄 UPDATE
2. 재배치 도중 `(project_id, user_id)` / `(project_id, company_id)` unique 충돌이 발생하는 중복 행은 canonical 쪽을 남기고 dup 쪽을 삭제
3. `project_companies`에서 canonical 행의 `parent_company_id`가 NULL이면 발주처(에어리퀴드코리아)로 보정
4. 마지막에 `companies` 테이블의 `905f2d5d` 레코드 삭제 (soft delete가 아니라 hard delete — 참조가 모두 옮겨진 후)
5. 감사 로그(`audit_logs`)에 병합 이력 기록

## 검증

- `get_eligible_approvers`(project=여수, submitter=청원산기)가 박현호·정대용·최형기 등 청원산기 전 관리자를 반환하는지 SQL로 확인
- `project_members` 조회로 4명 모두 동일 `company_id`(`d313393e`)를 갖는지 확인
- 권한관리 화면에서 4명 모두 동일한 회사 chip 표시 여부는 사용자가 새로고침 후 확인

## 향후 재발 방지 (이번 범위 밖, 참고)

- `companies.name`에 대한 정규화 기반 unique 제약은 이미 있으나 `(주)`/공백/특수문자 정규화 로직이 부족하여 우회되었습니다. 추후 `normalize_company_name`을 강화하는 별도 작업이 필요합니다. 이번 계획에는 포함하지 않습니다.

추가로 회원가입할때 프로젝트를 지정하는데 막상 가입해서 보면 아무런 프로젝트에 소속되어있지 않아. 이부분도 수정해주고. 지정하지 않은 프로젝트가 지정되어버리기도 해(예를 들어 lgc 여수 배관망 증설 프로젝트가 임의 지정되어버려)