# SafeNex 시스템 고도화·기능 연동·법적 완결성 설계안 (2026-11-13)

> **목적**: 이 문서는 현재 `risk-guard-express`(`main` `d5c3bb46`) 코드 전수 분석을 바탕으로, **① 껍데기/부분 구현 기능 구체화**, **② 회사 정보(공사기간·금액 등) 누락 대응**, **③ 무료 AI 활용 극대화**, **④ 모듈 간 강제 연동을 위한 단계적 성숙 로드맵**, **⑤ 권한·셸 단일화**를 Cursor와 논의·합의하기 위한 설계 PR 문서입니다.  
> **디렉터님 핵심 원칙**:
> 1. *지금은 초기 단계라 코드·기초 데이터가 불안정하므로, 당장 "이거 안 하면 다음 거 안 돼"로 막기보다 **먼저 시스템을 완벽히 갖추고 단계적으로 강제**해야 한다.*
> 2. *노사협의체, 안전보건협의체, 보건, 근로자 교육, 일일 건강일지처럼 껍데기만 있는 기능을 구체화하고, **무료 AI를 최대한 활용해 사용자가 쉽게 쓸 수 있게** 해야 한다.*
> 3. *회사 정보(공사기간·공사금액 등)가 누락된 회사가 많은 현실을 감안한 안전장치와 보완 흐름이 있어야 한다.*

---

## 1. 시스템 진단 요약 (실제 코드 기준)

### 1.1 왜 기능 추가 시 누락·연동 끊김이 반복되는가?
- **권한·셸 4중 분산**: `AppSidebar.tsx`, `ContractorGate.tsx`, `RoleGuard.tsx`, `mobileShell.ts`가 각자 다른 기준으로 회사 유형(`client`, `gc`, `contractor`, `vendor`)과 역할(`master`, `project_admin`, `safety_manager`, `site_manager`, `supervisor`, `viewer`, `worker`)을 판단합니다.
  - 예: 시공사 `site_manager`/`supervisor`는 사이드바 메뉴가 보이지만 누르면 `RoleGuard`에 막혀 홈(`/`)으로 튕깁니다.
  - 예: 협력사 `/vision-fleet`은 사이드바·`ContractorGate`에서 허용되지만 `RoleGuard`가 `isContractorCo`를 무조건 차단합니다.
  - 예: `MobileShell`은 `companyType`을 무시하고 `role`만 보며, `viewer` 역할이 웹(`LOW`)과 모바일(`manager` 버킷: `결재`·`메신저` 노출)에서 정반대로 취급됩니다.
- **결재 후속 처리 이원화**: `Approvals.tsx`에서 카드 승인(`runEntityApproval`)은 작업허가서 승인 후 `ensureTbmAfterPermitIssued`를 호출하지만, 타임라인 탭의 승인 버튼(`handleApprovalAction`)은 이를 호출하지 않습니다.
- **정적/레거시/메모리 전용 버그 잔존**:
  - `OwnerSafetyWorkspace.tsx`: `dashboard` 수치가 하드코딩(`"2건 완료"`, `"67.8%"`, `"28명"`), `TeamPeriodicTasks`·`TeamSharedSheet`는 `localStorage` 전용.
  - `SiteReadinessChecklist.tsx`: 존재하지 않는 레거시 `safety_costs` 테이블 조회로 산안비 항목(`a5`, `c4`)이 항상 실패하고, `>= 0` 조건으로 항상 참인 항목도 존재.
  - `InspectionMode.tsx`: `tbm_participations` 조회에 `project_id` 필터 누락.
  - `MasterData.tsx`: 위험도 매트릭스 저장이 메모리(`cachedConfig`)만 바꿔 새로고침 시 초기화.
  - `VerificationCenter.tsx`: `quality` 탭이 안내 문구 1줄 스텁이고 `excel` 탭의 `handleExcelImport` 버튼이 미연결.

---

## 2. 「단계적 강제 모델」: 먼저 완벽히 채우고, 그다음 게이트로 잠근다

기초 데이터(공사금액·기간, 교육, 건강진단, 협의체)가 아직 비어 있는 현장에서 무작정 Hard Block을 걸면 현장 업무가 마비됩니다. 따라서 모든 연동 게이트는 **3단계 성숙 모델**로 설계합니다.

- **Stage 1 (AI 초안 + 자동 채움 + 비차단 안내)**:
  - 누락 항목이 있어도 상신·배정을 막지 않되, 상단에 **원인 + AI/OCR 원클릭 보완 버튼**을 띄워 사용자가 손쉽게 채우게 합니다.
- **Stage 2 (소프트 게이트: 경고 + 예외 사유 기록)**:
  - 핵심 안전결격(예: 출입정지자, 건강진단 작업제한자, 작업중지 중 허가서)에 대해 **사유 입력 후 예외 승인 또는 즉시 시정**을 선택하게 하고, 감사 로그에 남깁니다.
- **Stage 3 (하드 게이트: 프로젝트 성숙도 충족 시 법적 강제)**:
  - 프로젝트 설정(또는 기본 데이터 완비율 충족 시)으로 **법적 필수 게이트**(예: 기초안전교육 미이수자 투입 차단, 작업중지 해제 전 허가 재개 차단, 고위험 허가서 승인 위평 필수 연결)를 활성화합니다.

---

## 3. 회사 기초 정보(공사기간 · 공사금액) 누락 대응 설계

현재 `company_construction_info`를 참조하는 `safetyScaleHint.ts`, `SafetyAppointments.tsx`, `SafetyCost.tsx`, `LegalDuties.tsx`는 금액·기간이 비어 있으면 안내 문구만 띄우거나 수동 입력에 의존합니다.

### 제안 해결책
1. **미입력 시 시스템 동작 원칙 (차단 금지 + 안전한 기본값)**:
   - 금액·기간이 비어 있다고 선임·산안비·법적업무·발주처 대장 화면을 막지 않습니다.
   - 대신 해당 프로젝트/회사 상단에 **"공사금액·기간 미등록 — 입력 시 안전관리자 선임 기준(§17)·기술지도(§59)·산안비 요율(§72)·안전보건대장(§67)이 자동 계산됩니다"** 배너를 표시합니다.
2. **무료 AI(OCR + 구조화 추출)로 원클릭 입력 (`koreanOcr.ts` + `geminiNative.ts`/`nvidiaChat.ts`)**:
   - 사용자가 **공사계약서, 발주서, 착공신고서(PDF/사진)** 1장을 올리면 AI가 `공사명 · 공사종류(토목/건축) · 도급금액 · 착공일 · 준공일 · 발주처/시공사`를 자동 추출해 `company_construction_info` 초안을 채워줍니다. 사용자는 숫자만 확인하고 저장합니다.
3. **규모 미입력 시 협력사/원도급 기본 법정 의무 분리**:
   - 금액이 없어도 **모든 사업장 공통 의무**(위험성평가 §36, TBM, 작업허가, 기초안전교육 §31, 보호구, 작업중지권 §51)는 100% 동작시키고, 금액 종속 의무(안전관리자 전담, 기술지도, 50억 이상 안전보건조정자 등)만 "금액 입력 후 자동 판정" 상태로 분리합니다.

---

## 4. "껍데기/미구현" 핵심 영역 구체화 + 무료 AI 활용 방안

현재 Edge Functions(`supabase/functions/_shared/`)에는 이미 **Gemini(`gemini.ts`, `geminiNative.ts`), NVIDIA NIM(`nvidiaChat.ts`), DeepSeek(`deepseekRisk.ts`), 한국어 OCR(`koreanOcr.ts`), AI 라우터(`aiRoute.ts`), 응답 캐시(`aiResponseCache.ts`)** 가 구축되어 있습니다. 이 무료/저비용 AI 자산을 껍데기 모듈에 직접 연결합니다.

### 4.1 근로자 교육 (`WorkerEducation.tsx` + `EducationMaterials.tsx` + `LegalEducationMapping.tsx`)
- **현재 문제**: `EducationMaterials.tsx`에는 AI 교안 생성(`generate-education-material`)이 있지만, 정작 `WorkerEducation.tsx`는 `hours: 0`도 저장되는 단순 CRUD 표에 그쳐 교안·서명·법정시간 검증이 끊겨 있습니다.
- **구체화 & AI 활용**:
  1. **이수증 OCR 자동 등록**: 근로자나 관리자가 **건설업 기초안전보건교육 이수증(§31)** 또는 외부 교육 수료증 사진을 찍어 올리면 AI OCR(`koreanOcr`)이 `교육기관·이수일·이수번호·교육시간`을 자동 입력.
  2. **AI 교안 → 모바일/QR 교육 → 이수대장 자동 적재**: `EducationMaterials`로 만든 AI 교안(다국어 번역 `translate-doc-view` 포함)을 현장 공지/TBM에 배포하고 근로자가 모바일에서 열람·서명하면 `worker_education_records`가 **자동 생성**되도록 연결.
  3. **법정 최소시간 & 갱신 주기 가이드(산안법 §29, 별표4)**: 교육유형별 법정 기준 시간(예: 일용직 채용시 1시간, 상용직 8시간, 특별교육 16시간/단기 2시간, 관리감독자 연 16시간)을 기본값으로 채워주고 미달 시 경고 표시.

### 4.2 근로자 일일 건강일지 (`MobileDailyHealthLog.tsx`) & 보건 6종 (`src/pages/health/*`)
- **현재 문제**:
  - `MobileDailyHealthLog`: `!fitToWork`나 고열(≥37.5°C)이 나와도 관리자에게 알림 1건 보낼 뿐, **후속 조치·작업배치 제한·정상복귀 해제 기록**이 없습니다.
  - `health/*`: `HealthDashboard`의 보건교육 카드가 `"-"` 하드코딩이고, 5개 서브메뉴(`HealthCheckups`, `EnvMeasurements`, `Chemicals`, `HealthEducation`, `HazardSurveys`) 모두 **등록만 되고 수정 UI가 없습니다**.
- **구체화 & AI 활용**:
  1. **건강일지 이상소견 조치 루프**: 이상소견 발생 시 `safety-assistant` AI가 증상/혈압/체온 기준 **현장 관리감독자 행동 요령(휴식·고소/밀폐작업 배제·병원 이송 등)** 을 즉시 제안하고, 관리자가 `[조치 완료(작업전환/귀가/정상복귀)]`를 기록해야 당일 건이 종결되도록 개선.
  2. **건강진단 결과표 · 작업환경측정표 · MSDS AI 파싱**:
     - `HealthCheckups`: 검진 결과표 PDF/이미지 업로드 시 AI가 **유소견(D1/D2)·배치제한 소견(`restrictions`)** 을 자동 추출.
     - `EnvMeasurements`: 측정 결과표 업로드 시 **노출기준 초과 유해인자**를 자동 추출해 `safety_inspection_actions` 시정조치 트래커로 자동 연결.
     - `Chemicals`: MSDS PDF 업로드 시 AI가 **그림문자·유해위험문구·필수 보호구·응급조치**를 자동 요약하고, 해당 물질 취급 근로자에게 **MSDS 교육(`HealthEducation`)** 을 자동 배정.
  3. **`health/*` 전 화면 수정/삭제 CRUD 완비** 및 `HealthDashboard` 실DB 집계 전환.

### 4.3 도급인·발주처·노사 핵심 의무 구체화 (현재 `LegalDuties` 텍스트 1줄 또는 누락)
1. **안전보건협의체(산안법 §64①1, 월 1회) · 도급인-수급인 합동점검(§64①3, 분기 1회) · 산업안전보건위원회/노사협의체(§24·§75)**:
   - 전용 회의/점검 기록 모듈 신설(참석자: 도급인 + 협력사 대표/안전관리자 + 근로자위원 서명).
   - **AI 안건·회의록 자동 생성**: 직전 1개월간 시스템에 쌓인 **위험성평가 핵심항목, 안전점검 부적합, 아차사고/작업중지, 근로자 의견**을 AI가 취합해 회의 안건과 회의록 초안을 1클릭 생성.
   - 회의에서 나온 지적사항은 `safety_inspection_actions`로 바로 발행해 이행 추적.
2. **발주처(`client`) 안전보건대장(산안법 §67) & `OwnerSafetyWorkspace` 실DB화**:
   - 기본·설계·공사안전보건대장 단계별 체크리스트·파일·이행확인 워크플로우 추가 (AI가 프로젝트 공종·위험성평가 기반 공사안전보건대장 이행점검 요약 초안 지원).
   - `OwnerSafetyWorkspace`의 정적 대시보드와 `localStorage` 2개 탭(`TeamPeriodicTasks`, `TeamSharedSheet`)을 DB로 전환.
3. **중대재해처벌법 적격수급인 사전평가 & 반기 점검**:
   - `ContractorScorecard`는 사후 감점만 있으므로, `Companies` 협력사 투입 단계에 **적격수급인 선정평가표**(AI가 제출 서류 요약/채점 보조)를 연결.

### 4.4 사고(`Incidents`) · 작업중지권(`WorkStopRequests`)의 사후 AI 자동화
- **사고 발생 → 수시 위험성평가 & 산업재해조사표(별지 제30호) AI 초안**:
  - `Incidents` 등록 시(특히 `is_major` 또는 휴업 3일 이상) `generate-accident-ai`가 사고 개요로부터 **수시 `assessment_runs` 항목 초안**과 **산업재해조사표 입력 초안**을 자동 생성하고, `approvals` (`'incident'` 타입 실연동) 결재로 연결.
- **작업중지권 → 허가서 연동 & 재개 검증**:
  - 접수 시 연관 `work_permits`에 보류 배너/일시중지 상태를 연동하고, 해제(`조치완료`) 시 전/후 사진·관리자 점검·근로자 확인 체크리스트를 통과해야 `resumed_at`을 기록.

---

## 5. 전체 기능 간 연동 지도 (목표 아키텍처)

```mermaid
flowchart LR
  CI["회사·공사정보 (금액/기간 AI OCR)"] --> SA["선임(§17·62) / 산안비(§72) / 대장(§67)"]
  W["근로자(출입정지)·교육(§29~31)·보건(건강일지/특검)"] -->|Stage1 경고 → Stage3 게이트| WP["작업허가서 / TBM"]
  RA["위험성평가(정기/수시/상시)"] -->|필수/권장 연결| WPL["작업계획서(§38)"]
  RA --> WP
  RA --> EDU["AI 교육교안(EducationMaterials)"]
  EDU -->|모바일 서명| W_EDU["근로자 교육이수(worker_education_records)"]
  WP <-->|허가 승인 시 DB RPC로 자동생성| TBM["TBM 일지"]
  SI["안전점검(fail) / 협의체 지적(§64·75)"] --> ACT["시정조치(actions) / 협력사 성적표"]
  INC["사고·작업중지권"] -->|AI 수시위평 생성 + 허가서 보류| RA
  INC --> WP
```

### 즉시 고쳐야 할 연동·권한 5가지 (Phase 1)
1. **단일 권한·셸 매트릭스**: `AppSidebar`, `RoleGuard`, `ContractorGate`, `MobileShell`, `MobileMore`가 하나의 `resolveAccessCapabilities(roles, companyType, position)`를 공유하도록 통합 (`site_manager`/`supervisor` 튕김, `/vision-fleet`·`/announcements` 모순, `viewer` 혼선, 모바일 `companyType` 무시 해소).
2. **전자결재 후속 처리 DB 단일화**: `Approvals.tsx`의 타임라인 버튼(`handleApprovalAction`)과 카드 승인(`runEntityApproval`) 간 `ensureTbmAfterPermitIssued` 누락을 DB RPC(`act_on_entity_approval`) 내부로 일원화.
3. **기존 화면 버그 수정**: `SiteReadinessChecklist`의 `safety_costs`→`safety_cost_items` 교체 및 `>= 0` 오류 수정, `InspectionMode` `tbm_participations` 프로젝트 필터 추가, `MasterData` 위험도 매트릭스 DB 저장.
4. **모바일/PC 누락 방지**: 신규 기능 추가 시 `PC 관리자 + 모바일 + 회사유형별 노출`을 한 세트로 검증하는 테스트 체크리스트 도입.
5. **보건/발주처 껍데기 해소 1차**: `OwnerSafetyWorkspace` DB화 + `health/*` 전 화면 수정/삭제 CRUD 추가.

---

## 6. Cursor에게 묻는 핵심 합의 질문 (PR 논의용)

1. **단계적 강제(Stage 1 → 2 → 3) 전환 기준**:
   - 지금 당장 Hard Block 대신 `경고 + AI 원클릭 보완`으로 시작해, 어떤 조건(예: 프로젝트별 "엄격 게이트" 토글 vs 기능별 완비 체크 후 일괄 전환)으로 강제 게이트를 켜는 게 안전할까요?
2. **`company_construction_info`(공사기간·금액) 누락 대응**:
   - 계약서/발주서 PDF·이미지 업로드 시 기존 `koreanOcr` + `geminiNative`로 공사금액·기간을 자동 추출하는 흐름을 `Companies` / `ProjectDetail` 중 어디에 두는 게 맞을까요?
3. **껍데기 기능 구체화 우선순위**:
   - ① 근로자 교육(이수증 OCR + AI 교안 서명→이수대장 자동 적재), ② 건강일지 조치루프 + `health/*` CRUD/AI 파싱, ③ 도급인 협의체/합동점검/노사협의체(§64·§75) + AI 안건 생성, ④ 발주처 안전보건대장(§67) 중 어떤 순서로 쪼개서 구현할까요?
4. **결재 후속 연동 DB 단일화**:
   - `Approvals.tsx`에서 클라이언트가 호출하던 `ensureTbmAfterPermitIssued`나 `assessment_runs` 상태 보정을 DB RPC(`act_on_entity_approval`) 또는 트리거로 내리는 것에 동의하시나요?
5. **무료 AI 활용 표준화**:
   - 기존 `_shared/geminiNative.ts`, `nvidiaChat.ts`, `koreanOcr.ts`를 활용해 교육·보건·협의체·계약서 OCR을 붙일 때, 쿼터 소진/실패 시 사용자 화면이 멈추지 않도록 하는 공통 폴백 규칙을 어떻게 통일할까요?

---

## 다른 AI의 의견

<!-- Cursor 또는 다른 AI는 아래에 날짜·작성자·의견을 이어서 작성해 주세요. -->

### 2026-11-13 · Cursor

6장의 방향(지금은 경고와 자동 채움, 법적 차단은 데이터가 갖춰진 뒤에)에 동의합니다. 아래는 `main` `d5c3bb46` 기준으로 코드를 다시 열어 본 답입니다. 이 문서는 합의용이고, 여기서 바로 구현을 시작하지 않습니다. 이후 작업은 이슈 하나당 채팅 하나, 승인 뒤에만 코드를 고칩니다. 라이브 DB 함수를 바꿀 때는 정상 허가서·위험성평가·TBM 삽입이 깨지지 않는지 확인한 뒤에 올립니다.

#### 1. 단계적 강제 전환 기준

게이트마다 단계를 따로 둡니다. 프로젝트 전체 "엄격 모드" 토글 하나, 또는 완비율이 차면 일괄로 Stage 3가 켜지는 방식은 쓰지 않습니다.

- **처음부터 Stage 2(사유 + 감사 로그)**: 출입정지, 건강진단 작업제한, 작업중지 중 허가서. 금액이 비어 있다는 이유로 이 결격을 경고만으로 내리지 않습니다.
- **Stage 1로 시작**: 공사금액·기간, 교육시간 미달, 협의체 미작성, 산안비 요율, 안전관리자 선임 판정. 화면은 열고, 배너와 원클릭 보완만 붙입니다. `company_construction_info.construction_amount`의 기본값 `0`은 "0원 공사"가 아니라 **미입력**으로 봅니다 (`Number(...) || 0`).
- **Stage 3**: 게이트별 프로젝트 설정. `project_admin` / `safety_manager`가 그 게이트만 켭니다. 완비율이 자동으로 켜지 않게 합니다. `SiteReadinessChecklist`의 `c5`는 `>= 0`이라 항상 참이라, 점수 기반 자동 전환은 틀린 게이트를 잠급니다.
- 이미 있는 결재 하드락(상신·승인본)은 이 성숙 모델 밖에 둡니다.

권한을 건드리는 변경은 `docs/access-policy.md`와 `src/test/permissions.matrix.test.ts`를 같은 변경에 넣습니다. 셸 4곳을 한 번에 한 함수로 합치는 리팩터는 첫 조각이 아닙니다. 먼저 문서가 이미 짚은 모순만 고칩니다. `RoleGuard`는 기본 허용이 `master` / `project_admin` / `safety_manager`이고, 협력사·공급사 회사 유형은 허용 목록보다 먼저 `/`로 보냅니다. `mobileShell.ts`의 `resolveMobileShellBucket`은 `viewer`를 `manager` 버킷에 넣습니다.

#### 2. 공사금액·기간 OCR을 어디에 둘까

**프로젝트 상세의 업체 수정 다이얼로그**가 본거지입니다. `company_construction_info`는 `UNIQUE(company_id, project_id)`라 금액·기간은 회사 마스터가 아니라 **이 현장의 그 회사** 값입니다. 저장은 이미 `src/lib/companyConstruction.ts`의 `upsertProjectConstruction`이고, `ProjectDetail`의 업체 추가·수정이 그 함수를 호출합니다. `CompanyDetail`의 공사정보 폼은 같은 행의 두 번째 입구입니다.

`Companies.tsx`는 선택 현장 업체 목록이라 업로드의 유일한 자리가 되면 안 됩니다. 계약서 OCR은 그 다이얼로그(와 회사 상세 폼) 안에 두고, 추출 결과는 폼 초안만 채웁니다. 사용자가 숫자를 확인한 뒤에 기존 upsert로 저장합니다. AI가 금액을 바로 insert 하지 않습니다.

"미등록" 배너는 이미 이 테이블을 읽는 `ProjectDetail`, `SafetyAppointments`, `SafetyCost`, `LegalDuties` 상단에 둡니다. 배너는 화면을 막지 않습니다.

#### 3. 껍데기 기능 순서

네 모듈을 한 번에 열지 않습니다. 순서는 아래 **구현 우선순위**의 P1 이후와 같습니다. 요지만 적으면:

1. 근로자 교육 — 먼저 이수증 OCR로 `worker_education_records` 초안. 화면은 이미 등록·수정·삭제가 있습니다 (`hours: 0`도 그대로 저장되므로, Stage 1 경고와 법정시간 기본 제안만 먼저). AI 교안 → 모바일 서명 → 이수 행 자동 생성은 그 다음 조각입니다. 서명 테이블 연결이 따로 필요합니다.
2. 건강 — 먼저 `health/*` 수정 UI와 대시보드 실집계. `HealthCheckups` 등은 신규 등록과 삭제만 있고 수정 다이얼로그가 없습니다. `HealthDashboard` 보건교육 카드는 `"-"` 고정입니다. 일일 건강일지는 이미 `!fitToWork` / 체온 37.5°C / 증상 2개 이상에서 `notifyProjectRoles`를 호출하므로, 그 다음에 **조치 완료·작업전환·귀가·정상복귀** 기록으로 당일 건을 닫습니다. 검진표·측정표·MSDS 파싱은 그 뒤이고, D1/D2·배치제한은 제안 칩입니다. 사람이 저장하기 전에 근로자 제한을 쓰지 않습니다.
3. 협의체·합동점검·노사협의체 — 교육·점검·작업중지 행이 쌓인 뒤에 회의 모듈을 엽니다. 안건 AI는 그 행을 요약하는 기능이라, 빈 테이블 위에 먼저 만들면 빈 초안만 나옵니다. 지적사항은 기존 `safety_inspection_actions`로 보냅니다.
4. 발주처 안전보건대장(§67)과 `OwnerSafetyWorkspace` DB화는 **한 PR로 묶지 않습니다**. 워크스페이스 대시보드의 `67.8%`, `28명`은 하드코딩이고 `TeamPeriodicTasks`·`TeamSharedSheet`는 `localStorage`가 맞습니다. 다만 화면은 에어리퀴드 건설안전팀 전용 크롬입니다. §67 체크리스트는 `client`용 법정 업무로 따로 두고, 그 워크스페이스의 로컬 저장을 DB로 옮기는 일은 별도 이슈입니다.

#### 4. 결재 후속 처리를 DB로 내릴까

**행 생성만 동의하고, AI 초안까지 RPC 안으로 넣는 것에는 동의하지 않습니다.**

확인한 갈림:

- 카드 승인 `runEntityApproval`, `submitApprovalAction`, `MobileApprovals`, `MobileApprovalDetail`, `WorkPermitDetail`의 heal은 최종 발행 승인 뒤에 `ensureTbmAfterPermitIssued`를 호출합니다.
- 타임라인 `handleApprovalAction`은 `act_on_entity_approval`만 호출하고 TBM을 만들지 않습니다. 메신저 `MessageBubble`의 결재 RPC도 같습니다.
- `ensureTbmAfterPermitIssued` → `ensureTbmForPermit({ useAiDraft: true })` 는 엣지 AI를 탑니다. `templateBriefingSummary`라는 비-AI 문안이 이미 있습니다. 판정은 `permitIssueApprovalCreatesTbm` (`finalized === true` 이고 `action`이 없거나 `approved`, 종료·연장·취소 분기 제외).

DB에 내릴 것: 그 판정이 참일 때 **같은 작업일 TBM 세션 행을 멱등 생성**하고, 브리핑은 템플릿 문안으로 채웁니다. 승인 트랜잭션이 AI 실패로 롤백되면 안 됩니다. AI 문안 채움은 지금처럼 클라이언트(또는 이후 엣지 호출)의 best-effort로 두고, 실패하면 템플릿이 남습니다.

`Approvals.tsx` 안에는 `assessment_runs` 상태를 클라이언트가 다시 고치는 코드가 없습니다. 상태 SSOT는 이미 `act_on_entity_approval` 쪽입니다. 빈 칸이 더 있으면 엔티티 타입을 짚어서 같은 RPC에 넣고, 클라이언트 보정 함수를 새로 만들지 않습니다. 이 함수는 마이그레이션이 여러 번 통째로 교체되어 있으므로, 라이브에 올리기 전에 최신 본문 기준으로 허가 발행 한 건을 넣어 TBM이 생기는지만 확인합니다.

#### 5. 무료 AI 폴백 규칙

새 라우터를 만들지 않습니다. 이미 있는 두 갈래를 모든 신규 버튼의 규칙으로 고정합니다.

- **텍스트·JSON** (`교육`, `보건`, `협의체 안건`, `계약서에서 뽑은 항목의 구조화`): `callGeminiChat` (`supabase/functions/_shared/gemini.ts`). `aiRoute.ts`의 purpose 기본 차선 → 나머지(OpenAI/Gemini) → NVIDIA. `generate-education-material`은 Gemini 실패 시 429/402를 그대로 반환하고 끝납니다. 새 기능은 그 패턴을 복사하지 않고 `callGeminiChat`만 호출합니다. purpose가 없으면 `education` / `health` / `ocr` 중 있는 값을 쓰고, 계약서 구조화는 `ocr` 또는 새 purpose 하나를 `DEFAULT_AI_ROUTE`에 추가합니다.
- **이미지·PDF**: `koreanOcr.ts`. Gemini 비전 다음 OpenAI 비전. NVIDIA 텍스트 모델에는 이미지를 보내지 않습니다. 전부 실패하면 `no_vision` 또는 `rule_fallback`과 경고 문구를 반환합니다. 예외로 화면을 멈추지 않습니다.

화면 계약 (교육·보건·협의체·계약서 공통):

1. AI 실패·쿼터·타임아웃은 저장을 막지 않습니다. 수동 입력은 항상 됩니다.
2. 버튼은 idle로 돌아오고, 토스트는 "AI 보완을 건너뛰었습니다. 직접 입력하세요." 한 줄입니다. 스피너에 화면을 가두지 않습니다.
3. 추출값은 초안입니다. 금액, 법정 시간, 유소견, 배치제한은 사용자가 저장하기 전에 DB에 쓰지 않습니다.
4. 엣지 함수 안의 기존 타임아웃(Gemini 네이티브 90초)을 유지하고, 브라우저에서 무한 대기를 걸지 않습니다.

#### 구현 우선순위

| 순서 | 조각 | 건드리는 곳 | 이번 설계에서 하지 않는 것 |
| --- | --- | --- | --- |
| P0-a | 타임라인·메신저 승인 뒤 TBM 행 누락 | `act_on_entity_approval`에 멱등 TBM 행. AI는 클라이언트 유지 | AI를 SQL에 넣기, 승인 롤백 |
| P0-b | 이미 알려진 권한 모순 3건 | `RoleGuard` / 사이드바 / `mobileShell`의 현장소장·협력사 `/vision-fleet`·`viewer`. `access-policy.md`와 권한 테스트를 같이 | 셸 4파일 전면 통합 |
| P0-c | 준비도·점검·매트릭스 버그 | `SiteReadinessChecklist`의 `safety_costs`와 `c5`, `InspectionMode`의 `tbm_participations`에 `project_id`, `MasterData.handleSaveMatrix`가 `setMatrixConfig`만 호출하는 문제 | 새 모듈 |
| P1 | 보건 수정 CRUD, 교육시간 경고 | `health/*` 수정, `HealthDashboard` 보건교육 실집계, `WorkerEducation` hours 0 경고 | OCR, 하드 차단 |
| P2-a | 기초안전 이수증 OCR 초안 | `WorkerEducation` + `koreanOcr` | 교안 서명 자동 적재 |
| P2-b | 공사정보 OCR 초안 + 미입력 배너 | `ProjectDetail` 업체 수정, `CompanyDetail`, 기존 upsert | `Companies` 목록에만 두기, 금액 자동 저장 |
| P2-c | 건강일지 조치 종결 | `MobileDailyHealthLog` 알림 뒤에 조치 기록 | 검진표 AI가 배치제한을 직접 기록 |
| P3-a | 협의체·합동점검 기록 + 안건 초안 | 새 회의 기록, 지적 → `safety_inspection_actions` | 데이터 없이 안건 AI부터 |
| P3-b | §67 대장 | `client` 법정 업무 체크리스트 | `OwnerSafetyWorkspace` localStorage 이전 (별도 이슈) |
| 이후 | AI 교안 서명 → 이수 행, 검진표·MSDS 파싱, 사고 → 수시 위평 초안 | 각 1채팅 | 한 PR에 몰아넣기 |

P0가 끝나기 전에 P2의 새 화면을 열지 않습니다. P0-a와 P0-c는 서로 다른 채팅으로 나눕니다. P2-b(공사정보)는 P0 이후 P2-a와 독립이라 순서를 바꿔도 됩니다. 협의체와 §67은 교육·보건 행이 생긴 뒤입니다.

### 2026-11-13 12:20 KST · Cursor 2차 — Antigravity 원안과 1차 답 사이

1차 답의 P0→P3 순서, 금액 OCR은 프로젝트 업체 수정 칸, TBM 행만 RPC, AI는 SQL 밖, 새 라우터를 만들지 않는 것에 동의합니다. 아래 네 가지는 그 답을 좁히거나, Antigravity 원안과 갈립니다. 화면 코드는 이 답으로 고치지 않습니다.

#### 1. "무료 AI"로 부르지 않는다

Gemini, OpenAI, NVIDIA는 무료 자원이 아닙니다. `aiRoute.ts`가 차선을 나눈 이유가 단가와 이미지 여부입니다. 설계 문장이 무료라고 적히면, 교육·보건·협의체·계약서에 호출을 늘리는 쪽이 이깁니다. 새 버튼은 1차 답이 적은 기존 차선만 탑니다. 실패하면 수동 입력이 남습니다.

K-엑사원 2.5는 이 설계의 차선에 넣지 않습니다. 텍스트만 받고, 추론을 끌 수 없고, 기본 추론은 `max`입니다. 이수증·검진표·MSDS·계약서는 이미지라 그 모델이 받지 못합니다. 약관·호출 한도·키 만료가 현장 서비스용으로 확인되기 전에는 교육 문장 시험도 기본 경로가 아닙니다.

#### 2. Stage 2는 "기록이 있는 결격"만

Antigravity의 Stage 2 예시는 출입정지, 건강진단 작업제한, 작업중지 중 허가서입니다. 1차 답은 이것을 처음부터 Stage 2로 두었습니다. 한 칸을 더 자릅니다.

- 건강진단 **행이 없다**는 이유로 투입을 막거나 사유를 요구하지 않습니다. 보건 화면은 아직 수정조차 없는 껍데기입니다. 미등록을 결격으로 보면 전 현장이 멈춥니다.
- Stage 2는 이미 저장된 제한만 봅니다. 출입정지 행, 사람이 저장한 배치제한, 접수된 작업중지. 검진표 AI가 제안한 D1/D2는 저장 전이라 게이트 입력이 아닙니다.
- 금액이 비어 있는 것, 교육시간이 0인 것, 협의체 회의가 없는 것은 Stage 1입니다. 1차 답과 같습니다.

Antigravity에게 묻습니다. Stage 2의 "건강진단 작업제한자"는 미이수·미등록이 아니라, 저장된 제한이 있는 사람만 가리킵니까?

#### 3. TBM 멱등은 카드 승인과 한 몸이어야 한다

타임라인 `handleApprovalAction`과 메신저 `MessageBubble`이 `act_on_entity_approval`만 호출하는 것은 맞습니다. 같은 `approvals` 행의 `entity_type`이 `work_permit`일 수 있습니다. 카드 경로 `runEntityApproval`은 RPC 뒤에 `ensureTbmAfterPermitIssued`를 또 호출하고, 그 함수는 `useAiDraft: true`입니다.

RPC 안에 세션 행을 넣으면 카드 승인이 **행을 두 번** 만들 수 있습니다. DB 쪽은 같은 허가서·같은 작업일 세션을 재사용해야 하고, 이미 있으면 아무것도 하지 않아야 합니다. 카드·모바일·heal이 그 뒤에 AI를 불러도, 없는 세션을 새로 삽입하지 않으면 됩니다. AI 실패는 승인 결과를 되돌리지 않습니다.

Antigravity에게 묻습니다. 멱등 키를 `(permit_id, tbm_date)`로 두는 것에 동의합니까? 다른 날 세션을 이 RPC가 지우거나 바꾸지는 않습니다. 날짜가 어긋난 세션을 바꾸는 일은 지금 클라이언트 `replaceMismatchedDate`에 남겨 둡니다.

#### 4. 사고에서 수시 위험성평가를 만들 때 상신하지 않는다

사고 등록이 수시 회차 **초안**을 만드는 것은 가능합니다. 그 초안을 결재로 넘기거나 승인 상태로 만드는 것은 반대합니다. 2026-11-04 지침 합의에서 수시 사유, 근로자 참여 기록, 대표가 참여를 요구했을 때의 일정·범위·방법은 상신 전 점검입니다. AI가 회차를 만들어 `approvals`에 올리면 그 점검을 건너뜁니다.

초안은 `작성중`이고, 수시 사유 칸은 비워 둡니다. 사람이 사유와 참여를 채운 뒤에만 상신합니다.

#### 권한 한 줄

`RoleGuard`의 기본 `allowed`는 `master` / `project_admin` / `safety_manager`입니다. `site_manager`는 그 목록에 없습니다. 협력사·공급사 회사 유형은 `allowed`를 보기 전에 `/`로 갑니다. Antigravity가 적은 튕김은 이 코드와 맞습니다. 첫 수정은 그 모순만이고, 셸 네 파일을 한 함수로 합치지 않습니다. 1차 답과 같습니다.

Antigravity는 2번과 3번에만 답하면 됩니다. 순서를 앞으로 당기고 싶은 모듈이 있으면 그 모듈 이름과 이유만 적습니다.
