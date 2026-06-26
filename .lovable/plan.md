
# 시공사/협력사 상세 관리 기능 도입

## 문제 진단

1. **담당자 풀 부족**: 현재 부서·담당자 매핑(`DepartmentAssigneeMapping`) 화면에서 선택 가능한 담당자가 `role = safety_manager`로 한정되어, 시공사/협력사 현장소장·공무·관리자 등이 후보로 뜨지 않음.
2. **회사 단위 관리 화면 부재**: `companies` 테이블과 `company_construction_info`(공사 개요)만 있고, 각 시공사가 스스로 ① 조직도 ② 관리자(현장소장·안전관리자·공사팀장 등) ③ 공사 개요를 등록·관리할 수 있는 통합 메뉴가 없음. 그래서 위험성평가/TBM/작업허가 등 다른 메뉴에서 담당자 드롭다운에 누구도 나오지 않음.
3. **연결 부재**: 회사별 등록된 인력이 `project_members` / `user_roles` / `department_assignees` 와 자동으로 매핑되지 않아 다른 메뉴에서 활용 불가.

## 핵심 아이디어 — "회사 카드(Company Workspace)" 도입

각 시공사/협력사를 하나의 미니 워크스페이스로 보고, 카드 안에 모든 회사 정보를 집약합니다. Master/PM 은 전체를 보고, 시공사 소속 사용자는 자기 회사 카드만 편집할 수 있게 함 (RLS).

### Company Workspace 탭 구성
```
회사관리(/companies/:id)
 ├─ 1. 회사 개요         (사업자번호, 대표, 본사 주소, 업종)  ← companies
 ├─ 2. 공사 개요         (공종, 계약금액, 공기, 도급/하도급)  ← company_construction_info
 ├─ 3. 조직도/부서       (시공팀, 안전팀, 공무팀 …)          ← company_departments (신규)
 ├─ 4. 관리자/담당자     (현장소장·안전관리자·공사팀장 등)    ← company_managers (신규)
 ├─ 5. 근로자 명부       (기존 workers 연동, 회사 필터)
 ├─ 6. 보유 장비         (기존 equipment_master 회사 필터)
 └─ 7. 안전 성과         (ContractorScorecard 미니뷰)
```

## 작업 범위

### A. 데이터 모델 (신규/보강)
- **`company_departments`** : 회사별 부서(시공팀, 안전팀, 공무팀, 품질팀 …) — `company_id`, `name`, `sort_order`.
- **`company_managers`** : 회사별 관리자 — `company_id`, `department_id`, `name`, `position`(현장소장/안전관리자/공무팀장/공사팀장/품질관리자 등 enum), `phone`, `email`, `user_id`(nullable — 로그인 계정과 연결되면 자동 권한 부여), `is_primary`.
- `company_construction_info` 에 누락 필드 보강(공기 시작/종료, 도급 단계, 발주처) — 이미 존재하는 컬럼은 그대로 사용.
- 모든 신규 테이블 `public` GRANT + RLS:
  - SELECT: 같은 프로젝트의 멤버는 회사 조회 가능 (협력사 데이터 격리 룰 유지 — 자기 회사+소속 GC).
  - INSERT/UPDATE/DELETE: Master/PM 전체, 시공사 소속 `safety_manager`/`site_manager`는 자기 회사만.

### B. UI — 신규 페이지/컴포넌트
1. **`/companies` (회사 목록)** — 사이드바 "회사 관리" 메뉴 신설. 회사 카드 그리드(공종/관리자수/근로자수/안전등급 뱃지).
2. **`/companies/:id` (회사 상세)** — 위 7개 탭 구현.
3. **`CompanyManagerForm`** — 직책 선택 → 사용자 검색(이미 가입한 계정과 매칭) → 매칭 시 `user_roles`/`project_members`에 자동 등록(역할 매핑: 현장소장→`site_manager`, 안전관리자→`safety_manager`, 그 외→`user`).
4. **`CompanyDepartmentManager`** — 부서 CRUD + 정렬.

### C. 담당자 풀(Assignee Pool) 통합
`DepartmentAssigneeMapping` 및 위험성평가/TBM/작업허가/안전점검에서 담당자 후보를 다음 합집합으로 변경:
```
candidates = company_managers (현재 프로젝트의 시공사들)
           ∪ project_members where role in (project_admin, safety_manager, site_manager)
```
- 헬퍼: `useProjectAssigneePool(projectId, { companyId?, positions? })` 훅 신규 작성 → 모든 드롭다운 공통 사용.
- 매핑 UI에서 회사 필터 + 직책 필터 추가, 표시 형식 `[회사] 이름 (직책)`.

### D. 다른 메뉴 연동 (드롭다운만 교체, 비즈니스 로직 유지)
- `AssessmentRunDetail.tsx` (책임부서 담당자 자동 채움)
- `TbmManager.tsx` (TBM 진행자)
- `WorkPermits` / `SafetyInspections` (감독자)
- `ApprovalLineManager` (결재선 후보)

### E. 권한
- 메뉴 노출: Master, PM, 안전관리자(전체 조회), 시공사 site_manager(자사 편집).
- 기존 `useProjectAccess` 의 `canManageCompany(companyId)` 헬퍼 추가.

## 기술 메모
- 신규 테이블은 모두 `is_deleted` 소프트 삭제 + `scopedSelect` 패턴 준수.
- `company_managers.user_id` 연결 시 트리거로 `project_members`/`user_roles` upsert (중복 방지).
- 마이그레이션 1개로 테이블/GRANT/RLS/트리거 모두 작성.
- 신규 메뉴는 `AppSidebar.tsx` 의 "마스터 데이터" 그룹 아래 "회사 관리" 로 추가.

## 산출물
1. SQL 마이그레이션 (테이블 2개 + RLS + 트리거).
2. `src/pages/Companies.tsx`, `src/pages/CompanyDetail.tsx`.
3. `src/components/company/*` (Overview/Construction/Departments/Managers/Workers/Equipment/Scorecard 탭).
4. `src/hooks/useProjectAssigneePool.ts`.
5. `DepartmentAssigneeMapping` + 4개 메뉴 드롭다운 교체.
6. 사이드바·라우팅 등록.

확정해 주시면 위 순서대로 한 번에 구현하겠습니다.
