
## 문제 원인 분석

`src/pages/ProjectDetail.tsx` "업체 관리" 탭을 확인한 결과, 네 가지 문제 모두 **한 뿌리**에서 나옵니다: 부모-자식 관계(`parent_company_id`)와 삭제 처리가 **프로젝트 단위**가 아니라 **글로벌 companies 테이블**에 저장/실행되고 있습니다.

1. **청원산기만 발주처 아래로 들어감**  
   글로벌 `companies.parent_company_id`에 값이 있는 업체는 청원산기 1건뿐. 다른 시공사들은 시스템 마스터에서 검색해서 프로젝트에 연결(`project_companies`)만 되었기 때문에 부모 정보가 없어서 최상위로 렌더링됨.

2. **발주처 밑에 시공사로 등록해도 위로 올라감** (핵심 원인)  
   `handleAddCompany` (라인 361-406): `source_company_id`(마스터에서 선택)가 있으면 새 companies 행을 만들지 않아 `parent_company_id` 저장 로직 자체를 **건너뜀**. `project_companies` upsert에도 부모 필드가 없음.

3. **마스터/PM이 목록 수정 불가**  
   현재 편집 UI가 아예 없음 (삭제 버튼만 존재).

4. **프로젝트에서 삭제 시 설정의 업체관리에서도 사라짐**  
   `handleDeleteCompany` (라인 409-416)가 `softDelete('companies', id)`를 호출 → 마스터 테이블 자체를 소프트 삭제. 프로젝트 연결(`project_companies`)만 해제해야 함.

## 해결안

### DB 마이그레이션
- `project_companies`에 `parent_company_id UUID NULL` 컬럼 추가 (프로젝트-스코프 계층).
- 기존 데이터 백필: 각 프로젝트에서 자식·부모가 모두 그 프로젝트에 연결되어 있으면 `companies.parent_company_id` 값을 `project_companies.parent_company_id`로 복사.
- `project_companies` UPDATE 정책이 master / project_admin에게 허용되어 있는지 확인하고, 없으면 추가.

### `src/pages/ProjectDetail.tsx` 수정

**fetchAll**: `project_companies`에서 `parent_company_id`도 함께 가져와 각 company 객체의 `parent_company_id`를 **글로벌이 아닌 project_companies 값**으로 덮어씀. 트리 렌더링은 그대로 동작.

**handleAddCompany**:
- 마스터에서 선택한 경우(`source_company_id` 있음)에도 사용자가 지정한 `parent_company_id`를 `project_companies` upsert 페이로드에 포함.
- 새로 만드는 경우에도 부모는 `companies`가 아니라 `project_companies`에 저장 (글로벌은 오염시키지 않음).

**handleDeleteCompany → handleUnlinkCompany**:
- `softDelete('companies', ...)` 호출 제거.
- `project_companies`에서 해당 링크만 DELETE (자식들의 `parent_company_id`도 함께 정리).
- 확인 다이얼로그 문구를 "이 프로젝트에서 제외" 로 변경. 마스터 업체 자체는 그대로 유지된다는 안내 추가.

**신규 편집 다이얼로그** (master / project_admin만):
- 편집 가능: `type`(발주처/시공사/협력사/공급사), `parent_company_id`, `scope`, `period`, `contact` → `project_companies`에 저장 (프로젝트별로 다를 수 있는 필드).
- 편집 가능 (master만): `name`, `business_no` → 글로벌 `companies` 업데이트. 중복명 에러 시 안내.
- 목록 각 행 오른쪽에 연필 아이콘 추가, 권한 없는 사용자에겐 숨김.

### 검증
- 발주처 A 아래에 마스터 선택 시공사 B 등록 → 트리에서 A 밑으로 들어가는지.
- 프로젝트에서 B 제외 → `공사업체 리스트` (설정)에는 B가 그대로 남는지.
- PM 계정으로 편집 아이콘 노출/수정 반영 확인.

## 기술 메모
- `parent_company_id`의 진짜 소유자를 `project_companies`로 옮기는 것이 SSOT 원칙에 맞음. 글로벌 `companies.parent_company_id`는 하위 호환용으로 남기되 앞으로 신규 저장은 하지 않음.
- 백필 SQL은 idempotent하게 작성 (`WHERE project_companies.parent_company_id IS NULL`).
