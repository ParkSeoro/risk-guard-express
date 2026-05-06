# 근로자 참여 기반 운영 시스템 구축 계획

기존 안전관리시스템을 유지하면서 6개 모듈을 단계적으로 통합합니다. 산안법 기준을 반영하고, 기존 위험성평가/TBM/작업허가/안전점검 흐름과 연결합니다.

---

## Phase 1 — 데이터베이스 스키마 (Migration)

새 테이블을 추가하고 기존 테이블에 컬럼을 보완합니다. 모두 RLS 적용.

- **`safety_education_materials`** — AI 생성 교육자료 저장
  - `run_id`(FK assessment_runs), `work_plan_id`(FK work_plans, nullable), `project_id`, `company_id`
  - `title`, `work_overview`, `key_hazards`(jsonb), `accident_cases`(jsonb), `safety_measures`(jsonb), `prohibited_actions`(jsonb), `ppe_requirements`(jsonb), `tbm_summary`(text)
  - `auto_generated`(bool), `generated_by`(uuid), `version_number`(int)
- **`workers`** — 근로자 간편 계정 (auth.users와 별개)
  - `name`, `phone`(unique key + project), `company_id`, `project_id`
  - `qr_token`(unique), `education_confirmed_at`, `is_active`
- **`work_permit_workers`** — 허가서-근로자 연동
  - `work_permit_id`(FK), `worker_id`(FK), `notified_at`, `notification_status`
- **`worker_entry_logs`** — 입퇴장 기록
  - `worker_id`, `work_permit_id`, `project_id`, `entry_at`, `exit_at`
  - `entry_signature_data`(text base64), `exit_signature_data`(text base64)
  - `risk_assessment_confirmed`(bool), `education_confirmed`(bool), `tbm_confirmed`(bool)
  - `no_accident_confirmed`(bool — 퇴장 시), `entry_method`(qr|button)
- **`work_plans`** 컬럼 추가: `auto_education_enabled`(bool default true)

전부 RLS는 기존 패턴 활용: `is_project_member` + `can_access_safety_cost` 또는 회사 격리.

---

## Phase 2 — 교육자료 AI 자동 생성

**Edge Function**: `supabase/functions/generate-education-material/index.ts`
- 입력: `run_id` 또는 `work_plan_id`
- 위험성평가 항목 + 작업계획서 + 과거 사고사례(`accident_cases`) 조회
- Lovable AI Gateway (`google/gemini-3-flash-preview`) 호출
- Tool calling으로 구조화된 출력 (work_overview, key_hazards 배열, accident_cases 배열, safety_measures, prohibited_actions, ppe_requirements, tbm_summary)
- `safety_education_materials` 테이블에 저장

**프론트엔드**:
- 신규 페이지 `src/pages/EducationMaterials.tsx` — 자료 목록/생성/수정
- `src/components/education/MaterialEditor.tsx` — 섹션별 편집
- **PDF 출력** (현장용): A4 세로, 맑은 고딕, 위험요인/사고사례/대책/금지사항/PPE
- **PPT 출력** (관리자용): 클라이언트에서 `pptxgenjs`로 생성 (10페이지 표준 템플릿)
- **TBM 요약**: TBM 작성 시 "교육자료 불러오기" 버튼으로 briefing_summary 자동 채움
- 작업계획서 화면에 `auto_education_enabled` 토글

---

## Phase 3 — 근로자 간편 계정

- 작업허가서 화면에 **"근로자 등록 QR"** 버튼 → QR이 `/worker/register?project=...&permit=...` 링크
- **신규 페이지** `src/pages/WorkerRegister.tsx` (공개, 비인증)
  - 이름, 전화번호, 소속사 입력 → `workers` 업서트 (전화번호 unique)
  - 등록 후 `qr_token` 발급, localStorage에 저장
- **신규 페이지** `src/pages/WorkerPortal.tsx` (qr_token 기반)
  - 위험성평가 열람 (read-only), 교육자료 확인, TBM 참여, 서명, 입퇴장
  - 그 외 메뉴 노출 금지
- DB 함수 `register_worker(_name, _phone, _project_id, _company_name)` SECURITY DEFINER

---

## Phase 4 — 작업허가서 + 근로자 연동

- `WorkPermits.tsx`에 **"근로자 지정"** 다이얼로그 추가
  - 프로젝트 등록 근로자 리스트에서 선택 → `work_permit_workers` 저장
- 허가서 **승인 완료** 시:
  - 트리거 또는 클라이언트에서 `notifications` 테이블 insert (worker_id 기반)
  - SMS는 비용 이슈로 제외, 인앱 알림 + 등록 시 입력한 전화번호로 카톡 링크 안내(향후)

---

## Phase 5 — 입장/퇴장 시스템

- **WorkerPortal**에 입장/퇴장 탭
  - **입장**: 위험성평가 확인 체크 + 교육 확인 체크 + TBM 참여 확인(자동 조회) → 전자서명 → `worker_entry_logs` insert
  - **퇴장**: 작업 종료 시간 + 무재해 확인 체크 + 전자서명 → 같은 row update
- 조건 미충족(허가 미승인 / 교육 미확인 / TBM 미참여) 시 **"작업 불가"** 배지 + 입장 차단
- 관리자 화면 `src/pages/WorkerAttendance.tsx` — 일자별 입퇴장 현황, CSV/PDF 출력

---

## Phase 6 — 작업 통제 게이트 확장

`WorkPermits.tsx`의 `exec_ok` 계산에 다음 조건 추가:
- 작업허가 승인 ✓
- 당일 TBM 참여 ✓
- 교육 확인 ✓ (`workers.education_confirmed_at`)
- 입장 완료 ✓ (`worker_entry_logs.entry_at` 당일 존재)

미충족 시 "작업 불가" 빨간 배지로 표시, 사유 툴팁 노출.

---

## 사이드바/라우트
- `AppSidebar.tsx` 점검/교육 그룹에 "교육자료", "근로자 관리", "입퇴장 현황" 추가
- `App.tsx`에 `/education-materials`, `/worker-attendance`, 공개 라우트 `/worker/register`, `/worker/portal/:token` 등록

---

## 기술 메모 (Technical)
- AI: Lovable AI Gateway, tool calling으로 JSON 강제
- PPT: `pptxgenjs` (npm) 클라이언트 생성, 다운로드
- PDF: 기존 `window.print()` + Malgun Gothic 인라인 스타일
- 서명: 기존 signature pad 컴포넌트 재사용
- IME: 모든 한글 입력은 `IMESafeInput`
- 보안: 근로자 토큰은 unique uuid, RLS는 SECURITY DEFINER 함수로 우회 (workers 테이블은 본인 토큰만 조회 가능)
- 회사 격리: 모든 새 테이블 `company_id` 필수, `can_access_safety_cost` 패턴 적용

---

## 작업 순서
1. Phase 1 마이그레이션 (테이블 + RLS + 함수)
2. Phase 2 교육자료 AI + UI + PDF/PPT
3. Phase 3 근로자 등록 + Portal
4. Phase 4 허가서 연동 + 알림
5. Phase 5 입퇴장 + 서명
6. Phase 6 게이트 확장 + 사이드바

각 Phase 완료 후 사용자 확인 가능 상태로 빌드.
