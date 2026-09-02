/** UI copy of Edge `_shared/aiRoute.ts` — do not import Deno env here. */
export type AiCostLane = {
  feature: string;
  provider: "OpenAI" | "Gemini";
  model: string;
  why: string;
};

export const AI_COST_LANES: AiCostLane[] = [
  { feature: "작업계획서", provider: "OpenAI", model: "gpt-4o-mini", why: "짧은 JSON, 단가 저렴, 스키마 안정" },
  { feature: "위험성평가", provider: "OpenAI", model: "gpt-4o-mini", why: "초안·채움 JSON이 깨지면 재생성 비용이 더 큼" },
  { feature: "허가서 브리핑", provider: "OpenAI", model: "gpt-4o-mini", why: "치명위험 Top 3 형식 고정" },
  { feature: "사고사례", provider: "OpenAI", model: "gpt-4o-mini", why: "짧은 JSON 배열" },
  { feature: "교육자료", provider: "Gemini", model: "flash-lite", why: "출력이 길고 호출이 잦음" },
  { feature: "안전 도우미", provider: "Gemini", model: "flash-lite", why: "대화 히스토리·장문 답변" },
  { feature: "보건·근로자 의견", provider: "Gemini", model: "flash-lite", why: "짧은 분류, 단가 절감" },
  { feature: "안관비 분류", provider: "Gemini", model: "flash-lite", why: "OCR 원문이 수만 토큰" },
  { feature: "OCR·양식 분석", provider: "Gemini", model: "2.5 Flash", why: "이미지 1순위 제미나이, 키 실패 시 OpenAI 비전" },
];
