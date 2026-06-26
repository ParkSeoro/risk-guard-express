import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  HardHat, ShieldAlert, ClipboardCheck, QrCode, FileSignature,
  Activity, MapPin, ArrowRight, CheckCircle2, AlertTriangle, Users,
} from "lucide-react";

/**
 * 통합 안전관리시스템 — 공개 랜딩 페이지
 * 산업 블루프린트 미학: 딥 네이비 + 세이프티 오렌지 + 해저드 테이프 스트라이프
 */
export default function Index() {
  return (
    <div className="min-h-screen bg-[hsl(220,55%,12%)] text-[hsl(210,30%,92%)] overflow-x-hidden">
      {/* Hazard-tape top stripe */}
      <div
        className="h-2 w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, hsl(25 95% 53%) 0 14px, hsl(220 60% 8%) 14px 28px)",
        }}
      />

      {/* Top nav */}
      <header className="border-b border-[hsl(220,45%,22%)]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-[hsl(25,95%,53%)] flex items-center justify-center shadow-[0_0_24px_-4px_hsl(25_95%_53%/0.6)]">
              <HardHat className="h-6 w-6 text-[hsl(220,60%,12%)]" />
            </div>
            <div className="leading-tight">
              <div className="text-xs uppercase tracking-[0.2em] text-[hsl(25,95%,60%)]">
                Safenex / 안전관리
              </div>
              <div className="font-black text-lg tracking-tight">통합 안전관리시스템</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" className="text-[hsl(210,30%,92%)] hover:bg-[hsl(220,45%,22%)] hover:text-white">
                로그인
              </Button>
            </Link>
            <Link to="/auth">
              <Button className="bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,48%)] text-[hsl(220,60%,12%)] font-bold">
                시작하기 <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        {/* Blueprint grid background */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(hsl(210 30% 92%) 1px, transparent 1px), linear-gradient(90deg, hsl(210 30% 92%) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-28 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[hsl(220,45%,22%)] border border-[hsl(25,95%,53%)]/40 text-xs font-mono uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(25,95%,53%)] animate-pulse" />
              ISO 45001 · 산업안전보건법 대응
            </div>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight">
              현장의 안전을<br />
              <span className="text-[hsl(25,95%,53%)]">시스템</span>으로<br />
              운영합니다.
            </h1>
            <p className="text-lg text-[hsl(210,20%,72%)] max-w-xl leading-relaxed">
              위험성평가 · 작업허가 · TBM · 근로자 출입 · 법적업무를 하나의 흐름으로 묶은
              건설/플랜트 전용 통합 안전관리 플랫폼.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/auth">
                <Button size="lg" className="bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,48%)] text-[hsl(220,60%,12%)] font-bold h-14 px-7 text-base">
                  무료 데모 시작 <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
              <Link to="/manual">
                <Button size="lg" variant="outline" className="h-14 px-7 text-base border-[hsl(220,45%,32%)] bg-transparent text-[hsl(210,30%,92%)] hover:bg-[hsl(220,45%,22%)] hover:text-white">
                  도입 가이드
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-6 pt-4 text-sm text-[hsl(210,20%,72%)]">
              {["AI 위험성평가", "전자결재 5단계", "QR 출입·TBM", "모바일 현장 점검"].map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[hsl(25,95%,53%)]" /> {t}
                </div>
              ))}
            </div>
          </div>

          {/* Right: capabilities panel (no fake live data on public landing) */}
          <div className="lg:col-span-5">
            <div className="relative rounded-2xl border border-[hsl(220,45%,28%)] bg-[hsl(220,55%,10%)] p-6 shadow-2xl">
              <div className="absolute -top-3 left-6 px-3 py-0.5 bg-[hsl(25,95%,53%)] text-[hsl(220,60%,12%)] text-[10px] font-black tracking-widest rounded">
                PLATFORM SCOPE
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="위험성평가" value="4" sub="종" icon={ShieldAlert} tone="brand" />
                <StatCard label="작업계획서" value="11" sub="종" icon={ClipboardCheck} tone="ok" />
                <StatCard label="법정업무" value="22" sub="항" icon={FileSignature} tone="brand" />
                <StatCard label="전자결재" value="5" sub="단계" icon={CheckCircle2} tone="ok" />
              </div>
              <div className="mt-4 pt-4 border-t border-[hsl(220,45%,22%)] space-y-2">
                {[
                  { t: "산업안전보건법 대응", s: "위험성평가·작업계획서·법정 To-Do 자동화", c: "hsl(145 63% 50%)" },
                  { t: "AI 위험성평가 엔진", s: "공정·작업별 자동 생성 + 검증센터 보완", c: "hsl(25 95% 53%)" },
                  { t: "QR 출입 · TBM · 사고/비상", s: "현장 데이터가 결재·감사 로그로 연결", c: "hsl(210 90% 60%)" },
                ].map(e => (
                  <div key={e.t} className="flex items-start gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full mt-1.5 shrink-0" style={{ background: e.c }} />
                    <div className="flex-1">
                      <div className="font-semibold text-[hsl(210,30%,95%)]">{e.t}</div>
                      <div className="text-[hsl(210,15%,60%)]">{e.s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

      </section>

      {/* Modules */}
      <section className="bg-[hsl(220,60%,9%)] border-y border-[hsl(220,45%,22%)] py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-14 flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-[0.3em] text-[hsl(25,95%,60%)] mb-3">
                — MODULES
              </div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight">
                여섯 개의 모듈, 하나의 흐름.
              </h2>
            </div>
            <p className="max-w-md text-[hsl(210,20%,72%)]">
              위험성평가에서 출입통제까지. 각 모듈은 독립적으로 동작하며 결재·감사 로그로 연결됩니다.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-[hsl(220,45%,22%)] border border-[hsl(220,45%,22%)] rounded-lg overflow-hidden">
            {MODULES.map((m, i) => (
              <div key={m.title}
                className="bg-[hsl(220,55%,11%)] p-7 hover:bg-[hsl(220,55%,13%)] transition group">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-lg bg-[hsl(220,45%,22%)] flex items-center justify-center group-hover:bg-[hsl(25,95%,53%)] transition">
                    <m.icon className="h-6 w-6 text-[hsl(25,95%,60%)] group-hover:text-[hsl(220,60%,12%)] transition" />
                  </div>
                  <span className="font-mono text-[10px] text-[hsl(210,15%,50%)]">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="font-bold text-lg mb-2">{m.title}</h3>
                <p className="text-sm text-[hsl(210,20%,72%)] leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(-45deg, hsl(25 95% 53% / 0.04) 0 24px, transparent 24px 48px)",
          }}
        />
        <div className="relative max-w-4xl mx-auto px-6 text-center space-y-6">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight">
            현장 안전, 더 이상 종이로 관리하지 마세요.
          </h2>
          <p className="text-lg text-[hsl(210,20%,72%)]">
            지금 가입하면 데모 프로젝트로 모든 기능을 무료로 사용할 수 있습니다.
          </p>
          <div className="flex flex-wrap gap-3 justify-center pt-4">
            <Link to="/auth">
              <Button size="lg" className="bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,48%)] text-[hsl(220,60%,12%)] font-bold h-14 px-8 text-base">
                무료로 시작 <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            <Link to="/m">
              <Button size="lg" variant="outline" className="h-14 px-8 text-base border-[hsl(220,45%,32%)] bg-transparent text-[hsl(210,30%,92%)] hover:bg-[hsl(220,45%,22%)] hover:text-white">
                모바일 화면 보기
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[hsl(220,45%,22%)] py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[hsl(210,15%,55%)] font-mono">
          <div>© {new Date().getFullYear()} Safenex · 통합 안전관리시스템</div>
          <div className="flex gap-6">
            <Link to="/auth" className="hover:text-[hsl(25,95%,60%)]">로그인</Link>
            <Link to="/manual" className="hover:text-[hsl(25,95%,60%)]">사용설명서</Link>
            <Link to="/worker/register" className="hover:text-[hsl(25,95%,60%)]">근로자 등록</Link>
          </div>
        </div>
      </footer>

      <div
        className="h-2 w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, hsl(25 95% 53%) 0 14px, hsl(220 60% 8%) 14px 28px)",
        }}
      />
    </div>
  );
}

const MODULES = [
  { title: "AI 위험성평가", icon: ShieldAlert, desc: "공정·작업별 AI 자동 생성, 검증센터로 누락 항목까지 보완." },
  { title: "작업허가서 (DIG 표준)", icon: FileSignature, desc: "밀폐·화기·굴착·중장비 카테고리, 디지털 결재 5단계." },
  { title: "TBM 일지", icon: ClipboardCheck, desc: "QR 한 번으로 참여 서명·교육 이수까지 자동 기록." },
  { title: "근로자 출입 / 위치", icon: QrCode, desc: "QR 출입, 위험구역 진입 경고, 퇴근 시 잔류자 확인." },
  { title: "법적업무 To-Do", icon: ClipboardCheck, desc: "산업안전보건법 22개 법정 업무 일정·증빙 관리." },
  { title: "현장 사이트맵", icon: MapPin, desc: "구역·위험반경 시각화, 모바일 알림 연동." },
];

function StatCard({ label, value, sub, icon: Icon, tone }: any) {
  const toneColor =
    tone === "warn" ? "hsl(0 72% 60%)" : tone === "ok" ? "hsl(145 63% 50%)" : "hsl(25 95% 53%)";
  return (
    <div className="rounded-lg bg-[hsl(220,55%,8%)] border border-[hsl(220,45%,22%)] p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(210,15%,55%)]">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5" style={{ color: toneColor }} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black tabular-nums" style={{ color: toneColor }}>
          {value}
        </span>
        <span className="text-xs text-[hsl(210,15%,55%)]">{sub}</span>
      </div>
    </div>
  );
}
