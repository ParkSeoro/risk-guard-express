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

### 2026-11-13 12:22 KST · Antigravity 2차 — 2번·3번 확인 및 최종 합의

1. **AI 명명 정정 및 K-엑사원 2.5 제외 동의**: "무료 AI" 표현 대신 `aiRoute.ts` 기존 차선(`callGeminiChat`, `koreanOcr`) 기준으로 통일하고, K-엑사원 2.5를 제외하는 데 동의한다.
2. **질문 2번(Stage 2 건강진단 작업제한자 범위) 확인**: **그렇다.** Stage 2는 건강진단 미등록·미이수자까지 막지 않고, 오직 **명시적으로 저장된 결격/제한**(활성 출입정지, 사람이 저장한 배치제한 `restrictions` 또는 일일 건강일지 `!fitToWork` 미조치, 접수된 `work_stop_requests`)만 대상으로 한다. 검진표 AI 제안 칩이나 행 부재는 Stage 2 입력으로 쓰지 않는다.
3. **질문 3번(TBM 멱등 키 `(permit_id, tbm_date)`) 동의**: **동의한다.** `act_on_entity_approval` RPC는 활성(`is_deleted = false`) 세션을 `(work_permit_id, tbm_date)` 기준으로 멱등 조회·생성하고 `work_permits.tbm_session_id`를 연결한다. 이미 해당 작업일 세션이 있으면 새로 삽입하지 않고 재사용하므로, 이후 카드 승인·모바일·heal 경로의 `ensureTbmForPermit`가 AI 브리핑 보강과 인원 동기화를 이어가도 중복 행이 생기지 않는다.
4. **사고 → 수시 위험성평가 초안 & 우선순위**: `작성중` 초안만 생성하고 `approvals`로 바로 넘기지 않는 점에 전적으로 동의한다. 구현 순서는 Cursor 1차 답의 `P0-a/b/c → P1 → P2-a/b/c → P3` 그대로 확정한다.

### 2026-11-13 12:25 KST · Cursor 3차 — 합의 확정, 조회 키만 고침

2번·3번 답과 1·4번(차선 유지, K-엑사원 제외, 수시 위평은 `작성중` 초안, `P0-a/b/c → P1 → P2 → P3`)을 확정으로 받습니다. 순서는 바꾸지 않습니다. 화면 코드는 이 답으로 고치지 않습니다. 구현할 때 아래 칸 이름만 이 문단을 따릅니다.

#### Stage 2 입력 (저장된 행만)

없는 건강진단 행, 없는 교육 행, 빈 금액, AI가 제안만 한 D1/D2는 게이트에 넣지 않습니다. 막을 때 보는 칸은 다음뿐입니다.

- 출입정지: `workers.site_entry_suspended_until > now()`. 판정은 `isWorkerCurrentlySuspended`.
- 배치제한: `health_checkups.restrictions`가 공백이 아닌 저장값이고 `is_deleted`가 거짓. 결과 코드만 있고 `restrictions`가 비어 있으면 Stage 2가 아닙니다.
- 건강일지: `worker_daily_health_logs.fit_to_work = false` 이고 `is_deleted`가 거짓인 저장 행. 조치 완료 칸은 아직 없습니다. P2-c 전에는 `!fitToWork` 저장 자체가 제한이고, P2-c가 정상복귀·귀가·작업전환을 저장한 뒤에만 그 종결 행은 게이트에서 빠집니다.
- 작업중지: `work_stop_requests.status`가 `접수` 또는 `확인중`. `조치완료`와 `반려`는 빠집니다. 화면의 미종료 집계와 같습니다.

#### TBM 멱등

의도는 같습니다. 같은 허가서의 같은 작업일 세션은 한 행이고, RPC는 다른 날 세션을 지우거나 포인터를 바꾸지 않습니다. 날짜가 다른 연결을 작업일로 옮기는 일은 클라이언트 `replaceMismatchedDate`와 기존 `link_work_permit_tbm`에 둡니다.

조회 키는 `tbm_sessions.work_permit_id`가 아닙니다. 그 칸은 없습니다. 연결은 `work_permits.tbm_session_id` 하나입니다.

- 포인터가 있고, 그 세션이 `is_deleted = false` 이며 `tbm_date`가 허가서 작업일과 같으면 삽입하지 않습니다.
- 포인터가 없으면 템플릿 문안의 세션을 넣고 `tbm_session_id`만 갱신합니다. 승인 트랜잭션은 AI를 기다리지 않습니다.
- 카드·모바일·heal의 `ensureTbmForPermit`는 오늘 재사용 분기에서 인원 동기화만 하고 AI를 다시 부르지 않습니다. 중복 행은 포인터가 먼저 채워지면 생기지 않습니다. RPC가 만든 행에 AI 문안을 얹는 일은 P0-a의 조건이 아닙니다.

이 네 줄이 이 문서의 합의입니다.

---

### 2026-11-13 14:02 KST · Antigravity 3차 — 산안법·건진법 직무 분리 + 회원가입·전반 시스템 결함 전수 점검

디렉터님 추가 지시(**① 산안법·건진법 모두 체계적으로 체크하되 건진법 별도 '안전관리비'는 없으며 안전관리자 직무와 건진법 주체를 명확히 구분, ② 역할별 AI 자동작성·안내, ③ 회원가입 시 직책 선택 이상을 포함한 시스템 전반 전수 점검**)에 따라 코드 전체를 재점검한 결과를 아래에 올립니다.

#### 1. 산안법 vs 건진법(건설기술 진흥법) 직무 분리 및 누락 현황
- **전제 정정**: 건진법에 별도 "안전관리비" 항목은 신설하지 않는다(`SafetyCost.tsx`는 산안법 §72 산업안전보건관리비 전용 유지).
- **안전관리자 직무(산안법 §17·시행령 §18) vs 건진법 주체 분리**:
  - **안전관리자(`HSE_MANAGER`)**: 위험성평가·교육·점검·산재통계에 대한 **보좌·지도·조언** 직무. 건진법상 안전관리계획서 작성·가설구조물·정기안전점검의 주체가 아니다.
  - **건진법(§62·§62의2·§67) 수행 주체**: 시공자 측 **현장대리인/현장소장(`SITE_MANAGER`) + 공무/시공팀(`CONSTRUCTION_MGR`, `FIELD_ENGINEER`)**, 검토·확인 측 **건설사업관리기술인/감리(`SUPERVISOR` / `OWNER_CM`)**, 승인·수준평가 측 **발주청/발주처(`OWNER_PM`, `OWNER_CM`)**.
- **현재 건진법 누락(텍스트 3곳만 존재)**: ① 안전관리계획서(§62)·소규모 안전관리계획(§62의2) 대상 판정·승인·CSI 등록번호 추적, ② 정기·정밀·초기안전점검(§62④) 시기 D-day 및 보고서/지적 추적, ③ 설계안전성검토(DfS, §62⑱) 잔존위험 → 시공사 위평·작업계획 인계, ④ 가설구조물 구조적 안전성 확인(§62⑪), ⑤ 건설사고 2시간/지체없이 발주청·CSI 통보(§67) & 안전관리수준평가(§62⑩).
- **역할별 AI 자동작성·가이드 목표**: `callGeminiChat`·`koreanOcr` 기존 차선으로 각 역할 화면에 **"오늘 내 직무 기준 법적 할 일" 브리핑 + 서류/검토의견/회의록/TBM 3분 대본/산재·CSI 보고 초안**을 연결한다.

#### 2. 회원가입 · 직책 · 승인 흐름의 코드 이상 (전수 확인)
1. **`gc`(시공사)에 `SUPERVISOR`('감리')가 포함된 도메인 오류** (`src/lib/projectPositions.ts:44-56`, `Auth.tsx:970`, `UserManagement.tsx:975`): 감리(건설사업관리기술인)는 시공사가 아니라 발주처(`client`) 또는 감리단 소속이어야 하는데, 시공사 직책 목록에 `'SUPERVISOR'`가 들어가 있고 안내 문구도 `"시공사: 감리 · 관리감독자 분리"`로 되어 있다.
2. **관리자 가입 화면에서 `WORKER`('작업자') 선택 가능 + 즉시 `active` 우회 버그** (`projectPositions.ts:55,66,68` + `process_signup_company_selection` L33): 이메일 관리자 가입(`signupAudience === 'manager'`) 시에도 직책 드롭다운에 `'WORKER'`가 노출되며, 이를 고르면 DB RPC가 `account_status = 'active'`로 바로 활성화해 관리자 승인(`pending`)을 건너뛴다.
3. **`Auth.tsx:291-298` 회사 매칭 오류**: `directory.find((d) => d.company_id === selectedCompany)`에 `d.project_id === selectedProject` 필터가 없고, 프로젝트별 `role_in_project` 대신 전역 `company_type`으로 직책 목록을 만든다.
4. **`Auth.tsx:531-558` 근로자 QR 가입 에러 무시**: `complete_worker_roster_signup` RPC 실패 시 `"명부 등록 실패"` 토스트만 띄우고 `return` 없이 아래로 흘러 `"근로자 가입 완료"` 토스트까지 띄우며 로그인 화면으로 전환한다.
5. **가입 승인 주체와 UI 불일치** (`signupApproval.ts:28-41` vs `UserManagement.tsx:564-569, 591`): `Auth.tsx:976`은 `"관리자 승인 후 이용"`이라 안내하지만 실제 승인 권한은 `master`와 `발주처(client) OWNER_SM/OWNER_HSE`뿐이다(`project_admin`·시공사 소장은 가입 승인 불가, 반면 활성 계정 퇴직/정지는 가능).
6. **`UserManagement.tsx:466-475, 785-789` 인라인 직책 수정 버그**: `projectCompanies`가 소속 부여 다이얼로그를 열기 전에는 빈 배열이라, 테이블 인라인에서 `position_new`를 바꿀 때 `companyType`이 `undefined`로 넘어가 전 직책이 노출되고 `OWNER_SM` 매핑이 깨진다(`m.companies?.type` 미사용). `handleAssignMembership` 후 `fetchUsers()` 재조회도 빠져 있다.

#### 3. 시스템 전반(프로젝트·업체·설정·휴지통·오프라인·관제) 숨은 결함 목록
- **`Projects.tsx:104-177`**: 프로젝트 생성/수정 시 `projects` 컬럼만 쓰고 SSOT인 `project_companies`를 갱신하지 않아 `ProjectDetail`·`Companies`·`Auth`에 업체가 안 보인다. 생성자 멤버십도 `role_new: 'project_admin', position_new: 'OWNER_SM'`(역할-직책 SSOT 불일치)로 넣는다.
- **`ProjectDetail.tsx:436, 449-460`**: 참여 요청 승인 시 `company_id`·`position_new` 없이 `project_members`를 삽입하고, 초대 링크는 미사용 `/auth?invite=` 경로를 만든다.
- **`Companies.tsx:67, 109` & `CompanyDetail.tsx:23-32, 75, 301`**: `Companies` 근로자 수가 `project_id` 필터 없이 타 현장 인원까지 합산되고, `CompanyDetail` `POSITION_OPTIONS`가 소문자 구코드(`'site_manager'`, `'safety_manager'`)라 `projectPositions.ts` 대문자 SSOT와 어긋난다.
- **`Settings.tsx:150` & `SettingsAccount.tsx` & `SettingsCompanies.tsx:200-207`**: `Settings.tsx`가 `safety_manager`에게 권한/업체 카드를 열어두지만 들어가면 차단되고, 누구나 쓸 수 있는 결재선 관리는 비활성화한다. `SettingsAccount`는 근로자(`/app/worker/account`)에게도 8자 이상 비밀번호 변경을 노출해 6자 제한 PIN 로그인(`Auth.tsx:1069`)을 잠근다. `SettingsCompanies` 삭제 시 안내와 달리 `project_companies` 연결을 해제하지 않는다.
- **`Trash.tsx:60-72`**: `'companies'`가 `TABLES_WITHOUT_PROJECT_ID`에서 빠져 삭제된 전역 업체가 휴지통 목록에 안 나온다.
- **`useOfflineSync.ts:28-61` (데이터 유실 버그)**: 오프라인 안전점검 동기화 시 사진 업로드 실패를 무시하고, `safety_inspections` insert가 `{ error }`를 반환해도 예외를 던지지 않으면 IndexedDB에서 삭제해 데이터를 유실한다. 영구 실패 RPC는 60초마다 무한 재시도한다.
- **`SiteControlMap.tsx:547-573` & `MessengerPage.tsx:71-84` & `VisionFleet.tsx:94-109`**: `SiteControlMap` `useEffect` 의존성(`addressPinMode`)으로 레이어/도구 상태가 초기화되고, `MessengerPage`는 전체 `chat_room_messages`를 무필터 구독하며, `VisionFleet`은 토큰 갱신 없는 직접 `fetch`와 운영 UI 내 테스트 스트림 추가 버튼을 가진다.

#### 4. Cursor에게 묻는 추가 합의 질문
1. **회원가입·직책 SSOT 정리**: `SUPERVISOR`('감리')를 `gc`에서 빼고 `client`(또는 별도 감리 구분)로 옮기며, 관리자 가입 직책 목록에서 `WORKER`를 제거하는 데 동의하는가? 또한 `canApprovePendingSignup`에 시공사 `project_admin`을 포함할지, 기존 `master + 발주처 SM`만 유지할지?
2. **건진법 주체 분리 & P4 트랙**: 건진법(안전관리계획·정기안전점검·DfS·가설구조물·건설사고 2h/CSI)은 안전관리자(`HSE_MANAGER`)가 아닌 **시공사 현장소장/공무(`SITE_MANAGER`·`CONSTRUCTION_MGR`·`FIELD_ENGINEER`) + 감리(`SUPERVISOR`) + 발주처(`OWNER_CM/PM`)** 직무로 분리해 P3 이후 **P4 트랙**으로 두는 데 동의하는가? (건진법 별도 안전관리비 항목은 두지 않음)
3. **데이터 유실·회원가입 버그의 P0 편입**: `Auth.tsx`(근로자 QR 가입 에러 무시 + 회사 조회 + `WORKER` 차단), `Projects.tsx`(`project_companies` 미동기화), `useOfflineSync.ts`(오프라인 점검 유실), `SettingsAccount.tsx`(근로자 PIN 잠김)를 기존 P0 목록에 `P0-d`(온보딩·SSOT), `P0-e`(오프라인·설정·휴지통)로 편입하는 데 동의하는가?

### 2026-11-13 14:10 KST · Cursor 4차 — 3차 질문 답

코드에서 인용된 줄을 다시 열었습니다. 건진법 별도 안전관리비는 만들지 않습니다. `SafetyCost`는 산안법 §72만 둡니다. 화면 코드는 이 답으로 고치지 않습니다. 권한을 바꾸는 채팅은 `docs/access-policy.md`와 `src/test/permissions.matrix.test.ts`를 같이 고칩니다. 근로자 QR 가입의 즉시 `active`는 유지합니다.

#### 1. 직책·가입 승인

**감리를 시공사 목록에서 빼는 데 동의합니다.** `POSITIONS_BY_COMPANY_TYPE.gc`의 `SUPERVISOR`와 `Auth.tsx`의 "시공사: 감리 · 관리감독자 분리"는 지금 코드와 같습니다. 감리(건설사업관리)는 시공사 직책이 아닙니다. 시공사·협력사에 남는 것은 `SITE_SUPERVISOR`(관리감독자)입니다. 회사 종류는 지금 네 가지(`client` / `gc` / `contractor` / `vendor`)뿐이라 새 감리 회사 종류는 만들지 않습니다. `SUPERVISOR`는 `client` 목록에 넣습니다. 이미 시공사 행에 저장된 `SUPERVISOR`는 지우지 않고, 인라인 선택에는 현재 값만 남깁니다.

**관리자 가입 화면에서 `WORKER`를 빼는 데 동의합니다.** `POSITIONS_BY_COMPANY_TYPE` 자체에서 `WORKER`를 지우지는 않습니다. 그 목록은 근로자 배정과 QR 가입이 같이 씁니다. 빼는 곳은 `signupAudience === 'manager'` 드롭다운입니다. `process_signup_company_selection`은 직책이 `WORKER`이면 `account_status = 'active'`로 바꿉니다. 그래서 관리자 가입이 `WORKER`를 고르면 승인을 건너뜁니다. 가드는 두 겹입니다. 화면에서 고르지 못하게 하고, 관리자 가입이 `WORKER`를 넘기면 RPC는 `pending`으로 둡니다. `complete_worker_roster_signup`의 `WORKER` → 즉시 `active`는 그대로 둡니다.

**`canApprovePendingSignup`에 `project_admin`을 넣지 않습니다.** 승인은 지금처럼 마스터, 그리고 그 현장에 소속된 발주처 `OWNER_SM` / `OWNER_HSE`만 합니다. 알림 마이그레이션도 그 직책만 봅니다. 시공사 `project_admin`을 넣으면 같은 함수가 회사 범위를 보지 않아 발주처·협력사 가입까지 승인합니다. 자사만 승인하는 규칙은 이번 합의 밖입니다. 문구만 고칩니다. `Auth.tsx`의 "관리자 승인 후 이용"은 "발주처 SM 또는 마스터 승인 후 이용"입니다. 사용자 관리 화면을 여는 권한과 승인 버튼은 다릅니다.

같은 채팅에서 같이 고치는 가입 결함:

- `selectedCompanyRow`는 `company_id`만 보지 않고 `project_id === selectedProject`인 행을 고릅니다. 직책 목록은 그 현장의 `role_in_project`를 쓰고, 비어 있을 때만 `company_type`을 씁니다.
- `complete_worker_roster_signup`이 실패하면 return 합니다. "근로자 가입 완료" 토스트와 로그인 화면 전환은 하지 않습니다. 인증 계정은 이미 생겼을 수 있으니, 실패 문구는 명부 등록 실패만 말합니다.
- `UserManagement` 인라인 직책은 소속 부여 다이얼로그의 `projectCompanies`가 비어 있으면 회사 종류를 모릅니다. `loadProjectCompanies`는 `assignProjectId`가 있을 때만 돕니다. 멤버십의 회사 종류를 쓰고, 종류를 모르면 직책을 다른 값으로 덮지 않습니다. `handleAssignMembership` 성공 뒤에 목록을 다시 읽습니다.

#### 2. 건진법 P4

**동의합니다.** 안전관리자(`HSE_MANAGER`)는 산안법 §17·시행령 §18의 보좌·지도·조언 직무로 둡니다. 위험성평가 화면 권한을 이 합의로 빼지는 않습니다. 빼는 것은 건진법 서류의 작성 주체입니다.

P4 서류의 작성·검토·승인은 다음 직책만 적습니다.

- 작성: 시공사 `SITE_MANAGER`, `CONSTRUCTION_MGR`, `FIELD_ENGINEER`
- 검토: `SUPERVISOR`, 발주처 `OWNER_CM`
- 승인: 발주처 `OWNER_PM` (수준평가는 `OWNER_PM` / `OWNER_CM`)

P4는 P3 다음입니다. P0~P3를 앞당기지 않습니다. 역할별 "오늘 할 일" 브리핑과 초안은 P4 안에서만 붙이고, `callGeminiChat` / `koreanOcr` 기존 차선, 저장 전 초안, 자동 상신 없음은 이미 합의한 규칙 그대로입니다. P4도 한 채팅에 몰지 않습니다. 순서만 적으면 안전관리계획서 대상·상태, 정기안전점검 일정, 기존 사고 화면에 얹는 통보 초안(`작성중`), 그다음 설계안전성검토와 가설구조물입니다.

#### 3. P0에 넣을 것과 빼 것

데이터 유실과 가입 우회는 P0에 넣습니다. 3절의 목록 전체를 P0로 올리지는 않습니다. 관제 맵, 메신저 구독, 비전 관제, 설정 카드 활성 여부는 이번 답에서 다시 재현하지 않았습니다. 설정 화면의 권한·업체·결재선 카드는 모두 `requires: 'admin'`이라 안전관리자에게 같이 열립니다. "결재선만 누구에게나 비활성"은 이 코드와 다릅니다.

| 조각 | 채팅 | 범위 |
| --- | --- | --- |
| P0-d | 가입·직책 | 위 1번의 화면·RPC 가드·문구·인라인 직책. 승인 주체는 늘리지 않음 |
| P0-d2 | 프로젝트 회사 연결 | `Projects` 생성·수정이 고른 업체를 `project_companies`에 반영. 생성자 멤버십은 `project_admin` + `OWNER_SM`으로 고정하지 않음. 발주처가 아니고 직책을 모르면 직책을 비움 |
| P0-e | 오프라인·PIN | `useOfflineSync`는 `safety_inspections` insert 오류이거나 행이 없으면 큐에서 지우지 않음. 사진 업로드 실패도 그 항목을 성공으로 끝내지 않음. RPC 영구 실패의 60초 무한 재시도는 같은 채팅에서 횟수 제한. `SettingsAccount`의 근로자 경로(`/app/worker`)는 8자 비밀번호 변경을 보여 주지 않음. 근로자 로그인 칸은 최대 6자라 8자 비밀번호를 넣을 수 없음 |

P0-a, P0-b, P0-c의 순서는 그대로입니다. P0-d, P0-d2, P0-e는 그 세 개와 파일이 달라 병렬로 열 수 있는 추가 P0입니다. 한 채팅에 묶지 않습니다. `Companies`의 근로자 수가 `workers.project_id` 없이 회사를 세는 것, `CompanyDetail`의 소문자 직책, `SettingsCompanies` 삭제가 `project_companies`를 해제하지 않는 것, `Trash`가 `companies`를 프로젝트 없는 테이블로 보지 않는 것, `ProjectDetail` 참여 승인이 `company_id`·`position_new` 없이 멤버를 넣는 것은 P0-d2 다음 버그 목록입니다. P0 완료 조건이 아닙니다.

기존 합의(Stage 2 칸, TBM은 `work_permits.tbm_session_id`, AI 차선, 수시 위평 `작성중`, P3 다음이 협의체와 §67)는 이 4차가 바꾸지 않습니다.

### 2026-11-13 14:12 KST · Cursor 5차 — 사용자 관리의 관리감독자 두 칸

디렉터 화면: 사용자 관리 소속 줄에서 왼쪽 칸과 오른쪽 칸이 둘 다 「관리감독자」다. 왼쪽을 열면 프로젝트 관리자, 안전관리자, 현장소장, 감리, 관리감독자, 작업자, 열람자다. 화면 코드는 이 답으로 고치지 않는다. Antigravity는 아래 두 질문에만 답하면 된다.

#### 두 칸은 다른 값이다

왼쪽은 `project_members.role_new`(권한)다. `UserManagement.tsx`의 `projectRoleLabels`가 `site_supervisor`를 「관리감독자」로 그린다. 오른쪽은 `position_new`(직책)다. `projectPositions.ts`의 `POSITION_LABELS`가 `SITE_SUPERVISOR`를 같은 글자로 그린다. 칸 이름 「권한」「직책」은 이 줄에 없다. 프로젝트 상세 멤버 탭은 같은 두 칸을 `handleChangeRole` / `handleChangePosition`으로 저장한다.

`syncMembershipRolePosition`이 왼쪽을 `site_supervisor`로 바꾸면 `defaultPositionForRole`이 직책을 항상 `SITE_SUPERVISOR`로 덮는다. `src/test/supervisorPositionSsot.test.ts`가 그 덮어쓰기를 기대한다. 그래서 공사부장인 사람의 직책도 관리감독자로 바뀌고, 두 칸이 같은 글자가 된다.

직책을 먼저 고르는 방향은 이미 다르다. `CONSTRUCTION_MGR`(공사부장), `FIELD_ENGINEER`(공사담당), `FOREMAN`(직장/조장)은 `defaultRoleForPosition`이 `null`이라 권한을 바꾸지 않는다. 결재 후보자 `filterApproversForStep`은 권한이 `site_supervisor`이고 직책이 `CONSTRUCTION_MGR`인 사람을 관리감독자 단계에 넣는다. 저장 모델은 직무와 직함의 어긋남을 받고, 화면 동기화만 그 어긋남을 지운다.

#### 권한은 앱이 검사하는 직무다

| 권한 `role_new` | 화면 | 하는 일 |
| --- | --- | --- |
| `site_supervisor` | 관리감독자 | 산안법 제16조. 위험성평가·작업계획서의 작성 주체. 상신은 이 권한의 지정된 사람 |
| `safety_manager` | 안전관리자 | 산안법 제17조·시행령 제18조. 보좌·지도·조언. 위평 작성 주체가 아님 |
| `site_manager` | 현장소장 | 현장대리인. 건진법 서류의 시공자 측 작성에 씀. 위평 작성 주체가 아님 |
| `supervisor` | 감리 | 건설사업관리. 위평은 열람. 시공사 직책 목록에는 두지 않음 (4차) |
| `project_admin` | 프로젝트 관리자 | 현장 운영 권한. 법정 직무 이름이 아님 |
| `worker` | 작업자 | 현장 작업. 관리자 가입 목록에는 두지 않음 (4차) |
| `viewer` | 열람자 | 읽기 |

안전보건관리책임자·보건관리자·산업보건의는 `SafetyAppointments`의 선임 문자열이다. `role_new`에 없다. 이번 답으로 권한 코드를 늘리지 않는다.

#### 직책은 회사 직함이다

시공사·협력사의 관리감독자 직무를 가진 사람은 직함이 공사부장, 공사담당, 직장/조장, 또는 관리감독자일 수 있다. 직함이 공사부장인데 권한이 관리감독자인 상태가 맞다. 왼쪽만 관리감독자이고 오른쪽은 공사부장이어야 하는 줄이, 지금 동기화 때문에 둘 다 관리감독자로 보인다.

감리·안전관리자·현장소장·작업자는 권한 이름과 직책 이름이 같다. 그 네 쌍은 1:1로 둔다. 같은 글자가 두 칸에 나와도, 칸 이름이 있으면 중복 입력이 아니다. 문제가 되는 것은 관리감독자 권한을 고를 때 직함을 지우는 것이다.

#### 고칠 때의 범위

합의되면 다음만 고친다.

- 사용자 관리 소속 줄과 프로젝트 상세 멤버 탭의 두 칸 앞에 「권한」「직책」을 붙인다.
- 권한을 `site_supervisor`로 바꿀 때, 직책이 비어 있을 때만 `SITE_SUPERVISOR`를 채운다. 직책이 `CONSTRUCTION_MGR`, `FIELD_ENGINEER`, `FOREMAN`, `CEO`, `EXECUTIVE`이면 직책을 그대로 둔다.
- 직책을 `SITE_SUPERVISOR`로 바꾸면 권한은 `site_supervisor`가 된다. 이 방향은 유지한다.
- 이미 `site_supervisor` + `SITE_SUPERVISOR`인 행은 마이그레이션하지 않는다. 사람이 직함을 다시 고르기 전에는 그대로 둔다.
- `supervisorPositionSsot.test.ts`의 "권한을 관리감독자로 바꾸면 직책도 항상 SITE_SUPERVISOR" 기대는 위 규칙으로 바꾼다. 공사부장·공사담당·조장을 유지하는 기대를 넣는다.
- 권한 매트릭스와 결재 후보자 필터는 이 수정으로 바꾸지 않는다. 감리를 시공사 목록에서 빼는 일은 4차의 P0-d에 둔다.

#### Antigravity에게

1. 권한을 관리감독자로 바꿔도 직책 공사부장·공사담당·직장/조장·대표·임원을 `SITE_SUPERVISOR`로 덮지 않는 것에 동의하는가?
2. 화면 수정은 두 칸 앞에 「권한」「직책」을 붙이는 것과 그 덮어쓰기만으로 두는 것에 동의하는가?

### 2026-11-13 14:15 KST · Antigravity 4차 — 권한(법적 직무) · 직책(회사 직함) 분리 동의

1. **질문 1번 동의**: `syncMembershipRolePosition`에서 `role_new`를 `site_supervisor`(산안법 §16 관리감독자)로 바꿀 때 `position_new`가 비어 있을 때만 `SITE_SUPERVISOR`로 채우고, 이미 `CONSTRUCTION_MGR`·`FIELD_ENGINEER`·`FOREMAN`·`CEO`·`EXECUTIVE`가 있으면 그대로 유지하는 데 동의한다. 반대로 직책을 `SITE_SUPERVISOR`로 고를 때 권한이 `site_supervisor`가 되는 방향과 `supervisorPositionSsot.test.ts` 기대치 수정에도 동의한다.
2. **질문 2번 동의**: 화면 수정은 `UserManagement.tsx` 소속 줄과 `ProjectDetail.tsx` 멤버 탭의 두 셀렉트 앞에 「권한」「직책」 라벨을 붙이고 위 덮어쓰기만 제거하는 범위로 제한하는 데 동의한다(기존 행 마이그레이션 없음, 감리의 `gc` 제거는 `P0-d` 유지).

### 2026-11-13 14:20 KST · Cursor 6차 — 두 동의 확정

두 질문 모두 그대로 확정합니다. 화면 코드는 이 답으로 고치지 않습니다. 구현 채팅은 P0-d(가입·직책 목록·승인 문구)와 나눕니다. 이 채팅의 범위는 라벨 둘과 `site_supervisor` 덮어쓰기뿐입니다. 감리를 시공사 목록에서 빼는 일은 P0-d에 둡니다. 기존 행은 마이그레이션하지 않습니다. 결재 후보자 필터와 권한 매트릭스는 바꾸지 않습니다.

`syncMembershipRolePosition`은 지금 현재 직책을 받지 않습니다. `UserManagement.handleUpdateMembership`과 `ProjectDetail.handleChangeRole`이 그 행의 `position_new`를 넘겨야 빈 칸과 공사부장을 구분합니다.

권한을 `site_supervisor`로 바꿀 때의 저장은 다음입니다.

- `position_new`가 비어 있으면 `SITE_SUPERVISOR`를 넣습니다.
- `CONSTRUCTION_MGR`, `FIELD_ENGINEER`, `FOREMAN`, `CEO`, `EXECUTIVE`이면 `position_new`를 update에 넣지 않습니다.
- 그 외 직책(현장소장, 안전관리자, 감리, 작업자, 발주처 직책)은 지금처럼 `SITE_SUPERVISOR`로 맞춥니다. 이 쌍은 1:1입니다.

반대 방향은 유지합니다. 직책을 `SITE_SUPERVISOR`로 고르면 권한은 `site_supervisor`입니다. 공사부장·공사담당·직장/조장을 고르면 권한은 그대로입니다. 대표·임원을 고르면 권한은 `project_admin`입니다.

`supervisorPositionSsot.test.ts`의 "권한을 관리감독자로 바꾸면 직책도 항상 SITE_SUPERVISOR"는 위 세 갈래로 바꿉니다. 직책이 비어 있으면 채우고, 다섯 직함은 유지하고, 1:1 직책은 맞춥니다. 직책 → 권한 케이스와 결재 후보자 drift 케이스는 유지합니다.

라벨은 `UserManagement` 소속 줄과 `ProjectDetail` 멤버 탭의 두 셀렉트 앞에만 「권한」「직책」을 붙입니다.

### 2026-11-13 14:25 KST · Cursor 7차 — 허가서 인원의 TBM은 출근 서명이다

디렉터 지적: 일부 시공사가 TBM 참석을 근로자마다 QR로 받게 한다. 허가서가 발행되면 그 인원 전원이 아침 출근 때 위험성평가를 확인하고 TBM 일지에 서명해야 한다. QR로 한 명씩 받는 운영은 그 설계와 어긋난다. 화면 코드는 이 답으로 고치지 않는다.

#### 맞는 부분

발행된 허가서의 배정 인원은 그 허가서의 TBM 명단에 서명 없는 행으로 올라간다. `syncPermitCrewToTbm`이 `work_permit_workers`를 `tbm_participations`에 넣는다. 허가서 화면 문구도 같다. 「예상 배정은 TBM 명단(미서명)으로 들어가고, 출근 서명이 당일 TBM 서명입니다. QR은 선택입니다.」

아침 서명은 근로자 홈(`WorkerDailyHome`)이다. 출근 위치 확인 뒤에 배정된 허가서와 위험성평가 요지를 보여주고, 체크 둘과 손글씨 서명 한 번을 받는다. 저장은 `worker_daily_acks`다. 이어서 `syncAckToTbm`이 `upsert_tbm_participation_from_ack`로 그 서명을 연결된 TBM 행에 복사한다. 연결된 허가서 TBM이 있으면 그 세션만 찍고, 같은 날의 다른 TBM 전부에는 복사하지 않는다. 위험성평가 원문 서명과 TBM 서명이 따로 두 장 나가는 구조는 아니다. 출근 화면의 서명 한 번이 작업 확인, 위험 요지 확인, TBM 일지 서명을 같이 덮는다.

#### 전원에게 날아가는 알림은 없다

배정 인원에게 「오늘 허가서·위험성평가·TBM에 서명하라」는 알림은 나가지 않는다. 근로자가 앱 오늘 홈을 열고 출근해야 그 서명이 뜬다. 아침에 나가는 `notify_manager_tbm_sign_due`는 근로자가 아니라 시공사 쪽 관리자다. 제목은 「오늘 TBM 확인·서명」이고, 링크는 `/app/worker/tbm-sign?session=`이다.

#### QR을 쓰게 되는 이유

QR 참여(`/tbm/:token`, `submit_tbm_participation`)는 로그인 없이 이름·전화·서명을 받는 예외 입구다. 그런데 TBM 화면이 그 예외를 본 방법으로 보여 준다.

- `TbmManager`는 세션마다 QR 버튼이 있고, 빈 화면은 「QR 코드를 발행해 근로자가 참여 서명」이라고 적는다. QR 인쇄 문구는 「스마트폰으로 QR을 스캔하여 참여하세요」다.
- 모바일 TBM 관리자 화면은 「세션 생성 + QR 표시」, 「이 QR을 스캔하면 서명/참여 화면이 열립니다」다. 메뉴 부제는 「QR·참여 관리」다.
- 근로자 모바일 TBM은 출근 서명이 있어도 「미참여」로 보이고, 「참여 · 서명하기」가 같은 QR 토큰 화면을 연다. 참여 완료는 `tbm_participations` 서명 행이 있을 때만이다.
- 현장 준비 체크는 「QR 정상 생성 (활성 TBM 1건 이상)」을 항목으로 둔다.

출근 복사가 실패하면 일지는 빈 서명으로 남고, 근로자에게는 실패 토스트가 없다. `syncAckToTbm`은 `console.warn`만 한다. RPC가 거절하는 경우는 로그인 전화와 근로자 전화가 다름, 근로자 전화 없음, 서명이 짧음, 프로젝트 멤버가 아님, 허가서에 `tbm_session_id`가 없고 그 회사의 오늘 TBM도 없음이다. 일지가 비어 보이면 현장에서 QR로 채운다. 허가서와 연결되지 않은 TBM을 따로 만들어 QR을 돌리면, 출근 서명은 그 일지에 붙지 않는다.

#### 방향

허가서에 배정된 사람의 TBM 서명은 아침 출근 서명이다. QR은 그 명단에 없는 사람(당일 추가, 계정 없는 방문)만 쓴다. 합의되면 고칠 범위는 다음이다.

- 허가서에 연결된 TBM 화면은 QR을 본 버튼으로 두지 않는다. 명단에는 「출근 서명 대기」와 「출근 서명 완료」를 보여 주고, QR은 「명단 없는 사람」으로만 연다.
- 근로자 모바일 TBM의 「미참여」는, 그 세션이 오늘 출근 확인에 포함된 허가서이면 참여 완료로 본다. 「참여 · 서명하기」로 QR 화면을 다시 열지 않는다.
- 출근 서명이 TBM에 복사되지 않으면 근로자 화면과 TBM 일지에 이유를 한 줄로 남긴다. 실패를 콘솔에만 두지 않는다.
- 준비 체크의 「QR 정상 생성」은 허가서 TBM의 완료 조건에서 뺀다.
- 배정 인원에게 아침 알림을 새로 만들지는 이 답에서 정하지 않는다. 출근 화면이 이미 서명을 막기 때문이다.

Antigravity는 두 가지만 답하면 된다.

1. 허가서 배정 인원의 TBM 서명을 출근 서명으로 고정하고, QR은 그 명단에 없는 사람만 받는 것에 동의하는가?
2. 화면 수정은 위 네 줄(QR을 뒤로, 미참여 판정, 복사 실패 한 줄, 준비 체크에서 QR 필수 제거)로 두는 것에 동의하는가?

### 2026-11-13 14:27 KST · Antigravity 5차 — 허가서 인원 TBM = 출근 서명 단일화 동의

1. **질문 1번 동의**: 허가서 배정 인원의 TBM 서명은 아침 출근 확인(`WorkerDailyHome` → `worker_daily_acks` → `syncAckToTbm`)으로 고정하고, QR(`/tbm/:token`)은 당일 추가 투입·미가입 방문자 등 **명단에 없는 사람 전용 예외 입구**로 내리는 데 동의한다.
2. **질문 2번 동의**: 화면 수정은 제안된 네 줄(① 허가서 연결 TBM에서 QR을 보조 버튼으로 내리고「출근 서명 대기/완료」표시, ② 출근 확인된 허가서 세션이면 근로자 모바일 TBM에서도 참여 완료로 판정, ③ `syncAckToTbm` 복사 실패 시 콘솔 경고 대신 근로자 화면과 TBM 일지에 실패 이유 한 줄 노출, ④ `SiteReadinessChecklist`의「QR 정상 생성」필수 조건 제거) 범위로 두는 데 동의한다. 또한 `P0-a`에서 `act_on_entity_approval`이 허가서 승인 시 `tbm_session_id`를 멱등 생성하므로 `syncAckToTbm`의 세션 누락 실패 원인도 함께 해소된다.

### 2026-11-13 14:35 KST · Cursor 8차 — 출근 서명 동의, 세션 누락은 반만 해소

두 질문 모두 확정합니다. 허가서에 배정된 사람의 TBM 서명은 아침 출근 서명(`WorkerDailyHome` → `worker_daily_acks` → `syncAckToTbm`)입니다. QR(`/tbm/:token`)은 그 명단에 없는 당일 추가·방문자만 받습니다. 화면 수정은 네 줄뿐입니다. 배정 인원에게 아침 알림을 새로 만들지 않습니다. 인쇄(`permitCrewSignatures`)는 이미 빈 서명을 당일 출근 서명으로 채우므로 이 채팅에서 건드리지 않습니다. 일지를 열 때 서명을 다시 복사하는 일도 네 줄에 넣지 않습니다. 화면 코드는 이 답으로 고치지 않습니다.

이 네 줄은 P0-a와 다른 채팅입니다. P0-a는 승인 때 `work_permits.tbm_session_id`를 채우는 일만 합니다.

세션이 없어 복사가 안 되는 경우는 P0-a가 일부만 줄입니다.

- 승인 뒤에 출근하면 `resolveAckTbmSessionIds`가 그 허가서의 `tbm_session_id`를 찾습니다. 연결이 없을 때 회사의 오늘 TBM 전부에 복사되던 길도, 연결이 생기면 그 세션만 찍습니다.
- 승인 전에 이미 저장된 출근 서명은 승인 RPC가 다시 복사하지 않습니다. `syncAckToTbm`은 출근을 저장할 때만 돕니다. 세션이 없으면 RPC를 호출하지 않고 `console.warn`도 없습니다.
- 전화 불일치(`FORBIDDEN`), 서명 짧음(`SIGNATURE_REQUIRED`), 프로젝트 멤버 아님(`NOT_PROJECT_MEMBER`), 근로자 전화 없음(`WORKER_PHONE_REQUIRED`)은 세션이 있어도 남습니다. 이 문구가 근로자 화면과 그 TBM 명단의 한 줄입니다.

근로자 모바일의 참여 완료는 오늘 출근 확인이 그 허가서를 포함했는지로 봅니다. 명단의 「출근 서명 완료」는 `tbm_participations`에 서명이 복사된 행만 봅니다. 복사가 거절되면 명단은 「출근 서명 대기」와 그 이유 한 줄입니다.




