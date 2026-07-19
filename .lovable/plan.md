
# 허가서 양식 디자이너 v3 — 드래그 안정화 · 결재정보 · 편의기능

## 1. 핵심 버그: "박스가 계속 마우스를 따라다닌다"

### 원인 (코드 확인 완료)
`OverlayEditor.tsx` 의 `onMouseMove` / `onMouseUp` 이 **canvas 엘리먼트에만** 바인딩돼 있음.  
드래그 도중 커서가 박스(div, canvas 위에 절대배치) 위로 올라가면
- 이벤트가 박스 div로만 전달 → canvas의 `onMouseUp` 이 **영원히 안 불림**
- 그래서 클릭을 떼도 `drag` 상태가 유지되고, 다시 마우스를 움직이면 박스가 계속 따라옴

### 해결
드래그 시작 시 `window`(또는 `document`)에 `pointermove` / `pointerup` 리스너를 붙이고 종료 시 해제. Pointer Capture(`setPointerCapture`) 를 함께 사용해 캔버스 밖으로 벗어나도 이벤트를 잃지 않게 함.

## 2. 디자이너 UX 개선 (편집이 훨씬 쉬워지도록)

1. **스냅·정렬 가이드**
   - 이동/리사이즈 중 다른 박스의 좌·우·상·하·중앙선과 5px 이내면 자홍색 가이드 라인 + 자동 스냅
   - Shift 누르면 스냅 무시(자유 이동)
2. **그리드 스냅** — 페이지의 0.5%/1% 그리드, 툴바에서 ON/OFF
3. **8방향 리사이즈 핸들** (현재는 우하단만) + 최소 크기 보장(0.008)
4. **박스 잠금(🔒)** — 선택은 되지만 이동/리사이즈 금지 (배경 앵커용)
5. **다중 선택**
   - Shift+클릭으로 여러 박스 선택
   - 정렬 툴바: 좌/우/상/하/중앙 정렬, 동일 폭/높이, 균등 분배
6. **복제/붙여넣기** — Ctrl/⌘+D 복제, Ctrl+C/V 페이지 간 붙여넣기
7. **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z (최근 30단계)
8. **줌 & 팬** — 25~200% 슬라이더, Space+드래그 팬
9. **오른쪽 패널 개편**
   - 상단: 선택된 박스 속성(현재)
   - 하단: "매핑 안 된 박스 N개" · "겹침 경고 N개" 리스트 → 클릭 시 해당 박스로 스크롤·선택
10. **AI 재분석 부분영역** — 페이지의 특정 영역만 드래그로 지정해 AI에 재분석 요청 → 인식률 향상

## 3. 결재 정보 자동 렌더 강화

### 현재 상태
`permitOverlayPrint.ts` 에 `signature_slots` + `approvedSigners` 로 서명 이미지·이름·일자를 그리는 로직은 이미 존재. 단, 실사용 배선이 부족하고 표현 요소가 제한적.

### 개선안
1. **결재 슬롯 확장 스키마** (`signature_slots[]`)
   - `render_name` · `render_date` · **`render_time`** · **`render_position`(직책)** · **`render_stamp`(도장 이미지)** · **`render_label`(예: "결재") ** 토글
   - `slot_kind`: `approver` | `reviewer` | `worker` | `witness`
   - `date_format`: `YYYY-MM-DD` | `YYYY.MM.DD HH:mm` 등
2. **결재라인 자동 매핑**
   - `WorkPermitDetail` 이 인쇄 호출 시, 해당 문서의 `approval_line_steps` 에서 순번대로 슬롯 채움 (역할 우선, 없으면 순번)
   - 승인자 서명은 프로필 서명 이미지 → 없으면 이름 텍스트 → 도장(있으면) 순
   - 대기(`pending`) 는 회색 "결재중", 반려는 빨간 "반려" 워터마크
3. **결재 이력 박스(신규 렌더 타입)** — 슬롯 대신 표 형태로 결재라인 전체(직책/이름/일시/상태)를 자동 그리드로 그림. 양식에 표만 잡아두면 자동 채워짐.
4. **작성자·부서·회사 자동 필드** — 시스템 값 필드 목록에 `__meta.author_name`, `__meta.author_dept`, `__meta.company_name`, `__meta.today`, `__meta.doc_no` 추가 → 디자이너에서 드롭다운으로 선택.

## 4. 추가로 필요하다고 판단한 기능

- **양식 버전 관리** — 저장 시 스냅샷, 이전 버전으로 롤백. 이미 작성 중인 허가서는 작성 시점 버전 유지.
- **템플릿 복제/공유** — 프로젝트 간 양식 복사 (마스터 전용)
- **미리보기 실데이터 시뮬레이션** — 결재 3명 승인된 상태로 가상 렌더 → 인쇄 전 육안 검증
- **좌표 검증기** — 저장 시 (a) 매핑 없는 박스 (b) 30% 이상 겹침 (c) 페이지 범위 이탈 → 경고 리스트, 무시하고 저장 가능
- **모바일 뷰어 대응** — 인쇄 오버레이 결과를 PDF로도 저장(브라우저 인쇄 대화상자 대신 서버 렌더 옵션)

## 5. 작업 범위(파일)

- `src/components/permit-designer/OverlayEditor.tsx` — 드래그 리스너 이관, 스냅/가이드, 다중선택, 8핸들, undo/redo, 줌
- `src/components/permit-designer/PropertyPanel.tsx` — 잠금/정렬/시스템필드 드롭다운
- `src/components/permit-designer/SignatureSlotMapper.tsx` — 새 토글 필드 · 표 렌더 슬롯
- `src/lib/permitFormTypes.ts` — SignatureSlot 스키마 확장, `__meta` 필드 정의
- `src/lib/permitOverlayPrint.ts` — 결재라인 자동주입, 표 렌더, 도장/직책/시간 렌더
- `src/pages/WorkPermitDetail.tsx` — 인쇄 시 `approval_line_steps` → `approvedSigners` 매핑, `__meta` 값 주입
- `src/pages/SettingsPermitForms.tsx` — 버전 관리 UI, 미리보기 시뮬레이션, 좌표 검증기

## 6. 기술 노트 (기술적 세부사항)

- 드래그: `pointerdown` 시 `setPointerCapture(e.pointerId)` + `window.addEventListener('pointermove'/'pointerup')`. `useRef` 로 drag 상태 저장(리렌더 최소화), 이동 중엔 로컬 optimistic 좌표를 style에 직접 적용하고 `pointerup` 시점에만 `commit()` 호출 → 리렌더 폭주 방지.
- Undo/Redo: `overlay` 스냅샷 히스토리 stack (JSON deep copy, 최대 30). 커밋 단위로 push.
- 스냅: 이동 좌표 계산 후 다른 박스 & 그리드 라인과의 최소거리(<5px) 계산, 스냅 대상선을 SVG 오버레이로 표시.
- 결재 표 렌더: SignatureSlot 에 `render: 'table'` 추가 시 `permitOverlayPrint` 가 슬롯 사각형 안에 `approval_line_steps` 를 행으로 그림 (헤더: 직책/성명/일시/상태).

---

승인해 주시면 위 순서대로 (1)버그 즉시 수정 → (2)UX → (3)결재 확장 → (4)부가 기능 순으로 구현하겠습니다.
