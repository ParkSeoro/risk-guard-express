import { supabase } from "@/integrations/supabase/client";

type CouncilProviderBody = {
  ok?: boolean;
  text?: string;
  message?: string;
};

/** Ask Claude or GPT through the server. The browser does not hold those keys. */
export async function askCouncilProvider(opts: {
  seat: "anthropic" | "openai";
  agenda: string;
  prior?: string;
}) {
  const { data, error } = await supabase.functions.invoke("council-provider", {
    body: {
      seat: opts.seat,
      agenda: opts.agenda,
      prior: opts.prior ?? "",
    },
  });
  if (error) throw new Error(error.message || "관제실 모델 호출에 실패했습니다.");
  const body = (data || null) as CouncilProviderBody | null;
  if (!body?.ok) throw new Error(body?.message || "관제실 모델 호출에 실패했습니다.");
  return body.text || "(응답 없음)";
}
