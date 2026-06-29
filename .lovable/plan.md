## 목표
Lovable AI Gateway 호출을 모두 **Google Gemini API 직접 호출**로 전환하여 비용을 대폭 절감합니다. (Gemini 2.5 Flash는 Lovable Gateway 대비 약 1/5~1/10 수준)

## 사전 준비 (사용자 작업)
1. https://aistudio.google.com/apikey 접속 → "Create API key" 클릭
2. 발급된 키 복사 → Lovable에서 `GEMINI_API_KEY` 시크릿으로 저장 (제가 폼 띄워드림)

## 변경 대상 엣지 함수 (총 7개)

| 함수 | 현재 모델 | 전환 후 |
|---|---|---|
| `generate-risk-ai` | gemini-2.5-flash (via Lovable) | `gemini-2.5-flash` (직접) |
| `risk-job-orchestrator` | 위와 동일 | 위와 동일 |
| `safety-assistant` | 위와 동일 | 위와 동일 |
| `generate-education-material` | 위와 동일 | 위와 동일 |
| `analyze-safety-cost-document` | 위와 동일 + 이미지 분석 | `gemini-2.5-flash` (멀티모달) |
| `analyze-worker-opinion` | 위와 동일 | 위와 동일 |
| `check-ai-credits` | Lovable 잔액 확인용 | **Gemini 키 유효성 확인으로 변경** |

## 기술 변경 사항

### 1. 공통 헬퍼 신규 생성: `supabase/functions/_shared/gemini.ts`
- Google Generative Language REST API (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`) 직접 호출
- OpenAI 호환 포맷 → Gemini 네이티브 포맷 변환 (system/user/assistant → systemInstruction/contents, tools → functionDeclarations)
- 429/quota/safety block 에러 한국어로 변환
- JSON 출력 모드 (`responseMimeType: "application/json"`) 지원
- 멀티모달 이미지 입력 (inlineData base64) 지원

### 2. 각 함수 수정
- `fetch("https://ai.gateway.lovable.dev/...")` 호출 → `callGemini()` 헬퍼로 교체
- 환경변수: `LOVABLE_API_KEY` → `GEMINI_API_KEY`
- 응답 파싱: `data.choices[0].message.content` → `data.candidates[0].content.parts[0].text`
- 에러 메시지: "AI 크레딧" → "Gemini API 한도/키" 로 안내 문구 수정

### 3. UI 변경
- `AICreditBanner.tsx`: "AI 크레딧" → "Gemini API 상태"로 라벨 변경, 충전 URL 제거 (Google AI Studio는 무료 할당량 기반)
- `riskAutoGenAI.ts`: 에러 메시지 한글화 ("Gemini API 키가 없거나 한도 초과" 등)
- `Settings.tsx`: 마스터 전용 "Gemini API 키 관리" 섹션 추가 (키 등록 상태 표시 + 재등록 버튼)

### 4. 모델 선택 정책
- **기본**: `gemini-2.5-flash` (Lovable Gateway의 google/gemini-2.5-flash와 동일 모델, 비용은 직접가)
- **백업/대량용**: `gemini-2.5-flash-lite` (더 저렴, risk-job-orchestrator 배치에서 사용)
- **이미지 분석**: `gemini-2.5-flash` (멀티모달 지원)

### 5. 마이그레이션 안전장치
- `GEMINI_API_KEY` 미설정 시 명확한 에러 메시지 ("마스터가 설정 > AI에서 Gemini 키를 등록해야 합니다")
- 첫 호출 시 자동 검증 후 결과 토스트

## 영향받지 않는 부분
- 결재/위험성평가 DB 스키마, RLS, 결재 워크플로우 — **건드리지 않음**
- 프론트엔드 위험성평가 UI/플로우 — **그대로 유지** (내부 함수 호출만 바뀜)
- 캐싱 (`ai_risk_cache`), 잡 큐 (`ai_generation_jobs`) — **그대로 유지**

## 비용 예상 (월 1만 회 호출 기준)
- 현재 Lovable Gateway: 약 $50~150
- Gemini 직접 (2.5 Flash): 약 $5~15 + **무료 할당량 (분당 15회, 일 1500회)** 내에서는 $0

## 실행 순서
1. `GEMINI_API_KEY` 시크릿 등록 요청 (폼 띄움)
2. `_shared/gemini.ts` 헬퍼 작성
3. 7개 엣지 함수 순차 교체
4. 프론트 UI 라벨/에러 메시지 업데이트
5. 위험성평가 1건 자동생성 테스트로 검증

승인하시면 진행합니다.