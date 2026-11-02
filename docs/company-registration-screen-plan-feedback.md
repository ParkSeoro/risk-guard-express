# 회사 등록·수정 화면 정리안에 대한 기술 검토 및 피드백

> **작성일**: 2026-11-02  
> **검토 대상 문서**: `docs/company-registration-screen-plan.md` (커서 작성 제안안)  
> **목적**: 커서(Cursor) 에이전트가 최종 구현 계획을 수립하고 개발을 진행할 수 있도록, 소스코드 정밀 분석 결과 및 프로덕트 오너(사용자) 인터뷰 확정 사항을 전달합니다.

---

## 1. 종합 평가 및 기본 방향 동의

기획안에서 제시한 **3계층 책임 분리(Single Source of Truth)** 및 화면별 고치는 입구 일원화 방향은 현재 시스템의 데이터 꼬임 문제를 해결하는 데 정확히 부합하며, 전적으로 동의합니다.

1. **전역 마스터 (`companies`)**: `SettingsCompanies.tsx`에서 마스터만 관리.
2. **현장 참여 (`project_companies`)**: `ProjectDetail.tsx`에서 현장 관리자가 현장 역할(`role_in_project`)과 상위 시공사(`parent_company_id`)만 관리.
3. **현장 공사 정보 (`company_construction_info`)**: `CompanyDetail.tsx`에서 현장별로 격리 관리.

---

## 2. 기획안의 "검토할 질문(4가지)"에 대한 확정 답변 (PO 확정)

`docs/company-registration-screen-plan.md` 99~105행에 제기된 질문에 대해 사용자와의 인터뷰를 통해 다음과 같이 의사결정이 완료되었습니다.

### Q1. 회사 상세 개요의 저장을 빼면, 마스터가 아닌 현장 관리자는 이름·연락처를 더 이상 고치지 못한다. 그 제한이 맞는지?
- **답변: 맞음 (제한 찬성)**
- 현장 관리자가 사명/사업자번호/주소를 임의로 수정하면 타 현장에 속한 동일 회사의 기본 데이터까지 오염됩니다.
- 회사 상세(`CompanyDetail.tsx`) 개요 탭의 [저장] 버튼은 제거하고, *"업체 기본 정보는 [설정 > 업체 관리]에서 마스터 관리자만 수정할 수 있습니다."* 안내 배너를 제공합니다.

### Q2. 신규 회사 승인을 마스터와 해당 현장 프로젝트 관리자 둘 다 할 수 있게 두는 것이 맞는지?
- **답변: 마스터 단독 승인 (현장 관리자는 등록 요청만 가능)**
- 회사는 시스템 전역(`companies`) 마스터 레코드이므로, 신규 업체 등록의 최종 승인 권한은 **마스터에게만 부여**합니다.
- 현장 관리자(`project_admin`)는 현장 화면에서 미존재 업체를 즉시 생성할 수 없으며, **"새 업체 등록 요청"**을 제출하는 권한만 갖습니다. 마스터가 승인하면 해당 현장(`project_companies`)에 자동 연결됩니다.

### Q3. 조직·담당자 명단을 회사 공통으로 두는 현재 구조를 유지하는 것이 맞는지?
- **답변: 맞음 (현행 유지)**
- `company_departments` 및 `company_managers`는 로그인 계정이나 결재 권한(`project_members`)과 무관한 회사 명부이므로, 이번 범위에서 현장별로 분할하지 않고 공통으로 유지합니다.

### Q4. 저장되지 않던 공사 범위·기간 입력을 지우고, 공사 정보는 회사 상세의 현장별 `company_construction_info`만 쓰는 것이 맞는지?
- **답변: 단순 삭제 불가! 사용자가 직접 입력할 수 있어야 하며 실제 DB에 저장되어야 함 (PO 핵심 지적)**
- **이유**: **공사금액(도급금액), 공종, 공사기간(착공~준공일)**은 산업안전보건법상 **안전관리자 선임 의무 여부, 건설재해예방기술지도 계약 대상 판정, 법적 필수업무(`LegalDuties.tsx`) 산정의 필수 기초 데이터**입니다.
- **개선 방향**:
  - 기존 `ProjectDetail.tsx`의 문제는 '공사개요를 입력받는 것' 자체가 아니라, **'입력은 받아놓고 정작 DB(`company_construction_info`)에 저장하지 않고 버리던(유실) 결함'**이었습니다.
  - 따라서 입력을 무작정 지워버리면 안 되며, 사용자가 현장 업체 등록/수정 시(또는 회사 상세에서) **공사명, 공종, 도급금액, 착공일, 준공일을 직접 입력할 수 있어야 하고, 이것이 `company_construction_info`에 확실하게 INSERT/UPDATE(Upsert)되어 저장**되어야 합니다.


---

## 3. 기획안의 치명적 결함 및 보완 필수 사항 (중요)

### [치명적 결함] 회원가입 순환 교착 (Circular Blocker)
- **기획안 68행 제안 내용**:
  > *"로그인 전 회원가입 화면에서는 회사를 만들지 않고, 목록에 없으면 가입 후 업체 등록을 요청하라는 안내만 둔다."*
- **실제 코드 실태 분석**:
  - `src/pages/Auth.tsx`의 관리자/담당자 회원가입은 `get_signup_company_directory` RPC를 통해 **기존에 등록된 회사를 필수로 선택해야만 가입 폼이 제출**됩니다.
  - 소속 회사가 디렉터리에 없으면 가입 자체가 불가능하므로, "가입 후 로그인해서 요청하라"는 방식은 **신규 협력업체 관리자의 회원가입을 원천 차단**하는 모순(Deadlock)을 유발합니다.
- **해결 방안 (PO 승인 완료)**:
  - `src/pages/Auth.tsx` 화면의 회사 선택란 하단에 **"소속 회사가 목록에 없으신가요? [신규 업체 등록 요청]"** 버튼을 신설합니다.
  - 비로그인 상태에서도 회사 기본 정보(회사명, 사업자번호, 대표 연락처) 및 신청자 정보(성명, 이메일, 전화번호, 참여 예정 현장)를 입력해 접수할 수 있는 모달 폼을 제공합니다.
  - 접수 후: 마스터가 검토 후 승인하면 전역 `companies`에 등록되며, 이후 신청자가 정상 회원가입을 완료할 수 있게 됩니다.

---

## 4. 데이터베이스 및 RLS 보강 권고사항

### 테이블: `company_registration_requests`
```sql
CREATE TABLE public.company_registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_no TEXT,
  type TEXT NOT NULL DEFAULT 'contractor', -- client, gc, contractor, vendor
  contact TEXT,
  address TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  parent_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  requester_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- 비로그인은 NULL
  requester_name TEXT NOT NULL,
  requester_email TEXT,
  requester_phone TEXT,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  rejection_reason TEXT,
  created_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### RLS 정책
1. **INSERT**: `anon` 및 `authenticated` 모두 허용 (비로그인 가입 대기자 및 로그인 현장 관리자 모두 요청 가능).
2. **SELECT**: 
   - `requester_id = auth.uid()`인 경우 본인 요청 조회 허용.
   - 마스터(`has_role('master')`)는 전체 목록 조회 허용.
3. **UPDATE**: 마스터만 허용 (승인/반려 상태 및 사유 변경).

### 승인 RPC: `approve_company_registration_request(p_request_id UUID)`
- 마스터 권한 검사
- 중복 확인 후 `companies` insert (또는 기존 ID 매핑)
- `project_id`가 지정되어 있으면 `project_companies`에 자동 연결 (`role_in_project = request.type`, `parent_company_id = request.parent_company_id`)
- `status = 'approved'`, `created_company_id` 세팅

---

## 5. 프론트엔드 작업 체크리스트 (Cursor 진행용)

1. **`src/pages/SettingsCompanies.tsx`**:
   - `role_in_project` 덮어쓰기 루프 제거 (기존 현장 연결의 역할 보존, 신규 연결 시에만 초기값 부여).
   - 마스터용 [업체 등록 요청함] (Pending Requests) 탭/테이블 추가 (승인 / 반려 모달).
2. **`src/pages/ProjectDetail.tsx`**:
   - **공사개요 정상 저장 연동**: 임의의 레거시 필드(`scope`, `period`) 대신, 사용자가 직접 입력한 **공사명(`construction_name`), 공종(`construction_type`), 도급금액(`construction_amount`), 착공일(`construction_period_start`), 준공일(`construction_period_end`)**을 `company_construction_info` 테이블에 upsert 연동하여 **안전관리자 선임 및 재해예방기술지도 대상 판정 데이터가 정상 유지**되도록 수정.
   - 업체 검색 결과 없을 때 직접 `companies.insert` 대신 "새 업체 등록 요청" 모달로 연결.
   - 현장 관리자는 `role_in_project`, `parent_company_id`, 발주처 안전열람 및 **해당 현장의 공사개요**를 수정 가능하도록 제어 (단, 전역 사명/사업자번호 수정은 마스터만 허용).

3. **`src/pages/CompanyDetail.tsx`**:
   - 개요 탭 [저장] 버튼 제거 및 마스터 수정 안내 배너 적용.
   - 공사 개요(`company_construction_info`) 탭 현장별 격리 유지.
4. **`src/pages/Auth.tsx`**:
   - 관리자 회원가입 폼에 "비로그인 신규 업체 등록 요청" 모달 추가.

---
위 내용을 바탕으로 커서(Cursor) 에이전트가 최종 구현을 진행해주시기 바랍니다.
