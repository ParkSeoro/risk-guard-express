import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HardHat, ShieldAlert, FileText, FileSignature, QrCode, ClipboardCheck,
  Users, ClipboardList, BookOpen, ArrowLeft, CheckCircle2, AlertTriangle,
  LogIn, Bot, Sparkles
} from "lucide-react";

export default function Manual() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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
        {/* Intro */}
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

        {/* Quick Start - Admin */}
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

        {/* Quick Start - Worker */}
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

        {/* Detailed Manual */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">메뉴별 상세 설명</h2>
          </div>

          <Accordion type="single" collapsible className="bg-card rounded-lg border">
            <Item icon={<ShieldAlert className="h-4 w-4" />} title="위험성평가">
              <ul className="list-disc pl-5 space-y-1">
                <li>좌측 메뉴 <b>안전관리 &gt; 위험성평가</b> 진입</li>
                <li><b>+ 새 평가</b> 클릭 → 작업명/공종 선택 → <b>AI 자동생성</b> 버튼</li>
                <li>3x3 위험도 매트릭스(빈도×강도)로 등급 산정 (저/중/고)</li>
                <li>'고' 등급은 <b>사진(전·후)</b> 첨부 후 결재 상신</li>
                <li>검증센터에서 누락 항목 자동 점검</li>
              </ul>
            </Item>

            <Item icon={<FileText className="h-4 w-4" />} title="작업계획서">
              <ul className="list-disc pl-5 space-y-1">
                <li>법정 11종 작업계획서 템플릿 제공 (굴착·고소·중량물 등)</li>
                <li>7개 탭 구조: 개요 / 장비 / 절차 / 위험 / 대책 / 첨부 / 결재</li>
                <li><b>AI 교육자료 자동생성 ON/OFF</b> 토글 — 켜두면 결재 후 TBM 자료까지 자동 생성</li>
              </ul>
            </Item>

            <Item icon={<FileSignature className="h-4 w-4" />} title="작업허가서">
              <ul className="list-disc pl-5 space-y-1">
                <li>화기·밀폐·고소·굴착 등 위험작업 사전 허가</li>
                <li>허가 승인 + 교육확인 + TBM 참여 + 입장완료 = <b>작업 가능</b></li>
                <li>조건 미충족 시 시스템에서 작업 차단</li>
              </ul>
            </Item>

            <Item icon={<QrCode className="h-4 w-4" />} title="TBM 일지">
              <ul className="list-disc pl-5 space-y-1">
                <li>당일 TBM 생성 → QR 발급 → 근로자가 스캔하여 참여 서명</li>
                <li>참여자 사진(셀카) 필수</li>
              </ul>
            </Item>

            <Item icon={<ClipboardCheck className="h-4 w-4" />} title="안전점검">
              <ul className="list-disc pl-5 space-y-1">
                <li>점검 템플릿 선택 → 항목별 적합/부적합 체크 + 사진 첨부</li>
                <li><b>부적합</b> 시 담당자에게 자동 알림 + 조치 요청 생성</li>
              </ul>
            </Item>

            <Item icon={<Users className="h-4 w-4" />} title="근로자 관리">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>회사 선택</b> 후 등록 QR 생성 → 인쇄하여 현장 게시</li>
                <li>근로자가 QR 스캔 시 회사가 자동 지정됨</li>
                <li>등록된 근로자 목록·소속·연락처 확인</li>
              </ul>
            </Item>

            <Item icon={<ClipboardList className="h-4 w-4" />} title="입퇴장 현황">
              <ul className="list-disc pl-5 space-y-1">
                <li>실시간 현장 인원 현황 확인</li>
                <li>입장/퇴장 시간, 전자서명 기록 조회</li>
                <li>일자별 / 회사별 필터 제공</li>
              </ul>
            </Item>

            <Item icon={<Bot className="h-4 w-4" />} title="AI 어시스턴트">
              <ul className="list-disc pl-5 space-y-1">
                <li>법령 질의, 위험요인 추천, 사고사례 검색</li>
                <li>한국 산업안전보건법/규칙 기준으로 응답</li>
              </ul>
            </Item>
          </Accordion>
        </section>

        {/* FAQ */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">자주 묻는 질문</h2>
          </div>
          <Accordion type="single" collapsible className="bg-card rounded-lg border">
            <FaqItem q="가입했는데 로그인이 안 돼요.">
              관리자 승인 대기 상태입니다. 현장 PM/안전관리자에게 승인 요청을 해주세요.
            </FaqItem>
            <FaqItem q="QR 스캔 후 회사를 선택하는 화면이 안 나와요.">
              관리자가 회사를 지정해 발급한 QR입니다. 자동으로 소속이 지정되니 그대로 진행하세요.
            </FaqItem>
            <FaqItem q="사진 업로드가 안 됩니다.">
              프로젝트 소속 확인 후 다시 시도하세요. 권한 문제가 지속되면 관리자에게 문의하세요.
            </FaqItem>
            <FaqItem q="작업 시작 버튼이 비활성화입니다.">
              ①허가 승인 ②교육 확인 ③TBM 참여 ④입장 완료 — 4가지 조건이 모두 충족되어야 합니다.
            </FaqItem>
            <FaqItem q="결재가 반려되면 어떻게 되나요?">
              사유와 함께 작성자에게 알림이 가며, 수정 후 재상신 시 버전이 증가합니다.
            </FaqItem>
          </Accordion>
        </section>

        {/* Footer */}
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
function Item({ icon, title, children }: any) {
  return (
    <AccordionItem value={title}>
      <AccordionTrigger className="px-4 hover:no-underline">
        <span className="flex items-center gap-2 font-semibold text-sm">{icon}{title}</span>
      </AccordionTrigger>
      <AccordionContent className="px-4 text-sm text-muted-foreground">{children}</AccordionContent>
    </AccordionItem>
  );
}
function FaqItem({ q, children }: any) {
  return (
    <AccordionItem value={q}>
      <AccordionTrigger className="px-4 hover:no-underline text-left text-sm font-semibold">Q. {q}</AccordionTrigger>
      <AccordionContent className="px-4 text-sm text-muted-foreground">A. {children}</AccordionContent>
    </AccordionItem>
  );
}
