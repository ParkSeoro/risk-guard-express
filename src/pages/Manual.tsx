import { useState, useMemo } from "react";
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
import {
  HardHat, ShieldAlert, FileText, FileSignature, QrCode, ClipboardCheck,
  Users, ClipboardList, BookOpen, ArrowLeft, CheckCircle2, AlertTriangle,
  LogIn, Bot, Sparkles, Search, X, MessageSquare, Printer, PlayCircle,
  ReceiptText, Scale, ScanLine, Hand, PenLine
} from "lucide-react";

type Section = {
  id: string;
  icon: JSX.Element;
  title: string;
  keywords: string[];
  bullets: string[];
};

const SECTIONS: Section[] = [
  {
    id: "risk", icon: <ShieldAlert className="h-4 w-4" />, title: "위험성평가",
    keywords: ["위험성평가", "AI", "매트릭스", "등급", "사진", "결재"],
    bullets: [
      "좌측 메뉴 안전관리 > 위험성평가 진입",
      "+ 새 평가 클릭 → 작업명/공종 선택 → AI 자동생성 버튼",
      "3x3 위험도 매트릭스(빈도×강도)로 등급 산정 (저/중/고)",
      "'고' 등급은 사진(전·후) 첨부 후 결재 상신",
      "검증센터에서 누락 항목 자동 점검",
    ],
  },
  {
    id: "workplan", icon: <FileText className="h-4 w-4" />, title: "작업계획서",
    keywords: ["작업계획서", "템플릿", "AI", "교육자료", "TBM", "토글"],
    bullets: [
      "법정 11종 작업계획서 템플릿 제공 (굴착·고소·중량물 등)",
      "7개 탭 구조: 개요 / 장비 / 절차 / 위험 / 대책 / 첨부 / 결재",
      "AI 교육자료 자동생성 ON/OFF 토글 — 켜두면 결재 후 TBM 자료까지 자동 생성",
    ],
  },
  {
    id: "permit", icon: <FileSignature className="h-4 w-4" />, title: "작업허가서",
    keywords: ["작업허가", "허가서", "화기", "밀폐", "고소", "굴착", "결재", "승인"],
    bullets: [
      "화기·밀폐·고소·굴착 등 위험작업 사전 허가",
      "허가 승인 + 교육확인 + TBM 참여 + 입장완료 = 작업 가능",
      "조건 미충족 시 시스템에서 작업 차단",
    ],
  },
  {
    id: "tbm", icon: <QrCode className="h-4 w-4" />, title: "TBM 일지",
    keywords: ["TBM", "QR", "참여", "서명", "사진"],
    bullets: [
      "당일 TBM 생성 → QR 발급 → 근로자가 스캔하여 참여 서명",
      "참여자 사진(셀카) 필수",
    ],
  },
  {
    id: "inspection", icon: <ClipboardCheck className="h-4 w-4" />, title: "안전점검",
    keywords: ["점검", "부적합", "사진", "사진 업로드", "알림", "조치"],
    bullets: [
      "점검 템플릿 선택 → 항목별 적합/부적합 체크 + 사진 첨부",
      "부적합 시 담당자에게 자동 알림 + 조치 요청 생성",
    ],
  },
  {
    id: "workers", icon: <Users className="h-4 w-4" />, title: "근로자 관리",
    keywords: ["근로자", "QR", "등록", "회사", "협력사"],
    bullets: [
      "회사 선택 후 등록 QR 생성 → 인쇄하여 현장 게시",
      "근로자가 QR 스캔 시 회사가 자동 지정됨",
      "등록된 근로자 목록·소속·연락처 확인",
    ],
  },
  {
    id: "attendance", icon: <ClipboardList className="h-4 w-4" />, title: "입퇴장 현황",
    keywords: ["입장", "퇴장", "출입", "서명", "현황"],
    bullets: [
      "실시간 현장 인원 현황 확인",
      "입장/퇴장 시간, 전자서명 기록 조회",
      "일자별 / 회사별 필터 제공",
    ],
  },
  {
    id: "ai", icon: <Bot className="h-4 w-4" />, title: "AI 어시스턴트",
    keywords: ["AI", "법령", "질의", "사고사례"],
    bullets: [
      "법령 질의, 위험요인 추천, 사고사례 검색",
      "한국 산업안전보건법/규칙 기준으로 응답",
    ],
  },
];

type Faq = { q: string; a: string; keywords: string[] };
const FAQS: Faq[] = [
  { q: "가입했는데 로그인이 안 돼요.", a: "관리자 승인 대기 상태입니다. 현장 PM/안전관리자에게 승인 요청을 해주세요.", keywords: ["로그인", "가입", "승인"] },
  { q: "QR 스캔 후 회사를 선택하는 화면이 안 나와요.", a: "관리자가 회사를 지정해 발급한 QR입니다. 자동으로 소속이 지정되니 그대로 진행하세요.", keywords: ["QR", "회사", "근로자"] },
  { q: "사진 업로드가 안 됩니다.", a: "프로젝트 소속 확인 후 다시 시도하세요. 권한 문제가 지속되면 관리자에게 문의하세요.", keywords: ["사진", "사진 업로드", "권한", "오류"] },
  { q: "작업 시작 버튼이 비활성화입니다.", a: "①허가 승인 ②교육 확인 ③TBM 참여 ④입장 완료 — 4가지 조건이 모두 충족되어야 합니다.", keywords: ["작업", "허가", "TBM", "입장"] },
  { q: "결재가 반려되면 어떻게 되나요?", a: "사유와 함께 작성자에게 알림이 가며, 수정 후 재상신 시 버전이 증가합니다.", keywords: ["결재", "반려", "재상신"] },
];

const QUICK = ["QR", "로그인", "결재", "사진 업로드", "TBM", "근로자", "허가서"];

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

const matches = (q: string, ...fields: string[]) =>
  !q || fields.some(f => f.toLowerCase().includes(q.toLowerCase()));

export default function Manual() {
  const [query, setQuery] = useState("");
  const q = query.trim();

  const filteredSections = useMemo(
    () => SECTIONS.filter(s => matches(q, s.title, s.keywords.join(" "), s.bullets.join(" "))),
    [q]
  );
  const filteredFaqs = useMemo(
    () => FAQS.filter(f => matches(q, f.q, f.a, f.keywords.join(" "))),
    [q]
  );
  const noResults = q && filteredSections.length === 0 && filteredFaqs.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">사용 설명서</h1>
              <p className="text-xs text-muted-foreground">안전관리시스템 · 관리자 & 근로자용</p>
            </div>
          </div>
          <Link to="/auth">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> 로그인
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Search */}
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="키워드 검색 (예: QR, 로그인, 결재, 사진 업로드)"
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
              {QUICK.map(k => (
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
                "<b>{q}</b>" 검색 결과 — 메뉴 {filteredSections.length}건 · FAQ {filteredFaqs.length}건
              </p>
            )}
          </CardContent>
        </Card>

        {!q && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  이 시스템은 무엇인가요?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm leading-relaxed">
                <p>대한민국 산업안전보건법 기준의 <b>건설현장 안전관리 통합 플랫폼</b>입니다.</p>
                <p>위험성평가 · 작업계획서 · 작업허가 · TBM · 교육 · 점검 · 근로자 입퇴장까지 한 화면에서 처리할 수 있습니다.</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary">관리자(PM/안전관리자)</Badge>
                  <Badge variant="secondary">근로자</Badge>
                  <Badge variant="secondary">원청/협력사</Badge>
                </div>
              </CardContent>
            </Card>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <HardHat className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">관리자 빠른 시작 (5단계)</h2>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                {[
                  { n: 1, t: "회원가입/로그인", d: "이메일로 가입 후 관리자 승인" },
                  { n: 2, t: "프로젝트 선택", d: "소속 현장 선택" },
                  { n: 3, t: "위험성평가 작성", d: "AI 자동생성 + 검토" },
                  { n: 4, t: "작업계획서/허가서", d: "결재 상신" },
                  { n: 5, t: "근로자 QR 발급", d: "현장 게시" },
                ].map(s => (
                  <Card key={s.n}>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold text-primary mb-1">{s.n}</div>
                      <div className="font-semibold text-sm">{s.t}</div>
                      <div className="text-xs text-muted-foreground mt-1">{s.d}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">근로자 빠른 시작 (3초 흐름)</h2>
              </div>
              <Card className="bg-accent/5">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-center">
                    <Step icon={<QrCode className="h-6 w-6" />} title="① QR 스캔" desc="현장 입구 QR" />
                    <Arrow />
                    <Step icon={<LogIn className="h-6 w-6" />} title="② 간편 등록" desc="이름 + 전화번호" />
                    <Arrow />
                    <Step icon={<CheckCircle2 className="h-6 w-6" />} title="③ 확인/서명" desc="위험성평가·교육·TBM" />
                    <Arrow />
                    <Step icon={<HardHat className="h-6 w-6" />} title="④ 입장" desc="작업 시작" />
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-4">
                    ※ 작업 종료 시 같은 QR로 <b>퇴장 + 무재해 확인 + 전자서명</b>을 진행합니다.
                  </p>
                </CardContent>
              </Card>
            </section>
          </>
        )}

        {/* Sections */}
        {filteredSections.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">메뉴별 상세 설명</h2>
            </div>
            <Accordion type="multiple" defaultValue={q ? filteredSections.map(s => s.id) : []} className="bg-card rounded-lg border">
              {filteredSections.map(s => (
                <AccordionItem key={s.id} value={s.id}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <span className="flex items-center gap-2 font-semibold text-sm">
                      {s.icon}{highlight(s.title, q)}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 text-sm text-muted-foreground">
                    <ul className="list-disc pl-5 space-y-1">
                      {s.bullets.map((b, i) => <li key={i}>{highlight(b, q)}</li>)}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}

        {/* FAQ */}
        {filteredFaqs.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">자주 묻는 질문</h2>
            </div>
            <Accordion type="multiple" defaultValue={q ? filteredFaqs.map(f => f.q) : []} className="bg-card rounded-lg border">
              {filteredFaqs.map(f => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="px-4 hover:no-underline text-left text-sm font-semibold">
                    Q. {highlight(f.q, q)}
                  </AccordionTrigger>
                  <AccordionContent className="px-4 text-sm text-muted-foreground">
                    A. {highlight(f.a, q)}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}

        {noResults && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              "{q}" 에 대한 결과가 없습니다. 다른 키워드를 입력해 보세요.
            </CardContent>
          </Card>
        )}

        <InquiryForm />

        <div className="text-center pt-4 pb-8 text-xs text-muted-foreground">
          본 메뉴얼은 누구나 열람할 수 있습니다 · 시스템 관련 문의는 현장 안전관리자에게 연락 바랍니다.
          <div className="mt-3">
            <Link to="/auth"><Button size="sm">시스템 시작하기</Button></Link>
          </div>
        </div>
      </div>
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

function Step({ icon, title, desc }: any) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center">{icon}</div>
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}
function Arrow() {
  return <div className="text-muted-foreground hidden md:block">→</div>;
}
