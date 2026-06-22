/**
 * 유해요인조사 익명 응답 페이지 — QR 토큰으로 접근.
 * /health/survey/:token
 */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

// 산안법 시행규칙 별표 KOSHA 근골격계/직무스트레스/뇌심혈관 표준 문항 (요약본)
const QUESTIONS_BY_TYPE: Record<string, { id: string; text: string; options: { v: number; label: string }[] }[]> = {
  근골격계: [
    { id: "neck", text: "최근 1년간 목·어깨에 통증/뻐근함이 있었습니까?", options: [{ v: 0, label: "없음" }, { v: 5, label: "가끔" }, { v: 10, label: "자주" }, { v: 20, label: "항상" }] },
    { id: "back", text: "허리에 통증/저림이 있었습니까?", options: [{ v: 0, label: "없음" }, { v: 5, label: "가끔" }, { v: 10, label: "자주" }, { v: 20, label: "항상" }] },
    { id: "arm", text: "팔꿈치·손목·손가락에 저림/통증이 있었습니까?", options: [{ v: 0, label: "없음" }, { v: 5, label: "가끔" }, { v: 10, label: "자주" }, { v: 20, label: "항상" }] },
    { id: "leg", text: "무릎·다리·발에 통증/부종이 있었습니까?", options: [{ v: 0, label: "없음" }, { v: 5, label: "가끔" }, { v: 10, label: "자주" }, { v: 20, label: "항상" }] },
    { id: "repeat", text: "반복적 동작/중량물 취급이 하루 2시간 이상입니까?", options: [{ v: 0, label: "아니오" }, { v: 10, label: "예" }] },
  ],
  뇌심혈관: [
    { id: "bp", text: "고혈압/당뇨/고지혈증을 진단받은 적 있습니까?", options: [{ v: 0, label: "아니오" }, { v: 15, label: "예" }] },
    { id: "smoke", text: "현재 흡연 중입니까?", options: [{ v: 0, label: "아니오" }, { v: 10, label: "예" }] },
    { id: "family", text: "직계가족 중 심·뇌혈관질환 병력이 있습니까?", options: [{ v: 0, label: "아니오" }, { v: 10, label: "예" }] },
    { id: "overwork", text: "주 평균 52시간 이상 근무합니까?", options: [{ v: 0, label: "아니오" }, { v: 20, label: "예" }] },
    { id: "night", text: "야간/교대 근무를 정기적으로 합니까?", options: [{ v: 0, label: "아니오" }, { v: 15, label: "예" }] },
  ],
  직무스트레스: [
    { id: "demand", text: "업무량이 과도하다고 느낍니까?", options: [{ v: 0, label: "전혀" }, { v: 5, label: "보통" }, { v: 10, label: "자주" }, { v: 15, label: "항상" }] },
    { id: "control", text: "업무에 대한 자율성/결정권이 충분합니까?", options: [{ v: 15, label: "전혀 없음" }, { v: 10, label: "부족" }, { v: 5, label: "보통" }, { v: 0, label: "충분" }] },
    { id: "support", text: "동료/상사로부터 지원을 받고 있다고 느낍니까?", options: [{ v: 15, label: "전혀" }, { v: 10, label: "부족" }, { v: 5, label: "보통" }, { v: 0, label: "충분" }] },
    { id: "future", text: "직장의 장래·고용이 안정적이라고 느낍니까?", options: [{ v: 15, label: "불안" }, { v: 5, label: "보통" }, { v: 0, label: "안정" }] },
  ],
  감정노동: [
    { id: "emotion", text: "고객/타직원과의 갈등 상황을 자주 겪습니까?", options: [{ v: 0, label: "없음" }, { v: 5, label: "가끔" }, { v: 10, label: "자주" }, { v: 15, label: "항상" }] },
    { id: "mask", text: "감정을 숨기고 일해야 하는 경우가 잦습니까?", options: [{ v: 0, label: "없음" }, { v: 5, label: "가끔" }, { v: 10, label: "자주" }, { v: 15, label: "항상" }] },
    { id: "support", text: "감정노동에 대한 회사의 보호조치가 있다고 느낍니까?", options: [{ v: 15, label: "전혀" }, { v: 5, label: "보통" }, { v: 0, label: "충분" }] },
  ],
};

export default function HazardSurveyResponse() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<{ type: string; title: string; survey_date: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState({ name: "", phone: "", company: "" });
  const [scores, setScores] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ risk_level: string; total_score: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { data, error: rpcErr } = await supabase.rpc("get_hazard_survey_public", { _qr_token: token });
        if (rpcErr) throw rpcErr;
        const r = data as any;
        if (!r?.ok) {
          setError(r?.error === "CLOSED" ? "이 설문은 종료되었습니다." : "유효하지 않은 설문 링크입니다.");
        } else {
          setSurvey({ type: r.type, title: r.title, survey_date: r.survey_date });
        }
      } catch (e: any) {
        setError("설문 정보를 불러올 수 없습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const questions = survey ? QUESTIONS_BY_TYPE[survey.type] || [] : [];
  const allAnswered = questions.every((q) => scores[q.id] !== undefined);

  const submit = async () => {
    if (!worker.name.trim()) { toast.error("성명을 입력해주세요"); return; }
    if (!allAnswered) { toast.error("모든 문항에 응답해주세요"); return; }
    setSubmitting(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("submit_hazard_survey_response", {
        _qr_token: token,
        _worker_name: worker.name,
        _worker_phone: worker.phone || "",
        _company_name: worker.company || "",
        _scores: scores as any,
      });
      if (rpcErr) throw rpcErr;
      const r = data as any;
      if (!r?.ok) { toast.error(`제출 실패: ${r?.error || "알 수 없음"}`); return; }
      setResult({ risk_level: r.risk_level, total_score: r.total_score });
    } catch (e: any) {
      toast.error("제출 중 오류가 발생했습니다");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-10 text-center text-muted-foreground">로딩 중…</div>;
  if (error) return (
    <div className="p-10 max-w-md mx-auto text-center space-y-3">
      <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />
      <p className="text-lg font-semibold">{error}</p>
      <Button variant="outline" onClick={() => navigate("/")}>홈으로</Button>
    </div>
  );

  if (result) {
    const RiskBadge = result.risk_level === "high"
      ? <span className="px-3 py-1 rounded bg-destructive text-destructive-foreground font-semibold">고위험</span>
      : result.risk_level === "medium"
      ? <span className="px-3 py-1 rounded bg-yellow-500 text-white font-semibold">중위험</span>
      : <span className="px-3 py-1 rounded bg-green-600 text-white font-semibold">정상</span>;
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto text-green-600 mb-2" />
            <CardTitle>응답이 제출되었습니다</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div>{RiskBadge}</div>
            <p className="text-sm text-muted-foreground">
              총점: <strong>{result.total_score}점</strong>
              {result.risk_level === "high" && <><br />고위험으로 분류되었습니다. 보건관리자가 곧 면담을 안내할 예정입니다.</>}
              {result.risk_level === "medium" && <><br />주의 단계입니다. 작업환경 개선 및 정기 점검을 권장합니다.</>}
              {result.risk_level === "low" && <><br />현재 위험도는 낮습니다. 정기 점검에 계속 참여해주세요.</>}
            </p>
            <p className="text-xs text-muted-foreground">개인정보는 익명 통계로만 사용됩니다.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <CardTitle className="text-lg">{survey?.title}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {survey?.type} 유해요인조사 · {survey?.survey_date}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            ※ 산업안전보건법 제39조에 따라 실시되는 조사입니다. 응답은 익명 통계로만 사용됩니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>성명 *</Label>
              <Input value={worker.name} onChange={(e) => setWorker({ ...worker, name: e.target.value })} />
            </div>
            <div>
              <Label>연락처</Label>
              <Input value={worker.phone} onChange={(e) => setWorker({ ...worker, phone: e.target.value })} placeholder="선택" />
            </div>
            <div>
              <Label>소속 회사</Label>
              <Input value={worker.company} onChange={(e) => setWorker({ ...worker, company: e.target.value })} placeholder="선택" />
            </div>
          </div>
        </CardContent>
      </Card>

      {questions.map((q, idx) => (
        <Card key={q.id}>
          <CardContent className="pt-5 space-y-3">
            <p className="font-medium">{idx + 1}. {q.text}</p>
            <RadioGroup
              value={scores[q.id]?.toString() ?? ""}
              onValueChange={(v) => setScores({ ...scores, [q.id]: Number(v) })}
            >
              {q.options.map((opt) => (
                <div key={opt.label} className="flex items-center space-x-2">
                  <RadioGroupItem value={opt.v.toString()} id={`${q.id}-${opt.label}`} />
                  <Label htmlFor={`${q.id}-${opt.label}`} className="font-normal cursor-pointer">{opt.label}</Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>
      ))}

      <Button className="w-full" size="lg" onClick={submit} disabled={submitting || !allAnswered}>
        {submitting ? "제출 중…" : "응답 제출"}
      </Button>
    </div>
  );
}
