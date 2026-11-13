import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2 } from "lucide-react";
import { POSITION_LABELS } from "@/lib/projectPositions";
import { toast } from "sonner";

export function RoleLegalAiBriefing({
  projectId,
  position,
  companyType,
}: {
  projectId: string | null | undefined;
  position: string | null | undefined;
  companyType: string | null | undefined;
}) {
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<string>("");

  const posLabel = (position && POSITION_LABELS[position]) || position || "현장 담당자";

  const handleGenerate = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const prompt = `내 직책은 "${posLabel}" (소속 구분: ${companyType || "현장"})입니다.
대한민국 산업안전보건법·중대재해처벌법·건설기술진흥법 역할 경계에 맞춰 오늘 이 직책이 꼭 챙겨야 할 법적 할 일 3가지만 3줄로 간결히 알려주세요. (타 직책 업무를 섞지 마세요)`;
      const { data, error } = await supabase.functions.invoke("safety-assistant", {
        body: { message: prompt, projectId, compact: true },
      });
      if (error || !data?.reply) {
        toast.warning("AI 직무 브리핑을 불러오지 못했습니다. 아래 체크리스트를 확인하세요.");
        return;
      }
      setReply(String(data.reply));
    } catch {
      toast.warning("AI 직무 브리핑을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>오늘 내 직무 법적 할 일</span>
            <Badge variant="outline" className="text-[10px]">{posLabel}</Badge>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={loading || !projectId} onClick={handleGenerate}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {reply ? "다시 요약" : "AI 직무 브리핑"}
          </Button>
        </div>
        {reply && <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{reply}</p>}
      </CardContent>
    </Card>
  );
}
