# 계획: 시스템 내장 허가서 양식(Native Form) + 전회차 복제

## 배경

현재는 PDF 오버레이/엑셀 그리드로 사용자가 직접 양식을 올려야 해서 진입 장벽이 큽니다. 이 계획은 **Lovable가 자체 제작한 표준 React 양식**을 기본 옵션으로 제공하고, 기존 오버레이 방식은 "고급" 옵션으로 유지합니다. 여기에 **전회차 허가서 복제** 기능을 추가합니다.

## 원칙

- 3종(일반/밀폐/화기)을 **탭이 아닌 개별 라우트/서브뷰**로 완전히 분리 — 한 종류를 선택하면 그 종류의 필드만 렌더.
- 기존 아키텍처(`work_permits.form_data`, `signatures`, `approvals`, `approval_lines`) 그대로 사용. 스키마 변경 없음.
- 자동 채움(공사업체=작성자 회사, 프로젝트, 작성자) + 결재라인 자동 매핑(시공/안전/소장, CM/SM, 협조) 재사용.
- 태블릿/아이패드 우선. 카드 그룹, 큰 체크박스, 서명 패드는 `ResponsiveSignaturePad` 재사용.

## 사용자 흐름

1. 허가서 목록 → **"신규 작성"** 클릭 → 종류(일반/밀폐/화기) 선택 → 표준 양식 열림.
2. 상단 툴바에서 **"전회차 복제"** 버튼 → 같은 프로젝트·같은 종류·최근 허가서 목록 드로어 → 선택 시 필드/체크박스만 복사(서명·결재·문서번호는 초기화).
3. 저장/결재상신/인쇄는 기존 흐름 유지.
4. 마스터가 업로드한 커스텀 양식이 있으면 상세 화면 상단 드롭다운에서 "표준 양식" ↔ "커스텀 오버레이" 전환 가능.

## 산출물

### 1) 표준 양식 스키마 (코드 상수)

`src/lib/permitStandardForms.ts` 신설 — 3종 각각에 대해 필드/체크박스 그룹/가스 측정 컬럼/서명 슬롯을 선언형 JSON으로 정의. 필드 key는 기존 `form_data`와 호환.

```
GENERAL_PERMIT = { header:{...}, sections:[docs, safetyGrid, hazardous:{confined,hot,blackout,dig,radiation,height,heavy}, gas, completion] }
CONFINED_PERMIT = { header, applicant, overview, measures, gas, approvals }
HOT_WORK_PERMIT = { header, applicant, overview, measures, gas, approvals }
```

### 2) 렌더러 컴포넌트

- `src/components/permits/StandardPermitForm.tsx` — 스키마 기반 렌더러(카드/체크 그룹/입력/textarea/가스표/서명 슬롯). Props: `type`, `data`, `signatures`, `onChange`, `onSign`, `readOnly`, `autoCtx`.
- `src/components/permits/sections/*` — `CheckboxGroupCard`, `GasMeasurementTable`, `SignatureSlot`, `HazardChecklistCard` 분리(재사용/가독성).
- 기준값(O2 18~23.5%, CO<30ppm, H2S<10ppm, LEL<10%, CO2<1.5%)은 상수 테이블에서 read-only 표시.

### 3) 종류 선택 & 라우팅

- `WorkPermits.tsx` "신규 작성" 버튼 → 종류 선택 다이얼로그(3장 큰 카드) → 선택 후 `work_permits` insert(`permit_type` 저장) → `/work-permits/:id`로 이동.
- `WorkPermitDetail.tsx`: 
  - 상단 종류 탭 제거하고 **종류는 생성 시 확정**(변경 시 별도 "종류 변경" 액션으로 처리, 데이터 손실 경고).
  - 렌더 우선순위: `template && overlay 존재` → OverlayFillForm, 그 외 → **StandardPermitForm**(신규 기본).
  - 상단 드롭다운에 "표준 양식(기본)" 옵션 추가.

### 4) 전회차 복제 기능

- `src/components/permits/ClonePreviousPermitDialog.tsx` 신설.
- 쿼리: `work_permits`에서 `project_id`+`permit_type`+`is_deleted=false`, 승인완료 우선, 최근 20건.
- 선택 시 복사 규칙:
  - 복사: `form_data`, `permit_type`, `work_location`, `work_description`, 체크박스 상태
  - 초기화: `id`, `doc_no`(GEN-yyyymmdd-####로 재발급), `permit_date`(오늘), `signatures`, `approvals`/`approval_lines`, `status='draft'`, `linked_assessment_run_ids`
- `WorkPermitDetail.tsx` 툴바에 "전회차 복제" 버튼 배치(신규 작성 직후 및 draft 상태에서만 활성).

### 5) 자동 채움 & 결재 매핑

- 기존 `autoCtx`(회사/프로젝트/작성자)를 StandardPermitForm에 그대로 주입 → 헤더 "공사업체", "작성자" 자동 표기.
- 서명 슬롯 role 매핑: `contractor_pic`(담당자-시공), `safety_pic`(담당자-안전), `site_director`(소장), `cm`, `sm`, `cooperator`(협조, 선택). `approval_lines.role`↔슬롯 role 동일 키 사용 → 승인 시 자동 서명 이미지 오버레이(WorkPermitDetail 병합 로직 재사용).

### 6) 인쇄

- 표준 양식은 화면 그대로 `@media print` CSS로 A4 세로 인쇄(별도 PDF 오버레이 불필요).
- 인쇄 시 서명·결재자 이름·시간·위험성평가 링크 배지도 함께 출력.
- 인쇄 게이트(승인+당일+유효기간) 기존 로직 유지.

### 7) UX 세부

- 큰 히트영역(체크박스 24px), 카드 제목에 법적 근거 툴팁(예: 산안법 §619 밀폐공간).
- 필수/권장 표시. 미체크 필수 항목이 있으면 결재상신 차단 + 하이라이트.
- 가스 측정표: 화기/밀폐에서만 노출, 일반 양식은 체크박스로 활성화 시 노출.

## 기술 상세(개발자용)

- 상태: `form_data`는 flat JSON 유지, 그룹 키(prefix)로 네임스페이싱: `safety.msds`, `hazard.confined.gas_check`, `gas.rows[0].o2` 등.
- Zod 스키마(`src/lib/commonSchemas.ts`)에 3종 최소 필드 검증 추가.
- `permit_type` 변경 시 confirm + 새 양식 스키마로 재초기화(옛 값은 `form_data._legacy`에 백업).
- 스토어리스: 스키마-드리븐이라 필드 추가/삭제가 상수 파일 편집만으로 가능.

## 범위 밖(이번 계획에서 안 함)

- 오버레이/AI 분석 관련 로직 변경 없음(옵션으로 유지).
- 스키마/RLS 변경 없음.
- 결재 라인 자동 라우팅 규칙 변경 없음.

추가로 아래 내용은 각 폼에 내용이 들어가있어야해(체크박스 등등)

[Form Type 1: 일반 안전작업허가서 (General Permit)] ========================================= - Header: Doc No (GEN-000000-SF003), Project Name, 공사업체(Contractor), 검토일, 승인일. - Approval Line (Digital Signatures):  *공사업체 (Contractor): 담당자(시공), 담당자(안전), 책임자(소장)*  승인업체 (Air Liquide): 담당자(CM), 담당자(SM) - Work Overview: 작업일시 (Start/End Date & Time), 작업명, 작업내용, 작업지역(장소), 작업인원(Number). - Required Documents Checkboxes: 위험성평가, 안전작업점검표, TBM 일지, 중장비 서류, 작업계획서, 기타(Text). - Safety Measures Checkbox Grid (안전조치 요구사항):  *안전교육 이수, 보호구 착용 및 건강상태 확인, MSDS 비치*  작업구역 외 출입금지, 흡연장소 지정/정리정돈, 근로자 작업거부권 교육  *명판/표지 부착, 작업구역 설정(차량 출입제한), 용기 개방 전 압력 방출*  환기조치(창문/맨홀 개방, Fan설치), 작업 전 기계/기구 이상여부, 작업장 조도/조명  *전원스위치/밸브 차단, 용기 내부 세정/정리, 소화기 비치*  차단부위 잠금조치/표시, 불활성가스 치환/환기, 위험물질 방출/처리  *기타 (Text Input) - Hazardous Work Checklist:*  밀폐공간 (통신수단, 구명장비, 2인1조, 가스농도측정, 특별안전교육, 관리감독자, ALK점검표)  *화기 (불티방지포, ALK점검표, 화재감시자, 주변 가연성물질 제거)*  정전 (제어실 차단/시건, 현장 차단/시건, 방전/접지, 활선경보장치)  *굴착 (매설물 확인-가스/기계/소방, 설비-전기/통신)*  방사선 (비인가자 출입제한, 위험경고 표지, 자격증, 도면첨부)  *고소 (작업발판/안전난간, 안전대 2중고리, 추락방지망, 사다리 아웃트리거, 생명선)*  중장비 (투입장비 Text, 작업계획서, 등록증/검사증, 면허/보험증, 안전점검표, 유도자/신호수, 작업반경 통제, 기상/노면 상태, 전선/설비 간섭, 용걸이 상태) - Gas Measurement Table: Checkbox (화기작업 or 밀폐공간) / Columns: 측정물질(O2, CO2, H2S, CO), 농도, 측정시간, 측정자. - Completion & Extension: 작업 전 교육자 서명, 작업완료 확인 (시간, 감독자 서명, 승인자 서명), 허가 연장 (연장일시, 승인 담당자 서명). ========================================= [Form Type 2: 밀폐공간 작업허가서 (Confined Space Permit)] ========================================= - Header: 밀폐공간 작업허가서 (Doc No: GEN-000000-SF003) - Applicant Info: 소속(업체명), 성명 (Digital Signature). - Work Overview: 작업기간(Start/End Time), 작업장소, 작업구분(맨홀, 저장탱크, Cold Box, 기타), 작업개요(Textarea). - Confined Space Safety Measures (Checkboxes):  *밸브차단 및 표식, 맹판설치 및 표지, 가스농도 측정*  용기세척 후 공기 치환 및 환기, 산소농도 측정, 압력 방출  *정전/잠금 표지 부착, 감시인 배치, 환기장비*  조명장비, 소화기, 안전장구(구명선 등)  *안전교육, 기타 - Gas Measurement Table: Columns for H2S, CO, O2, H-C, CO2. Row 1: 측정결과 Input. Row 2: 기준값(Read-only). - Final Approvals (Digital Signatures): 안전관리자(서명/연락처), 관리감독자(서명/연락처), 현장당일 안전조치 확인(공사업체 성명/서명), 승인자(Date/Name/Signature). ========================================= [Form Type 3: 화기작업허가서 (Hot Work Permit)] ========================================= - Header: 화기작업허가서 (Doc No: GEN-000000-SF003) - Applicant Info: 소속(업체명), 성명 (Digital Signature). - Work Overview: 작업기간(Start/End Time), 작업장소, 작업구분(용접, 절단, 기타), 작업개요(Textarea). - Hot Work Safety Measures (Checkboxes):*  가연물 이동(11m 이상) 및 보호조치, 작업종료 후 30분 이상 관찰  *소화기구 비치, 가스 농도 측정(필요시)*  불티비산 방지포 설치, 작업구역 통풍 및 환기  *화기작업 안전교육 실시, 역화방지기 설치*  화재감시자 지정(타 업무 불가), 용접기/호스 외 점검 - Gas Measurement Table: Columns for H2S, CO, O2, H-C, CO2. Row 1: 측정결과 Input. Row 2: 기준값(Read-only). - Final Approvals (Digital Signatures): 안전관리자(서명/연락처), 관리감독자(서명/연락처), 현장당일 안전조치 확인(공사업체 성명/서명), 승인자(Date/Name/Signature).