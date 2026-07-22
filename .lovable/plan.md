## 목표

현재 "표준 양식(내장) SF003"은 `DigPermitForm.tsx`에 하드코딩되어 있어, 첨부 스크린샷의 빨간 네모칸처럼 열 너비가 안 맞아도 마스터가 수정할 수 없습니다. **허가서 양식 디자인 화면에서 표준 양식의 열/행 스타일(칸 너비, 행 높이, 폰트 크기 등)을 조정**할 수 있게 만들어, 프로젝트별로 표준 양식을 커스터마이즈 가능하게 합니다.

## 접근 방식

DigPermitForm의 HTML `<table>` 구조는 그대로 두되(구조까지 자유편집으로 만들면 3종 허가서 로직이 깨짐), **"스타일 프리셋"** 개념을 도입합니다:

- 각 표준 양식 테이블의 열마다 고유 slot key를 부여 (예: `general.header.col1` = 공사업체 라벨열, `col2` = 서명열 …).
- 마스터가 디자이너에서 슬라이더/입력으로 각 slot의 `width(px)`, `min-height`, `font-size`를 조정.
- 결과는 `permit_form_templates.layout_json.standard_style` (JSONB)에 저장.
- `DigPermitForm`은 렌더 시 이 style map을 읽어 `<colgroup>` / inline style로 반영.

이 방식이면 3종 허가서의 필드/체크박스 로직은 건드리지 않고, **시각적 정렬 문제만** 마스터가 즉시 고칠 수 있습니다.

## 구현 단계

### 1. 표준 양식 슬롯 정의 (`src/lib/permitStandardStyle.ts` 신규)

```text
STANDARD_SLOTS = {
  general: {
    header: [
      { key: 'col_label',   default_w: 110, label: '라벨열(공사업체)' },
      { key: 'col_value',   default_w: 160, label: '값열(서명)' },
      { key: 'col_center',  default_w: 'auto', label: '중앙 승인업체 열' },
      { key: 'col_review',  default_w: 100, label: '검토일' },
      { key: 'col_approve', default_w: 100, label: '승인일' },
    ],
    // ... 작업개요/안전조치/가스측정 등 테이블별 슬롯
  },
  confined_space: { ... },
  hot_work: { ... },
  excavation: { ... },
}
```

- `defaultStandardStyle()` / `mergeStandardStyle(saved)` 헬퍼.

### 2. DigPermitForm 리팩터

- `props`에 `standardStyle?: StandardStyle` 추가.
- 각 `<table>` 상단에 `<colgroup>` 삽입, slot key 기반으로 `width` 적용.
- 하드코딩된 `w-[110px]` / `w-[160px]` 등을 slot 참조로 교체.
- `<style>` 블록에 slot별 font-size / row height CSS 변수 주입.

### 3. WorkPermitDetail 연동

- 선택된 template(내장이든 커스텀이든)의 `layout_json.standard_style`을 읽어 `DigPermitForm`에 전달.
- 내장 양식(template_id=null)일 때는 프로젝트 기본 template의 스타일이 있으면 사용, 없으면 default.

### 4. 디자이너에 "표준 양식 스타일" 탭 추가 (`SettingsPermitForms.tsx`)

- 기존 탭(AI / 빌더 / 오버레이 / 서명매핑 / …)에 `표준 양식 스타일` 추가.
- 좌: `permit_type` 선택 → 해당 타입의 슬롯 트리 표시.
- 각 슬롯 행: 라벨 · 너비 슬라이더(40~400px 또는 auto) · 폰트 크기 셀렉트 · 초기화 버튼.
- 우: 실시간 미리보기로 `DigPermitForm`을 `readOnly` + 더미 데이터로 렌더 → 조정이 즉시 반영되는 것을 확인.
- "저장" → `layout_json.standard_style`에 병합해서 upsert.

### 5. 문서 번호 / 승인업체명 등 편집 가능 필드

스크린샷의 "승인업체: 에어리퀴드" 하드코딩도 함께 이번에 슬롯화:

- `layout_json.standard_labels.approver_company` (기본 "에어리퀴드").
- 상단 헤더 라벨(공사업체/검토일/승인일/문서번호 접두사 `MD-...-SF003`)도 동일하게 label override 가능.

### 6. 검증

- typecheck 통과.
- 저장된 스타일이 없을 때 default로 폴백해서 기존 화면과 동일하게 보이는지 확인.
- 스타일 조정 후 인쇄(`printMode`)에서도 반영되는지 확인.

## 범위 밖 (이번 계획에 포함 안 함)

- 표준 양식의 **행/체크박스 추가·삭제** (구조 변경) — 요청은 "칸 너비가 안 맞음" 수정이므로 스타일만 다룸.
- 오버레이/PDF 모드는 변경 없음.

## 확인 요청

- 이 방향(구조는 유지, 열 너비·폰트만 마스터가 조정)으로 진행해도 될까요? 좋아
- 조정 저장 단위는 **프로젝트별**(project_id 지정 template) vs **글로벌 기본**(project_id=null) — 둘 다 지원하도록 하되 프로젝트별 값이 우선하는 계층 구조로 진행하겠습니다.

추가요청 : 허가서 작성 시 한글이 제대로 입력되지 않는 문제가 있음.