
# 허가서 시스템 개선 계획 (AI 분석 + 자동 매핑 + UX 개선)

## 핵심 원칙
- **원본 그대로 인쇄**: 업로드한 PDF를 배경으로 사용, 그 위에 데이터만 오버레이 (현재 방식 유지·강화)
- **AI가 80% 자동, 마스터가 20% 손보기**: 마스터가 매번 수십 개 박스를 손으로 그리지 않게

---

## 단계 1 — AI 양식 자동 분석 (신규)

### 흐름
1. 마스터가 PDF 업로드 → `analyze-permit-template` 엣지 함수 호출
2. 함수가 PDF 각 페이지를 이미지로 변환(pdfjs) → Gemini(멀티모달)에 "이 안전 허가서의 입력란/체크박스/서명란을 JSON으로 반환" 프롬프트
3. 반환 JSON:
   ```
   { fields:[{label,type,page,bbox:[x,y,w,h]}], signatures:[{role_hint,page,bbox}], checkboxes:[{label,page,bbox}] }
   ```
4. 서버가 `layout_json`(필드 정의) + `print_overlay`(좌표 박스)를 자동 생성해 `permit_form_templates`에 저장
5. 마스터는 "AI 초안 검토" 화면에서 라벨 수정/필드 타입 변경/불필요 박스 삭제만 하면 됨

### 필드 타입 자동 추정 규칙 (AI 프롬프트 내장)
- "작업명/공사명/장소" → text
- "작업내용/특이사항" → textarea
- "일자/시간" → date/time
- "□/☐/☑" 근처 텍스트 → checkbox
- "서명/확인/승인/결재" 셀 → signature (role_hint: contractor_pic/sm/site_director/pm/master)
- 표 안 서명란 개수 = 결재라인 단계 수 힌트

### DB 변경
- `permit_form_templates`에 컬럼 추가:
  - `ai_analysis_json jsonb` (AI 원본 응답 보관 - 재적용용)
  - `ai_analyzed_at timestamptz`
  - `signature_slots jsonb` (감지된 서명 슬롯 리스트: `[{role, page, bbox, label}]`)
  - `suggested_approval_steps int` (기본 결재 단계 힌트)

---

## 단계 2 — 결재라인 자동 연동

### 로직
1. AI가 감지한 `signature_slots` 개수/라벨로 **양식별 권장 결재 라인** 자동 제안
   - 예: "작성자 / 안전관리자 / 현장대리인 / 발주처" 4칸 감지 → 4단계 결재 루트 자동 프리셋
2. 마스터는 `SettingsPermitForms`에서 각 서명 슬롯을 **역할**(작성자/안전관리자/현장대리인/PM/발주처/협력사대표)에 드롭다운으로 매핑
3. 허가서 작성 시 `derive_permit_approval_line` RPC가:
   - 양식의 `signature_slots.role` → 해당 프로젝트의 `company_managers`/`project_members`에서 사람 자동 지정
   - 사용자는 이름만 확인/변경 (초보자도 3초 컷)
4. 결재 진행/완료 시 각 결재자의 서명 이미지(profile.signature_url) + 이름 + 승인일시가 지정된 서명 슬롯에 자동 렌더링

### UX
- 허가서 작성 다이얼로그 상단: "이 양식은 서명 4칸입니다. 결재라인 자동 지정됨 ✓" 배지
- 각 서명 슬롯 옆 [사람 선택] 버튼 하나만

---

## 단계 3 — 오버레이 편집기 UX 재설계

### 현재 문제
- 박스가 다른 박스를 침범해도 경고 없음
- 서명/체크박스 지정이 세부 옵션 안에 숨어있어 헷갈림
- 박스 크기 조절/이동을 마우스로 못 함 (그리기만 가능)

### 개선
1. **박스 리사이즈 & 드래그 이동** (react-moveable 또는 자체 구현)
   - 8방향 리사이즈 핸들
   - 화살표 키로 1px 미세조정
2. **박스 타입별 색상**:
   - 텍스트=파랑, 체크박스=초록, 서명=주황
   - AI 자동 생성 박스는 점선 테두리("AI 초안" 뱃지)
3. **겹침 감지**: 다른 박스와 20% 이상 겹치면 빨간 경고 아이콘
4. **툴바 재배치** (편집기 상단):
   - [텍스트][체크박스][서명] 3개 큰 버튼 → 선택 후 드래그하면 해당 타입으로 바로 생성
   - 필드 매핑은 우측 패널 대신 박스 위 인라인 드롭다운
5. **스냅**: Alt 누르면 인접 박스 가장자리에 자동 정렬
6. **정밀도**: 좌표 0~1 비율은 유지하되 편집 시 px 표시도 병기
7. **미리보기 토글**: "샘플 데이터 채워보기" 버튼 → 실제 인쇄 결과 즉시 확인

---

## 단계 4 — 인쇄 파이프라인 강화 (`permitOverlayPrint.ts`)

- 서명 슬롯: 결재 승인 시 저장된 서명 이미지 + 이름 + 승인시각을 3줄로 자동 배치
- 미승인 슬롯: 회색 "미결" 워터마크
- 한글 폰트(Noto Sans KR) 이미 임베드됨 - 유지
- PDF 다운로드 파일명 = `[프로젝트]_[허가서제목]_[일자].pdf`

---

## 단계 5 — 마이그레이션 & 안전장치

- 기존 수동 오버레이 데이터 100% 호환 (컬럼 추가만, 기존 필드 유지)
- AI 분석은 옵션(마스터가 "AI 자동 분석" 버튼 누를 때만)
- AI 실패 시 현재 수동 편집기로 폴백
- `ai_analysis_json` 저장으로 재분석 없이 필드 재적용 가능

---

## 기술 세부 (개발자용)

**신규 파일**
- `supabase/functions/analyze-permit-template/index.ts` — Gemini 2.5 Flash 멀티모달 호출
- `src/components/permit-designer/AIAnalysisPanel.tsx` — 분석 트리거 + 진행률 + 결과 검토
- `src/components/permit-designer/SignatureSlotMapper.tsx` — 서명 슬롯 → 역할 매핑 UI
- `src/lib/permitApprovalDeriver.ts` — 서명 슬롯 → 결재라인 자동 생성

**수정 파일**
- `src/components/permit-designer/OverlayEditor.tsx` — 리사이즈/드래그/툴바/겹침감지 (~700줄로 확장)
- `src/pages/SettingsPermitForms.tsx` — AI 분석 버튼, 서명 슬롯 탭 추가
- `src/lib/permitOverlayPrint.ts` — 서명 슬롯 자동 렌더 로직
- `src/pages/WorkPermitDetail.tsx` — 결재라인 자동 프리셋 표시
- `src/lib/permitFormTypes.ts` — SignatureSlot 타입 추가

**DB 마이그레이션**: `permit_form_templates`에 4개 컬럼 추가 + `derive_permit_approval_line` RPC 추가

**AI 비용**: 양식당 1회 분석(≈1-2 크레딧), 결과는 DB에 캐시하여 재분석 불필요

---

## 산출물 체크리스트
- [ ] AI 자동 분석으로 신규 양식 등록 5분 → 30초
- [ ] 서명 슬롯 개수와 결재라인 단계 자동 일치
- [ ] 오버레이 편집기에서 박스 드래그/리사이즈/겹침감지
- [ ] 결재 완료 시 모든 서명이 원본 양식 서명란에 정확히 표시
- [ ] 기존 수동 양식 100% 호환
