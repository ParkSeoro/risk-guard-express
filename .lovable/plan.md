## 목표
마스터가 **기존 허가서 엑셀 파일(.xlsx)을 업로드** → 웹 스프레드시트로 열어 **셀 병합·서식·표 그대로 유지**한 채 편집 → **입력/서명 셀만 지정**하면 사용자가 그 양식으로 허가서를 작성·인쇄. PDF 오버레이는 "고급" 보조 기능으로 강등.

## 핵심 전제
- **처음부터 새로 그리지 않는다.** 마스터가 이미 가진 엑셀 양식을 그대로 불러와서 최소한의 조작(입력 셀 지정)만 추가한다.
- 스프레드시트 엔진은 **Univer (MIT)**: xlsx import/export 지원, 셀 병합·서식·이미지·인쇄영역 보존, 한글 IME 정상 동작.

## 현재 상태
- `permit_form_templates`에 `layout_json`, `print_overlay`, `original_pdf_url`, `signature_slots`, `permit_type`, `is_active`, `is_default` 존재.
- `WorkPermitDetail.tsx`는 `permit_type` 자동 매칭 1건만 로드 — 드롭다운 선택 UI 없음(확인됨).
- 스프레드시트 엔진 미도입.

## 계획

### 1. DB 마이그레이션 (1건)
`permit_form_templates`에 추가:
- `grid_snapshot jsonb` — Univer workbook JSON (업로드된 xlsx를 파싱한 결과)
- `input_cells jsonb` — `[{sheet, row, col, field_key, kind:'text'|'check'|'sign'|'date', role?}]`
- `source_xlsx_url text` — 원본 xlsx 파일(감사/재편집용)

### 2. Univer 도입
- `@univerjs/presets` + `@univerjs/preset-sheets-core` 설치.
- xlsx 파싱: `@univerjs/preset-sheets-core`의 import 플러그인(또는 `xlsx` → Univer JSON 변환기) 사용.

### 3. 마스터: 양식 디자이너 (신규 기본 탭)
`SettingsPermitForms.tsx`에 **"스프레드시트 양식"** 탭 신설(기본):
1. **xlsx 업로드** → Univer로 즉시 렌더 (병합·서식·이미지·행높이 그대로).
2. 마스터는 필요 시 텍스트/서식 미세 수정.
3. **툴바 "입력 셀 지정"**: 셀 선택 후 kind(text/check/sign/date) + field_key(예: `work_desc`, `sign_pm`) 부여.
   - 지정된 셀은 배경색으로 시각 표시(입력=연노랑, 서명=주황, 체크=연녹).
   - 서명 셀은 role 선택(결재선 role과 매핑; 기존 `signature_slots` 규약 재사용).
4. **저장**: `source_xlsx_url`(Storage 업로드), `grid_snapshot`, `input_cells` 저장. 버전은 기존 `permit_form_template_versions` 활용.
5. **재편집**: 저장된 `grid_snapshot`을 다시 열어 편집. 원본 xlsx로 롤백 버튼 제공.

### 4. 사용자: 허가서 작성 (`WorkPermitDetail.tsx`)
- **양식 선택 드롭다운(신규)** 헤더 배치: `is_active=true, is_deleted=false` 전 양식 표시. 기본값은 `permit_type` 매칭 + `is_default=true`. 변경 시 field_key 기준으로 기존 입력값 최대한 이관.
- **탭1 "양식 작성"(기본)**: Univer 그리드를 read-only + `input_cells` 셀만 편집 가능 모드로 렌더.
  - 텍스트/날짜 셀 → 인라인 입력, 체크 셀 → 클릭 토글, 서명 셀 → 서명패드 팝업.
  - 값은 `work_permits.form_data = {field_key: value}`로 저장.
- **탭2 "고급 (PDF 오버레이)"**: 기존 `OverlayFillForm` 이동 — 오버레이 양식이 지정된 경우에만 활성.

### 5. 인쇄 / PDF
- 인쇄 시 `form_data`를 `input_cells` 위치에 채우고, 결재라인의 승인자 이름·서명 이미지·승인 일시를 서명 셀에 렌더.
- Univer의 print/export PDF로 **원본 엑셀 레이아웃 그대로** 출력. 기존 `printOverlay()`는 고급 탭 전용 유지.

### 6. 마이그레이션 정리
- `OverlayEditor.tsx`, `AIAnalysisPanel.tsx`는 유지하되 진입점은 설정 > 양식 상세의 "고급 오버레이" 탭에서만.

## 기술 세부
- 파일: `SettingsPermitForms.tsx`(탭 재구성), `WorkPermitDetail.tsx`(드롭다운+그리드 렌더), 신규 `components/permit-grid/GridDesigner.tsx`, `GridFillForm.tsx`, `lib/permitGridExport.ts`, `lib/xlsxToUniver.ts`.
- Storage: 기존 `permit-form-assets` 버킷에 원본 xlsx 저장.
- 라이브러리: `@univerjs/presets`, `@univerjs/preset-sheets-core`, 기존 `xlsx` 재사용.

## 검증
1. 마스터가 실제 회사 엑셀 허가서 업로드 → 병합·서식 유지 확인 → 입력/서명 셀 지정 → 저장.
2. 사용자가 작성 화면 드롭다운에서 해당 양식 선택 → 값 입력 → 결재 → PDF 인쇄 시 원본 레이아웃 + 서명·일시 자동 표기 확인.
3. 고급 탭 PDF 오버레이 회귀 확인.
