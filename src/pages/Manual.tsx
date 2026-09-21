import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { restartTutorial } from "@/components/TutorialOverlay";
import { useAuth } from "@/contexts/AuthContext";
import {
  HardHat, ShieldAlert, FileText, FileSignature, QrCode, ClipboardCheck,
  Users, ClipboardList, BookOpen, ArrowLeft, CheckCircle2, AlertTriangle,
  Search, X, MessageSquare, Printer, PlayCircle,
  ReceiptText, Bell, Map, OctagonAlert, GraduationCap, HeartPulse,
  AlertOctagon, FileCheck, ListTodo,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { calculateRiskGrade, GRADES } from "@/lib/riskGrade";
import {
  MANUAL_AUDIENCE_OPTIONS,
  type ManualAudience,
  clearStoredManualAudience,
  readStoredManualAudience,
  resolveManualAudience,
  writeStoredManualAudience,
} from "@/lib/manualAudience";
import {
  ADMIN_FLOW_STEPS,
  filterManualFaqs,
  filterManualSections,
  filterManualTerms,
  MANUAL_QUICK_SEARCH,
  SUPERVISOR_FLOW_STEPS,
  WORKER_DAY_STEPS,
  type ManualSection,
} from "@/lib/manualContent";

const ICONS: Record<string, LucideIcon> = {
  HardHat,
  ShieldAlert,
  FileText,
  FileSignature,
  QrCode,
  ClipboardCheck,
  Users,
  ClipboardList,
  ReceiptText,
  Bell,
  Map,
  OctagonAlert,
  GraduationCap,
  HeartPulse,
  AlertOctagon,
  FileCheck,
  ListTodo,
};

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent/30 text-foreground rounded px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function audienceLabel(ids: ManualAudience[]): string {
  return ids
    .map((id) => MANUAL_AUDIENCE_OPTIONS.find((o) => o.id === id)?.label || id)
    .join(" · ");
}

export default function Manual({ embedded = false }: { embedded?: boolean }) {
  const { user, roles } = useAuth();
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<ManualAudience | null>(null);
  const q = query.trim();
  const searchAll = Boolean(q);

  useEffect(() => {
    setAudience(resolveManualAudience(readStoredManualAudience(), roles));
  }, [roles]);

  const pickAudience = (next: ManualAudience) => {
    setAudience(next);
    writeStoredManualAudience(next);
  };

  const filteredSections = useMemo(
    () => filterManualSections(q, audience, searchAll),
    [q, audience, searchAll],
  );
  const filteredFaqs = useMemo(
    () => filterManualFaqs(q, audience, searchAll),
    [q, audience, searchAll],
  );
  const filteredTerms = useMemo(() => filterManualTerms(q), [q]);
  const noResults = q && filteredSections.length === 0 && filteredFaqs.length === 0 && filteredTerms.length === 0;
  const suggested = user ? resolveManualAudience(null, roles) : null;

  return (
    <div className={embedded ? "bg-background" : "min-h-screen bg-background"} data-testid="manual-page">
      {!embedded && (
        <div className="border-b bg-card">
          <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold">사용 설명서</h1>
                <p className="text-xs text-muted-foreground">역할을 고르면 자기 설명만 보입니다</p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => { restartTutorial(); window.location.assign("/"); }}>
                <PlayCircle className="h-4 w-4 mr-1" /> 따라하기 다시 보기
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1" /> PDF 저장/인쇄
              </Button>
              <Link to="/auth">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1" /> 로그인
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className={embedded ? "px-4 pb-8 space-y-6" : "max-w-5xl mx-auto px-4 py-8 space-y-8"}>
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="키워드 검색 (예: GPS, 출근, 결재, 가능성)"
                className="pl-9 pr-9 h-11 text-base"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                  aria-label="검색어 지우기"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground self-center mr-1">빠른 검색:</span>
              {MANUAL_QUICK_SEARCH.map((k) => (
                <button
                  key={k}
                  onClick={() => setQuery(k)}
                  className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {k}
                </button>
              ))}
            </div>
            {q && (
              <p className="text-xs text-muted-foreground">
                「{q}」 전체 검색 — 메뉴 {filteredSections.length}건 · FAQ {filteredFaqs.length}건 · 용어 {filteredTerms.length}건
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2" data-testid="manual-role-bar">
          <span className="text-xs text-muted-foreground">역할</span>
          {audience ? (
            <>
              <Badge variant="secondary" data-testid={`manual-audience-${audience}`}>
                {MANUAL_AUDIENCE_OPTIONS.find((o) => o.id === audience)?.label}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                data-testid="manual-switch-role"
                onClick={() => {
                  clearStoredManualAudience();
                  setAudience(null);
                }}
              >
                역할 바꾸기
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">아래에서 고르면 자기 설명만 펼칩니다</span>
          )}
        </div>

        {!audience && (
          <section data-testid="manual-role-gate">
            <h2 className="text-lg font-bold mb-3">나는 누구인가요?</h2>
            {suggested && (
              <p className="text-xs text-muted-foreground mb-2">
                로그인 역할로 「{MANUAL_AUDIENCE_OPTIONS.find((o) => o.id === suggested)?.label}」을 제안합니다.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              {MANUAL_AUDIENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`manual-pick-${opt.id}`}
                  onClick={() => pickAudience(opt.id)}
                  className={`text-left rounded-lg border p-4 hover:border-primary hover:bg-accent/20 ${
                    suggested === opt.id ? "border-primary" : ""
                  }`}
                >
                  <div className="font-semibold">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{opt.hint}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {!q && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                이 시스템은 무엇인가요?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed">
              <p>대한민국 산업안전보건법 기준의 <b>건설현장 안전관리 통합 플랫폼</b>입니다.</p>
              <p>위험성평가부터 허가·TBM·출퇴근·점검·비용까지, 역할에 맞는 화면만 쓰면 됩니다.</p>
            </CardContent>
          </Card>
        )}

        {!q && audience === "worker" && (
          <section data-testid="manual-worker-flow">
            <h2 className="text-lg font-bold mb-3">근로자 — 하루 흐름</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {WORKER_DAY_STEPS.map((s) => (
                <Card key={s.n} className="border-2 border-primary/20">
                  <CardContent className="p-5 text-center space-y-2">
                    <div className="text-xs font-bold text-primary tracking-wider">STEP {s.n}</div>
                    <div className="text-lg font-bold">{s.title}</div>
                    <div className="text-sm text-muted-foreground">{s.desc}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {!q && audience === "supervisor" && (
          <section data-testid="manual-supervisor-flow">
            <h2 className="text-lg font-bold mb-3">관리감독자 — 작성 순서</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {SUPERVISOR_FLOW_STEPS.map((s) => (
                <Card key={s.n}>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-primary mb-1">{s.n}</div>
                    <div className="font-semibold text-sm">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {!q && audience === "admin" && (
          <section data-testid="manual-admin-flow">
            <h2 className="text-lg font-bold mb-3">안전관리자·관리자 — 업무 순서</h2>
            <div className="grid gap-2 md:grid-cols-8 text-center text-xs">
              {ADMIN_FLOW_STEPS.map((s) => (
                <div key={s.n} className="flex flex-col items-center gap-1 p-2 rounded-md bg-muted/40">
                  <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                    {s.n}
                  </div>
                  <div className="font-semibold">{s.title}</div>
                  <div className="text-muted-foreground">{s.desc}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {filteredSections.length > 0 && audience && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">{q ? "검색된 설명" : "설명"}</h2>
            </div>
            <Accordion type="multiple" defaultValue={q ? filteredSections.map((s) => s.id) : []} className="bg-card rounded-lg border">
              {filteredSections.map((s) => (
                <SectionItem key={s.id} section={s} query={q} selected={audience} />
              ))}
            </Accordion>
          </section>
        )}

        {q && !audience && filteredSections.length > 0 && (
          <section>
            <h2 className="text-lg font-bold mb-3">검색된 설명</h2>
            <Accordion type="multiple" defaultValue={filteredSections.map((s) => s.id)} className="bg-card rounded-lg border">
              {filteredSections.map((s) => (
                <SectionItem key={s.id} section={s} query={q} selected={null} />
              ))}
            </Accordion>
          </section>
        )}

        {filteredFaqs.length > 0 && (audience || q) && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">자주 묻는 질문</h2>
            </div>
            <Accordion type="multiple" defaultValue={q ? filteredFaqs.map((f) => f.id) : []} className="bg-card rounded-lg border">
              {filteredFaqs.map((f) => (
                <AccordionItem key={f.id} value={f.id}>
                  <AccordionTrigger className="px-4 hover:no-underline text-left text-sm font-semibold">
                    <span className="flex flex-wrap items-center gap-2">
                      Q. {highlight(f.q, q)}
                      {q && audience && !f.audience.includes(audience) && (
                        <Badge variant="outline" className="text-[10px] font-normal">{audienceLabel(f.audience)}</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 text-sm text-muted-foreground">
                    A. {highlight(f.a, q)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}

        {(audience || q) && filteredTerms.length > 0 && (
          <section data-testid="manual-glossary">
            <h2 className="text-lg font-bold mb-3">용어 사전</h2>
            <Card>
              <CardContent className="p-0 divide-y">
                {filteredTerms.map((t) => (
                  <div key={t.term} className="px-4 py-3">
                    <div className="text-sm font-semibold">{highlight(t.term, q)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{highlight(t.plain, q)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {noResults && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              「{q}」에 대한 결과가 없습니다. 다른 키워드를 입력해 보세요.
            </CardContent>
          </Card>
        )}

        <div className="print:hidden">
          <InquiryForm />
        </div>

        <div className="text-center pt-4 pb-8 text-xs text-muted-foreground">
          본 설명서는 로그인 없이 열 수 있습니다 · 문의는 현장 안전관리자에게
          <div className="mt-3">
            <Link to="/auth"><Button size="sm">시스템 시작하기</Button></Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionItem({
  section,
  query,
  selected,
}: {
  section: ManualSection;
  query: string;
  selected: ManualAudience | null;
}) {
  const Icon = ICONS[section.icon] || FileText;
  const foreign = selected && !section.audience.includes(selected);
  return (
    <AccordionItem value={section.id}>
      <AccordionTrigger className="px-4 hover:no-underline">
        <span className="flex items-center gap-2 font-semibold text-sm">
          <Icon className="h-4 w-4" />
          {highlight(section.title, query)}
          {foreign && (
            <Badge variant="outline" className="text-[10px] font-normal">{audienceLabel(section.audience)}</Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-4 text-sm text-muted-foreground space-y-3">
        <ul className="list-disc pl-5 space-y-1">
          {section.bullets.map((b, i) => <li key={i}>{highlight(b, query)}</li>)}
        </ul>
        {section.showMatrix && <RiskMatrixTable />}
      </AccordionContent>
    </AccordionItem>
  );
}

function RiskMatrixTable() {
  return (
    <div className="overflow-x-auto" data-testid="manual-risk-matrix">
      <p className="text-xs mb-2">가능성(행) × 중대성(열) → 위험도 상/중/하</p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="border p-1.5 bg-muted">가능성 \\ 중대성</th>
            {GRADES.map((s) => (
              <th key={s} className="border p-1.5 bg-muted">중대성 {s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRADES.map((l) => (
            <tr key={l}>
              <th className="border p-1.5 bg-muted text-left">가능성 {l}</th>
              {GRADES.map((s) => {
                const grade = calculateRiskGrade(l, s);
                const tone = grade === "상" ? "bg-red-100" : grade === "중" ? "bg-yellow-100" : "bg-green-100";
                return (
                  <td key={s} className={`border p-1.5 text-center font-semibold ${tone}`}>{grade}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InquiryForm() {
  const [category, setCategory] = useState("error");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const msg = message.trim();
    if (msg.length < 5) {
      toast({ title: "내용을 5자 이상 입력해 주세요.", variant: "destructive" });
      return;
    }
    if (msg.length > 2000) {
      toast({ title: "내용은 2000자 이내로 입력해 주세요.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).from("manual_inquiries").insert({
      category,
      name: name.trim().slice(0, 100) || null,
      contact: contact.trim().slice(0, 200) || null,
      message: msg,
      page_url: typeof window !== "undefined" ? window.location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "전송 실패", description: error.message, variant: "destructive" });
      return;
    }
    setDone(true);
    setMessage(""); setName(""); setContact("");
  };

  return (
    <section id="inquiry">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">오류 신고 / 문의하기</h2>
      </div>
      <Card>
        <CardContent className="p-5 space-y-3">
          {done ? (
            <div className="text-center py-8 space-y-3">
              <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
              <p className="font-semibold">접수되었습니다. 감사합니다!</p>
              <p className="text-xs text-muted-foreground">검토 후 필요 시 입력하신 연락처로 회신드립니다.</p>
              <Button variant="outline" size="sm" onClick={() => setDone(false)}>다시 작성</Button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label className="text-xs">분류 *</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">오류 신고</SelectItem>
                      <SelectItem value="question">사용 문의</SelectItem>
                      <SelectItem value="suggestion">기능 제안</SelectItem>
                      <SelectItem value="other">기타</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">이름 (선택)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="홍길동" />
                </div>
                <div>
                  <Label className="text-xs">연락처/이메일 (선택)</Label>
                  <Input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder="010-0000-0000 또는 email@..." />
                </div>
              </div>
              <div>
                <Label className="text-xs">내용 * <span className="text-muted-foreground">({message.length}/2000)</span></Label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                  rows={5}
                  placeholder="발생 위치, 재현 방법, 화면에 나타난 메시지 등을 자세히 적어주세요."
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={submit} disabled={submitting || message.trim().length < 5}>
                  {submitting ? "전송 중..." : "신고 보내기"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                ※ 입력하신 정보는 시스템 관리자(마스터)만 열람할 수 있으며, 문의 처리 목적으로만 사용됩니다.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
