## 배경 (현재 상태 진단)

허가서 양식 관련 코드/기능이 여러 개로 분산되어 서로 연동이 안 됩니다.

- `DigPermitForm.tsx` — 내장 SF003 표준 폼 (일반/밀폐/화기/굴착)
- `StandardStyleEditor.tsx` — 열 너비/폰트/라벨만 조정 (셀 색상·행 높이·로고 불가, 폼 종류 탭 없이 "일반" 미리보기 1개만 노출)
- `OverlayEditor.tsx` — 원본 PDF 위에 필드 박스 배치
- `LivePreview.tsx` — 빌더 섹션 미리보기 (실제 인쇄 결과와 다름)
- 등록된 기본 SF003 양식이 첨부 파일(Rev.C, Air Liquide 로고, 파란 헤더/라벨 배경, 화기·밀폐 하단 결재 포함)과 다른 구버전

## 목표

**"허가서 양식 디자인 = 표준양식 스타일 편집기 하나로 통일"** — 오버레이는 옵션(선택 기능)으로 격하하고, 표준 폼을 시각적으로 편집→실시간 미리보기→그대로 허가서 작성 화면에 반영.

---

## 실행 순서

### 1) 표준양식 스타일 편집기 확장 (핵심)

`permitStandardStyle.ts` 스키마에 다음을 추가:

- `colors`: 헤더 배경, 라벨 셀 배경, 값 셀 배경, 테두리, 강조 텍스트 색 (허가서 종류별 개별 설정)
- `rowHeights`: 섹션별 최소 행 높이 (px)
- `logo`: 좌상단 로고 (project_library에 업로드된 이미지 URL 또는 base64)
- `titleAlign`, `titleColor` — 제목 스타일
- `sectionVisibility`: 특정 섹션 on/off (예: 굴착 폼의 특정 체크 항목)

`StandardStyleEditor.tsx`:
- **폼 종류 탭 추가**: 일반 / 밀폐공간 / 화기 / 굴착 — 각각 독립적으로 열너비·색상·라벨 편집
- 색상 피커(shadcn), 로고 업로드, 행 높이 슬라이더 추가
- 우측 미리보기를 선택된 탭의 폼으로 동기화(현재는 "일반" 고정)

### 2) DigPermitForm 렌더링 업그레이드

- `standardStyle.colors` / `rowHeights` / `logo` 를 CSS 변수 + inline style 로 주입
- 첨부 원본(Rev.C)과 동일한 레이아웃으로 셀 구조 정비:
  - 상단 로고 + 제목 + Doc.No 우측 정렬
  - 공사업체/승인업체 2×2 그리드 (담당자(CM)/담당자(SM), 김토임/승인원 등 파란 배경)
  - 안전조치 요구사항 3열 체크 매트릭스
  - 화기/밀폐 하단 결재란 (안전관리자·관리감독자·현장당일확인·승인자)
  - 가스농도 측정 표 (O₂/H₂S/CO/H·C/CO₂ 기준값 포함)
- 인쇄 CSS에서도 색상·행높이·로고 동일 적용 (WYSIWYG)

### 3) 기본 등록 양식 최신화 (Rev.C)

마이그레이션으로 `permit_form_templates` 의 기본 SF003 템플릿(project_id NULL, is_default true) 을 다음 값으로 upsert:

- `layout_json.standard_style` = 첨부와 동일한 색상(파란 #DCE6F1 라벨 배경, 빨간 강조), 열 너비, 로고 URL
- `layout_json.standard_labels` = 승인업체명 "Air Liquide Korea", docNoPrefix "GEN-000000-SF003" (기존 예시 유지, 프로젝트별 오버라이드 가능)
- 각 permit type(general/confined_space/hot_work/excavation) 별 스타일 프리셋

### 4) 미리보기 실효화

- `StandardStyleEditor` 우측 미리보기가 편집한 permit type 을 그대로 `DigPermitForm readOnly` 로 렌더 (실제 인쇄 화면과 동일 컴포넌트)
- "인쇄 미리보기(A4)" 토글 추가 — 실제 print CSS 를 적용해 인쇄 결과 그대로 확인
- 빌더용 `LivePreview.tsx` 는 커스텀 양식(오버레이 외 사용자 정의) 전용으로만 남김

### 5) 기능 정리 (혼란 제거)

`SettingsPermitForms.tsx` 탭 재구성:

```text
[표준 양식 디자인]  ← 기본 (표준 스타일 편집기 = 대부분 사용자)
[원본 PDF 오버레이] ← 고급 옵션 (특수 양식이 있는 경우만)
[템플릿 목록]       ← 저장된 프로젝트별/전역 템플릿 관리
```

- 엑셀 그리드 잔재 완전 제거 확인
- 빌더(섹션/필드 자유편집)는 표준 스타일로 커버되므로 숨김 처리(코드 유지, UI 진입점만 제거)

### 6) 허가서 작성 모듈 연동 확인

`WorkPermitDetail.tsx` 는 이미 프로젝트별 `standard_style` / `standard_labels` 를 로드하여 `DigPermitForm` 에 전달 중. 여기에:
- 로고/색상/행높이도 함께 전달
- 프로젝트별 오버라이드가 없으면 전역 기본 템플릿(3단계에서 심은 Rev.C) 사용
- 편집 → 저장 → 작성 화면 재진입 시 즉시 반영되는지 E2E 확인

---

## 기술 세부사항

- `permit_form_templates.layout_json` 은 JSONB — 스키마 마이그레이션 없이 필드만 추가
- 색상 저장은 HSL 문자열(디자인 토큰 호환), 기본값은 index.css 토큰으로 폴백
- 로고는 project_library_files 에 업로드 후 URL 저장 (base64 지양)
- IME 안정성 유지: `Inp` 컴포넌트는 이미 모듈 스코프

## 범위 밖 (하지 않는 것)

- 오버레이 편집기(`OverlayEditor.tsx`) 기능 수정 — 그대로 보존, 진입 경로만 "고급"으로 이동
- 결재 라인 로직 변경 — 이미 `signature_role` 매핑 완료
- AI 자동 분석 — 오버레이 전용이므로 그대로 유지

## 검증

1. 표준 스타일 편집기에서 화기 탭 → 라벨 배경색 변경 → 미리보기 즉시 반영
2. 로고 업로드 → 저장 → 새 허가서 작성 화면에서 로고 표시
3. 프린트(Ctrl+P) 시 색상·로고·행높이 모두 유지
4. 프로젝트별 오버라이드 없는 경우 전역 Rev.C 기본값 사용
5. tsgo 통과 및 기존 오버레이 워크플로 무회귀