
# 업체(회사) 통합 관리 — 시스템 마스터화

## 문제
현재 `companies.project_id`가 필수라 동일 회사가 프로젝트마다 별도 row로 중복 생성됨. 회원가입은 초대코드 기반이고, 각 모듈에서 "소속 회사"를 자유 텍스트/프로젝트 로컬 회사에 의존.

## 목표 아키텍처

```text
[시스템] companies (SSOT, 전역)      ← 마스터/PA만 CRUD
    │
    ├── project_companies (연결)     ← 프로젝트에 업체 등록/해제
    │     (project_id, company_id, role_in_project: gc|contractor|vendor|client)
    │
    └── company_construction_info    ← (company_id, project_id) 프로젝트별 공사정보
          company_managers/departments/workers → company_id 기준(전역)
          project_members.company_id → 프로젝트별 구성원 지정
```

## 변경 사항

### 1. DB 마이그레이션
- `companies`에서 `project_id`를 nullable 로 변경 후 최종적으로 제거(호환 유지 위해 우선 nullable + 뷰 처리).
- 중복 회사 정규화: 사업자번호(`business_no`) 또는 이름 기준으로 dedupe → 대표 row 남기고 나머지는 참조 rewire.
- 신규 테이블 `project_companies(id, project_id, company_id, role_in_project, is_deleted, timestamps)` + unique(project_id, company_id).
- `company_construction_info`는 이미 (company_id, project_id) 구조 → 유지, unique 인덱스 추가.
- `workers`, `company_managers`는 전역 `company_id` 참조 유지(그대로).
- RLS:
  - `companies` SELECT: master/PA는 전체, 일반 사용자는 자기가 속한(=project_members.company_id 또는 project_companies로 연결된) 회사만.
  - INSERT/UPDATE/DELETE: master/PA만.
  - `project_companies`: master/PA/해당 프로젝트 관리자만 CUD, 프로젝트 멤버는 SELECT.

### 2. 회원가입 흐름 재설계 (초대코드 → 업체 조회)
- `/auth` 회원가입 폼:
  1. 이메일/비밀번호/이름/연락처
  2. **프로젝트 선택**(공개 목록 또는 코드) → 해당 프로젝트에 등록된 업체 목록 조회
  3. **업체 검색/선택** (project_companies 조인)
  4. **직종 선택**: 관리감독자/안전관리자/현장소장/감리/작업자 등 (position_new enum)
- 가입 완료 시 `account_status='pending'` + `project_members(project_id, user_id, company_id, position_new)` 자동 생성.
- 마스터/PA 승인 후 활성화. 기존 `process_invite_code` RPC는 하위호환용으로 유지하되 UI에서는 숨김.

### 3. 시스템 메뉴 신설: "업체 관리"
- 경로: `/settings/companies` (마스터/PA 전용, `Settings.tsx`에 카드 추가)
- 기능:
  - 전역 업체 목록(사업자번호·이름·유형·연락처·주소)
  - 등록/수정/삭제(소프트 삭제, `is_deleted`)
  - 사업자번호 unique 검증
  - "이 업체가 참여중인 프로젝트" 배지 표시
  - 병합(Merge) 도구: 중복 업체를 하나로 통합

### 4. 프로젝트 상세: "참여 업체" 탭
- `/projects/:id`에서 참여 업체 추가/해제(전역 업체 검색 → project_companies에 연결).
- 업체별 역할(원도급/시공사/협력사/발주처) 지정.
- 프로젝트별 공사정보(`company_construction_info`) 편집은 여기서.
- 기존 `/companies` 페이지(프로젝트 스코프)는 "이 프로젝트의 업체"로 재구성하여 project_companies 조인 뷰로 렌더링.

### 5. 프로젝트별 구성원 관리
- `project_members`가 이미 (project_id, user_id, company_id, position_new)를 가지고 있음 → 그대로 활용.
- `UserManagement.tsx`에서 회사 선택은 "해당 프로젝트에 연결된 업체" 목록으로 제한.

### 6. 전 모듈 자동 연동 (SSOT)
- 위험성평가·작업허가서·작업계획서·TBM·근로자·안전점검·안전보건관리비 등에서 "소속 업체" 참조를 `companies.id`(전역)로 통일.
- `useUserCompany()` 훅: 로그인 사용자의 `project_members.company_id`를 반환 → 서류 작성 시 자동 매핑(수정 가능하되 기본값).
- AssigneeSelect / ContractorSelect 컴포넌트를 project_companies 기준으로 재작성.

## 마이그레이션 전략(무중단)
1. `project_companies` 생성 + 기존 companies에서 (project_id, id) 쌍을 자동 백필.
2. 중복 dedupe 스크립트(사업자번호→이름) 실행, FK 재지정(workers/company_managers/company_construction_info/project_members.company_id/work_permits 등).
3. `companies.project_id` nullable화 → UI 전면 전환 → 다음 스프린트에서 컬럼 drop.
4. 기존 `/companies` 라우트 유지, 내부 쿼리만 project_companies 조인으로 변경.

## 기술 세부(비기술 사용자는 스킵 가능)
- Security definer 함수: `has_company_access(_user, _company)`로 RLS 재사용.
- `project_companies` GRANT: authenticated CRUD, service_role ALL.
- 중복 병합 RPC: `merge_companies(_src uuid, _dst uuid)` → 마스터 전용, 모든 FK 재지정 + src soft-delete.
- 회원가입 시 프로젝트/업체 조회는 anon SELECT 허용을 위한 별도 뷰 `public.signup_company_directory` (project_id, company_id, name, type만 노출).

## 산출물
- 마이그레이션 SQL 1건 (테이블/RLS/RPC/백필/dedupe)
- 신규 페이지: `src/pages/SettingsCompanies.tsx`
- 수정: `Settings.tsx`, `Auth.tsx`, `Companies.tsx`, `ProjectDetail.tsx`, `UserManagement.tsx`, `AuthContext.tsx`
- 신규 훅: `src/hooks/useUserCompany.ts`, `src/hooks/useProjectCompanies.ts`
- 문서: `docs/feature-cards/companies.md` 갱신
