## 문제 진단

첨부 두 이미지를 비교해 원인 확인:

1. **폭이 늘어짐** — 미리보기는 A4(210mm) 컨테이너 안에서 렌더되지만, 허가서 작성 화면(`WorkPermitDetail.tsx` 413줄)은 폼을 `p-3 md:p-6` 전체폭 카드에 감싸서 렌더 → `table-layout: fixed` + `colgroup` 픽셀 너비를 쓰는 데스크톱에서 남는 공간이 뒷 열로 쏠려 "공사업체" 값 셀, 승인업체 셀이 비정상적으로 넓어짐.
2. **작업일시/일부 텍스트 미입력**
  - `DigPermitForm.tsx` 525줄 `작업허가 연장` `<input type="datetime-local">` 에 `value`/`onChange` 바인딩이 아예 없어 입력해도 반영 안 됨.
  - 512줄 `작업완료 확인 (시 분)` 은 그냥 텍스트 라벨 뿐 입력칸이 없음.
  - `PermitInput` 은 `onBlur/compositionEnd` 에만 commit → 한글 외 일반 입력은 되지만 blur 안 하고 저장 버튼 클릭 시 최신값이 안 올라감(포커스 유지 상태에서 저장 시 손실).
3. **서명 자동 표기 미흡** — 결재라인이 `approved` 여도 `signature_image` 가 비면 SigCell 은 "서명" 버튼만 표시. 이름/승인시각 텍스트 폴백이 없음. 또한 첫 결재 요청이 `POSITION_TO_SIG` 매핑에만 의존해 신규 `approval_lines.role` 이 SF003 슬롯키(`contractor_pic`, `cm`, `safety_pic`, `sm`, `site_director`)와 다르면 자동 매핑 실패.
4. **검토일/승인일** — 355~357줄이 `signatures.reviewed_at` / `signatures.approved_at` 를 참조하지만 `reviewed_at` 을 세팅하는 코드가 없어 항상 빈칸. 사용자 요구: 검토일 = 승인일 - 1일, 승인일 = 결재 최종 승인 일자.

## 수정 계획

### A. 폭 정렬 (`src/pages/WorkPermitDetail.tsx`)

- 413줄 렌더 컨테이너를 A4 상당(`max-w-[210mm] mx-auto`) 로 래핑해서 미리보기와 동일한 폭에서 렌더. 오버레이 폼(`OverlayFillForm`) 은 기존대로 유지.

### B. 입력 결함 (`src/components/permits/DigPermitForm.tsx`)

- 525줄 "작업허가 연장" datetime-local 에 `value={data.work_extend_until}` / `onChange` 바인딩 추가 (`PermitFormData` 에 `work_extend_until?: string` 필드 추가).
- 512줄 "작업완료 확인" 라벨을 `<Inp value={data.work_complete_time}/>` 로 교체 (필드 추가).
- 379~384줄 `작업일시` 컨테이너 스타일 축소 조정 — datetime-local input 이 좁은 셀에서 잘리는 문제 완화 (`w-[48%]` 지정).
- `PermitInput` 에 실시간 반영을 위해 `onChange` 에서 `!composingRef.current` 일 때 즉시 `onCommit(v)` 도 호출 (한글 IME 는 여전히 compositionEnd 로만 commit). 저장 시 손실 방지.

### C. 서명/결재 자동 표시 (`src/pages/WorkPermitDetail.tsx` + `DigPermitForm.tsx`)

- WorkPermitDetail `load()` 의 `approval_lines` 병합부에 role alias 매핑 추가 — 예: `applicant→contractor_pic`, `safety_manager→safety_pic`, `construction_manager→cm`, `safety_management→sm`, `site_manager|director→site_director`. 대소문자/영문/한글 별칭도 매핑 테이블로.
- `reviewed_at` 계산: 최종 `approved_at` 이 있으면 그 전날 자정 기준(`YYYY-MM-DD`) 을 `signatures.reviewed_at` 로 저장(파생값 — DB 는 그대로).
- `SigCell` (238줄) 리팩토링: `signature` 없어도 `name` 또는 `signed_at` 이 있으면 "성명 + 승인일시" 텍스트로 자동 표기. 서명 이미지가 있으면 이미지 + 이름. 아직 미결재면 "(대기)" 로 표시(편집 가능 시 "서명" 버튼 유지).
- 추가로 결재 라인은 담당자(시공) →담당자(안전)→책임자(소장)→담당자(CM)→담당자(SM) 으로 고정시켜주고 실제 결재라인도 이렇게 되게 해줘.(특정상황시 대리결재할수도 있으니까 이부분도 감안해주고)

### D. 검토일/승인일 셀 (`DigPermitForm.tsx` 355~357)

- 승인일: `signatures.approved_at` 을 그대로 사용 (WorkPermitDetail 에서 이미 최종 `approved_at` 을 세팅).
- 검토일: `signatures.reviewed_at` 이 없으면 `approved_at - 1일` 을 그 자리에서 계산해 표시 (fallback). 승인 전이면 공란.

### E. 회귀 확인

- `tsgo` 로 타입 확인.
- 저장/재조회 시 신규 필드(`work_extend_until`, `work_complete_time`) 가 `form_data` JSON 에 그대로 보존되는지 코드로 확인 (별도 DB 변경 없음).

## 기술 세부

- 변경 파일: `src/pages/WorkPermitDetail.tsx`, `src/components/permits/DigPermitForm.tsx`. DB/마이그레이션 없음.
- role 매핑은 `WorkPermitDetail.tsx` 내부 상수 `ROLE_TO_SIG` 로 추가 (`POSITION_TO_SIG` 와 병합).
- `reviewed_at` 계산: `new Date(new Date(approved_at).getTime() - 86400000).toISOString()`.
- A4 폭: `210mm` (약 794px). 데스크톱에서 좌우 여백은 컨테이너가 자동 처리(`mx-auto`), 모바일은 `w-full` 로 유지.