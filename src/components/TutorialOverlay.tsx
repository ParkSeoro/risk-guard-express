import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, ArrowLeft, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";


const STORAGE_KEY = "tutorial:completed:v1";

const STEPS = [
  {
    title: "1. 프로젝트 생성/선택",
    body: "먼저 상단 헤더의 프로젝트 선택에서 작업할 현장을 고릅니다. 프로젝트가 없다면 좌측 '프로젝트' 메뉴에서 생성하세요.",
    cta: "프로젝트 메뉴 열기",
    to: "/projects",
  },
  {
    title: "2. 위험성평가 작성",
    body: "공종/작업명을 선택하고 'AI 자동생성'으로 초안을 만든 뒤, 3x3 매트릭스로 등급을 산정합니다. '고' 등급은 사진 첨부가 필수입니다.",
    cta: "위험성평가로 이동",
    to: "/risk-assessment",
  },
  {
    title: "3. 작업계획서 작성",
    body: "법정 11종 템플릿에서 작업 유형을 선택하고 7개 탭(개요·장비·절차·위험·대책·첨부·결재) 순서로 작성합니다.",
    cta: "작업계획서로 이동",
    to: "/work-plans",
  },
  {
    title: "4. 작업허가 결재",
    body: "위험작업(화기/밀폐/고소/굴착 등)은 작업허가서를 상신합니다. 결재선은 5단계 순차 진행됩니다.",
    cta: "작업허가서로 이동",
    to: "/work-permits",
  },
  {
    title: "5. TBM 실행 & 근로자 입장",
    body: "당일 TBM을 생성하면 QR이 자동 발급됩니다. 근로자가 QR을 스캔하면 회사 자동 지정 → 등록 → 입장 → 서명까지 3초 흐름으로 진행됩니다.",
    cta: "TBM으로 이동",
    to: "/tbm-logs",
  },
];

export function TutorialOverlay() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) setOpen(true);
  }, [user]);

  const close = (markDone = true) => {
    if (markDone) localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setOpen(false);
  };

  const current = STEPS[step];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            따라하기 — 5단계로 시작하기
          </DialogTitle>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="space-y-3 py-2">
          <h3 className="font-bold text-base">{current.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigate(current.to);
              close(false);
            }}
          >
            {current.cta} <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => close(true)}>
            <X className="h-4 w-4 mr-1" /> 다시 보지 않기
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={step === 0}
              onClick={() => setStep(s => Math.max(0, s - 1))}
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> 이전
            </Button>
            {step < STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStep(s => s + 1)}>
                다음 <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => close(true)}>완료</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function restartTutorial() {
  localStorage.removeItem(STORAGE_KEY);
}
