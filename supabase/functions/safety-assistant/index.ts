const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const SYSTEM_PROMPT = `당신은 대한민국 산업안전보건법 전문 AI 안전 어시스턴트입니다. 
건설/플랜트 현장의 20년 경력 안전관리 총괄 책임자로서 답변합니다.

전문 분야:
1. 산업안전보건법 및 시행령/시행규칙
2. 중대재해처벌법
3. 위험성평가 방법론 (KOSHA Guide)
4. 작업계획서 작성 기준
5. 안전관리자 직무 및 법적 의무
6. 건설기계 안전기준
7. 유해위험방지계획서
8. 안전보건교육

답변 규칙:
- 관련 법 조항을 반드시 인용하세요 (예: 산업안전보건법 제36조)
- 실무에 바로 적용 가능한 구체적 답변을 제공하세요
- 한국어로 답변하세요
- 불확실한 내용은 명확히 표시하세요
- 마크다운 형식으로 답변하세요`;

const QUICK_RESPONSES: Record<string, string> = {
  'legal_checklist': `## 📋 안전관리자 법적 의무 체크리스트

### 일일 업무
- [ ] 작업 시작 전 안전점검 실시 (산안법 제36조)
- [ ] TBM(Tool Box Meeting) 참석 및 확인
- [ ] 작업허가서 확인 (고소작업, 화기작업 등)
- [ ] 안전시설물 점검 (추락방지망, 안전난간 등)

### 주간 업무
- [ ] 안전보건 합동점검 실시 (산안법 제17조)
- [ ] 위험성평가 결과 검토 및 개선조치 확인
- [ ] 안전보건교육 실시 확인 (산안법 제29조)
- [ ] 근로자 건강관리 확인

### 월간 업무
- [ ] 산업안전보건위원회 개최 (산안법 제24조)
- [ ] 안전보건관리규정 이행실태 점검
- [ ] 중대재해 예방 점검표 작성
- [ ] 안전보건 통계 분석 및 보고

### 수시 업무
- [ ] 산업재해 발생 시 원인조사 및 재발방지 대책 수립
- [ ] 법령 개정사항 확인 및 반영
- [ ] 작업환경측정 결과 확인 (산안법 제125조)`,

  'safety_manager_guide': `## 👷 안전관리자 직무 가이드

### 1. 법적 근거
- **산업안전보건법 제17조**: 안전관리자의 업무
- **산업안전보건법 시행령 제18조**: 안전관리자의 자격

### 2. 주요 직무
1. **위험성평가 실시** (산안법 제36조)
   - 사전 위험요인 파악
   - 위험성 추정 및 결정
   - 감소대책 수립 및 실행

2. **안전보건교육 실시** (산안법 제29조)
   - 정기교육: 매월 2시간 이상
   - 채용 시 교육: 8시간 이상
   - 특별교육: 16시간 이상

3. **작업환경 관리**
   - 위험기계·기구 안전검사
   - 보호구 지급 및 착용 지도
   - 안전시설 점검

### 3. 위반 시 제재
- 안전조치 미이행: 5년 이하 징역 또는 5천만원 이하 벌금
- 중대재해 발생: 중대재해처벌법 적용`,

  'serious_accident_guide': `## ⚠️ 중대재해 예방 가이드

### 1. 중대재해처벌법 주요 내용
- **적용 대상**: 상시근로자 5인 이상 사업장
- **경영책임자 의무**: 안전보건 확보 의무 (제4조)
- **처벌**: 1년 이상 징역 또는 10억원 이하 벌금

### 2. 9대 안전보건 확보 의무
1. 안전보건 목표 및 경영방침 설정
2. 안전보건 전담조직 설치
3. 유해·위험요인 확인 및 개선
4. 재발방지 대책 수립 및 이행
5. 중앙행정기관 등의 개선·시정 명령 이행
6. 안전보건관리체계 구축 및 이행
7. 안전·보건 관계 법령의 의무 이행
8. 안전관리자 등의 충실한 업무 수행 지원
9. 종사자 의견 청취 절차 마련

### 3. 건설현장 중대재해 TOP 5
1. **추락** (전체의 약 50%)
2. **끼임/협착** (약 15%)
3. **떨어짐(낙하/비래)** (약 12%)
4. **감전** (약 8%)
5. **붕괴/도괴** (약 7%)`,

  'inspection_guide': `## 🔍 안전점검 항목 가이드

### 1. 일반 안전점검
- 작업장 정리정돈 상태
- 통로 확보 및 표시 상태
- 소화설비 배치 및 작동 상태
- 안전표지 부착 상태

### 2. 가설구조물 점검 (산안법 시행규칙 별표 4)
- 비계(scaffolding) 안전성
- 거푸집 동바리 안전성
- 가설통로 및 사다리

### 3. 건설기계 점검
- 작업 전 점검표 확인
- 안전장치 작동 확인
- 운전자 자격증 확인
- 작업반경 내 출입통제

### 4. 전기 안전점검
- 접지 상태 확인
- 누전차단기 작동 확인
- 임시배전반 관리 상태
- 전선 피복 손상 여부

### 5. 화재/폭발 예방
- 인화성 물질 관리
- 화기작업 허가서 확인
- 소화기 비치 및 점검
- 가스 누출 감지기 작동`
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message, type, history } = await req.json();

    // Quick response for predefined topics
    if (type && QUICK_RESPONSES[type]) {
      return new Response(JSON.stringify({ 
        response: QUICK_RESPONSES[type],
        type: 'quick'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // AI chat completion
    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add history if provided
    if (history && Array.isArray(history)) {
      messages.push(...history.slice(-10)); // Keep last 10 messages for context
    }

    messages.push({ role: 'user', content: message });

    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages,
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI Gateway error:', response.status, errText);
      return new Response(JSON.stringify({ 
        error: 'AI 응답 생성 실패',
        response: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || '응답을 생성할 수 없습니다.';

    return new Response(JSON.stringify({ 
      response: aiResponse,
      type: 'ai'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Safety assistant error:', error);
    return new Response(JSON.stringify({ 
      error: String(error),
      response: '오류가 발생했습니다. 다시 시도해 주세요.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
