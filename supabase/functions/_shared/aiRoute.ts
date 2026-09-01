/**
 * Cost-based provider routing.
 *
 * OpenAI gpt-4o-mini (~$0.15 / $0.60 per 1M) is cheaper than Gemini 2.5 Flash
 * (~$0.30 / $2.50) for typical short JSON. Gemini Flash-Lite (~$0.10 / $0.40)
 * plus 1M context is cheaper for long dumps, chat, and vision.
 *
 * Override any lane with AI_ROUTE_<purpose>=openai|gemini
 * e.g. AI_ROUTE_education=openai
 */

export type AiPurpose =
  | "work_plan"
  | "risk"
  | "permit_briefing"
  | "accident"
  | "education"
  | "assistant"
  | "health"
  | "safety_cost"
  | "permit_template"
  | "ocr"
  | "default";

export type AiProvider = "openai" | "gemini";

export const DEFAULT_AI_ROUTE: Record<AiPurpose, AiProvider> = {
  work_plan: "openai",
  risk: "openai",
  permit_briefing: "openai",
  accident: "openai",
  education: "gemini",
  assistant: "gemini",
  health: "gemini",
  safety_cost: "gemini",
  permit_template: "gemini",
  ocr: "gemini",
  default: "openai",
};

export function resolveAiProvider(purpose: AiPurpose | string | undefined): AiProvider {
  const key = (purpose && purpose in DEFAULT_AI_ROUTE ? purpose : "default") as AiPurpose;
  const envName = `AI_ROUTE_${key}`;
  const override = (Deno.env.get(envName) || "").trim().toLowerCase();
  if (override === "openai" || override === "gemini") return override;
  return DEFAULT_AI_ROUTE[key];
}

export function hasGeminiApiKey(): boolean {
  return !!(Deno.env.get("GEMINI_API_KEY") || "").trim();
}
