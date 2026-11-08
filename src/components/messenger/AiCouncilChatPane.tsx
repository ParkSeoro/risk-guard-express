import React, { useState, useEffect, useRef } from "react";
import { 
  Building2, 
  Send, 
  ShieldCheck, 
  Sparkles, 
  Settings, 
  CheckCircle2, 
  Terminal, 
  Bot, 
  User, 
  FileCode, 
  CheckCheck,
  RefreshCw,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { askCouncilCursor } from "@/lib/councilCursor";
import { COUNCIL_MAX_CURSOR_TURNS, COUNCIL_MAX_ROUNDS, councilCanClose, readVerdict } from "@/lib/councilDebate";
import { askCouncilProvider } from "@/lib/councilProvider";

interface CouncilMessage {
  id: string;
  sender: string;
  role: string;
  avatar: string;
  color: string;
  text: string;
  isUser?: boolean;
  isRfc?: boolean;
  timestamp: string;
}

interface CouncilConfig {
  openrouterApiKey: string;
  geminiModel: string;
  claudeModel: string;
  cursorModel: string;
  gptModel: string;
  customGeminiKey?: string;
  customClaudeKey?: string;
  customCursorKey?: string;
  customGptKey?: string;
}

const DEFAULT_CONFIG: CouncilConfig = {
  openrouterApiKey: (import.meta as any).env?.VITE_OPENROUTER_API_KEY || "",
  geminiModel: "google/gemini-2.0-flash-001",
  claudeModel: "claude-sonnet-4-20250514",
  cursorModel: "anthropic/claude-3.7-sonnet",
  gptModel: "openai/gpt-4o"
};

const STORAGE_KEY = "safenex_ai_council_config";

export function AiCouncilChatPane({ onBack }: { onBack?: () => void } = {}) {
  const [messages, setMessages] = useState<CouncilMessage[]>([
    {
      id: "welcome-1",
      sender: "AI Council 의장단",
      role: "시스템 안내",
      avatar: "🏛️",
      color: "#6366F1",
      text: "👋 안녕하세요, 박서로 디렉터님! SafeNex 통합 AI Council 관제실입니다.\n\n주제를 던지면 Gemini, Claude, GPT가 의견을 있는 그대로 여러 가지 주고받습니다. Cursor는 실제 코드와 정해 둔 규칙을 보고 된다 또는 안된다를 판정합니다. 그 판정이 되고, 남는 반대가 없을 때만 합의합니다. 회의 중에는 코드를 고치지 않습니다.",
      timestamp: "방금 전"
    }
  ]);
  const [inputText, setInputText] = useState("");
  const [isDebating, setIsDebating] = useState(false);
  const [typingStatus, setTypingStatus] = useState<string | null>(null);
  const [meetingLabel, setMeetingLabel] = useState("대기");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState<CouncilConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_CONFIG;
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingStatus]);

  const saveConfig = (newConfig: CouncilConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    toast.success("AI Council API 설정이 저장되었습니다.");
    setIsSettingsOpen(false);
  };

  const askSeat = async (
    seat: "gemini" | "anthropic" | "openai",
    agenda: string,
    prior: string,
    status: string,
  ) => {
    setTypingStatus(status);
    try {
      return await askCouncilProvider({ seat, agenda, prior });
    } catch (e) {
      return e instanceof Error ? e.message : "연결에 실패했습니다.";
    }
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isDebating) return;

    setInputText("");
    setIsDebating(true);

    const userMsg: CouncilMessage = {
      id: `user-${Date.now()}`,
      sender: "박서로 (Director)",
      role: "최종 결정권자",
      avatar: "👤",
      color: "#6366F1",
      text,
      isUser: true,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      setMeetingLabel("토론 중");
      const spoken: { name: string; text: string }[] = [];
      const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      let seq = 0;
      const speak = (message: Omit<CouncilMessage, "id" | "timestamp">) => {
        setMessages((prev) => [...prev, { ...message, id: `seat-${Date.now()}-${seq++}`, timestamp: clock() }]);
      };
      const priorFor = (instruction: string) => {
        const body = spoken.map((turn) => `${turn.name}:\n${turn.text}`).join("\n\n");
        return `${instruction}\n\n${body}`.trim();
      };
      let cursorText = "";
      let cursorCalls = 0;
      let latest = { gemini: "", claude: "", gpt: "" };
      let closed = false;

      for (let round = 1; round <= COUNCIL_MAX_ROUNDS && !closed; round++) {
        const followUp = round === 1
          ? "첫 바퀴다. 주제만 보고 의견을 있는 그대로 모두 적어라."
          : readVerdict(cursorText) === "된다"
            ? "Cursor가 된다라고 한 안은 유지한 채, 남는 반대와 질문만 풀어라. 안을 바꾸면 마지막 줄은 판정: 계속이다."
            : "Cursor 판정과 앞선 반대에 답하라. 고친 안과 아직 남는 의견을 있는 그대로 적어라.";

        latest.gemini = await askSeat(
          "gemini",
          text,
          priorFor(`${followUp}\n너는 Gemini다. 네 의견을 여러 가지면 그대로 적고, 앞선 각 포인트에 답하라.`),
          `🔷 ${round}바퀴 Gemini가 의견을 말하고 있습니다...`,
        );
        spoken.push({ name: "Gemini", text: latest.gemini });
        speak({
          sender: "Gemini Arbiter (원탁 의장 / Antigravity)",
          role: `${round}바퀴 의견`,
          avatar: "🔷",
          color: "#4285F4",
          text: latest.gemini,
        });

        latest.claude = await askSeat(
          "anthropic",
          text,
          priorFor(`${followUp}\n너는 Claude다. Gemini와 다른 자리의 각 포인트에 동의 또는 반대를 말하고, 네 의견도 더하라.`),
          `📐 ${round}바퀴 Claude가 앞선 의견에 답하고 있습니다...`,
        );
        spoken.push({ name: "Claude", text: latest.claude });
        speak({
          sender: "Claude Architect (시스템 설계)",
          role: `${round}바퀴 의견`,
          avatar: "📐",
          color: "#D97706",
          text: latest.claude,
        });

        latest.gpt = await askSeat(
          "openai",
          text,
          priorFor(`${followUp}\n너는 GPT다. 앞선 각 포인트에 동의 또는 반대를 말하고, 네 의견도 더하라.`),
          `🛡️ ${round}바퀴 GPT가 앞선 의견에 답하고 있습니다...`,
        );
        spoken.push({ name: "GPT", text: latest.gpt });
        speak({
          sender: "GPT Guardian (무장애 안전 감사)",
          role: `${round}바퀴 의견`,
          avatar: "🛡️",
          color: "#10B981",
          text: latest.gpt,
        });

        const threeAgreed = councilCanClose([latest.gemini, latest.claude, latest.gpt], cursorText);
        const askCursor = cursorCalls < COUNCIL_MAX_CURSOR_TURNS && (cursorCalls === 0 || !threeAgreed);
        if (askCursor) {
          setTypingStatus(`⚡ ${round}바퀴 Cursor가 코드와 규칙을 보고 있습니다...`);
          try {
            cursorText = await askCouncilCursor({
              agenda: text,
              prior: priorFor("너는 Cursor다. 실제 코드와 정해 둔 규칙을 보고, 걸리는 점을 모두 적어라."),
            });
          } catch (e) {
            cursorText = e instanceof Error ? e.message : "Cursor 연결에 실패했습니다.";
          }
          cursorCalls += 1;
          spoken.push({ name: "Cursor", text: cursorText });
          speak({
            sender: "Cursor Builder (실무 코드 장인)",
            role: `${round}바퀴 판정`,
            avatar: "⚡",
            color: "#38BDF8",
            text: cursorText,
          });
        }

        if (councilCanClose([latest.gemini, latest.claude, latest.gpt], cursorText)) {
          closed = true;
          setMeetingLabel("합의");
          speak({
            sender: "AI Council 의장단",
            role: "합의",
            avatar: "📜",
            color: "#818CF8",
            isRfc: true,
            text: `합의했다.\n\n주제: ${text}\nCursor 판정: 된다\n\n위 마지막 발언이 합의된 안이다. 회의 중에는 코드를 고치지 않았다.`,
          });
          toast.success("관제실이 합의했습니다. 코드는 아직 고치지 않았습니다.");
        }
      }

      if (!closed) {
        setMeetingLabel("미합의");
        speak({
          sender: "AI Council 의장단",
          role: "미합의",
          avatar: "📜",
          color: "#D97706",
          isRfc: true,
          text: `아직 합의하지 못했다.\n\n주제: ${text}\nCursor를 ${cursorCalls}번 불렀고, 마지막 판정은 위 Cursor 발언에 있다.\n남는 반대도 위 발언에 있다. 합의로 닫지 않았다.`,
        });
        toast("관제실이 합의하지 못했습니다. 남는 반대는 위 발언에 있습니다.");
      }
    } catch (err: any) {
      toast.error(`오류 발생: ${err.message}`);
    } finally {
      setIsDebating(false);
      setTypingStatus(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full min-w-0 bg-background select-none overflow-hidden relative overscroll-contain">
      
      {/* Header */}
      <div className="px-3 pt-[max(0.625rem,var(--sat))] pb-2.5 border-b bg-card/60 backdrop-blur flex items-center justify-between gap-2 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onBack}
              title="대화방 목록으로 돌아가기"
              aria-label="뒤로가기"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-sm sm:text-base shadow shrink-0">
            🏛️
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="text-sm font-bold tracking-tight truncate">SafeNex AI Council 관제실</h2>
              <span
                className={cn(
                  "hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0",
                  meetingLabel === "합의" && "bg-emerald-950 text-emerald-400 border-emerald-800",
                  meetingLabel === "미합의" && "bg-amber-950 text-amber-300 border-amber-800",
                  meetingLabel === "토론 중" && "bg-sky-950 text-sky-300 border-sky-800",
                  meetingLabel === "대기" && "bg-muted text-muted-foreground border-border",
                )}
              >
                {meetingLabel}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 font-mono shrink-0">
                MASTER
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1 sm:gap-1.5 mt-0.5">
              <span className="hidden sm:inline">참여 AI:</span>
              <span className="text-blue-400 font-medium">🔷 Gemini</span>
              <span>•</span>
              <span className="text-sky-400 font-medium">⚡ Cursor</span>
              <span>•</span>
              <span className="text-amber-400 font-medium">📐 Claude</span>
              <span>•</span>
              <span className="text-emerald-400 font-medium">🛡️ GPT</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="h-8 px-2.5 gap-1.5 text-xs shrink-0"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>AI 설정</span>
          </Button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div ref={scrollRef} className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:p-4 space-y-4 custom-scroll">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex items-start gap-2 sm:gap-2.5 min-w-0 w-full",
              m.isUser ? "justify-end" : "justify-start"
            )}
          >
            {!m.isUser && (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-muted border flex items-center justify-center text-xs sm:text-sm shrink-0 mt-0.5 shadow-xs">
                {m.avatar}
              </div>
            )}

            <div className={cn("flex flex-col min-w-0 max-w-[85%] sm:max-w-[80%] lg:max-w-3xl", m.isUser ? "items-end" : "items-start")}>
              <div className="flex flex-wrap items-center gap-1.5 mb-1 text-[11px] text-muted-foreground min-w-0">
                <span className="font-bold text-foreground truncate">{m.sender}</span>
                {!m.isUser && (
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded-full shrink-0"
                    style={{ background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}44` }}
                  >
                    {m.role}
                  </span>
                )}
                <span>•</span>
                <span className="shrink-0">{m.timestamp}</span>
              </div>

              <div
                className={cn(
                  "p-3 sm:p-3.5 rounded-2xl text-xs leading-relaxed select-text shadow-xs whitespace-pre-wrap break-words overflow-x-auto max-w-full",
                  m.isUser
                    ? "bg-primary text-primary-foreground rounded-tr-xs"
                    : m.isRfc
                    ? "bg-indigo-950/40 border border-indigo-500/50 text-foreground rounded-tl-xs shadow-md"
                    : "bg-muted/70 border text-foreground rounded-tl-xs"
                )}
              >
                {m.text}
              </div>
            </div>

            {m.isUser && (
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-purple-600 flex items-center justify-center text-[11px] sm:text-xs font-bold text-white shrink-0 shadow-xs">
                서로
              </div>
            )}
          </div>
        ))}

        {typingStatus && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-muted/40 border text-xs text-indigo-400 animate-pulse max-w-full sm:max-w-md min-w-0">
            <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span className="truncate">{typingStatus}</span>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-2.5 sm:p-3 pb-[max(0.625rem,var(--sab))] border-t bg-card/40 shrink-0 space-y-2 min-w-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs min-w-0">
          <span className="text-[11px] text-muted-foreground shrink-0">추천 의제:</span>
          <button
            type="button"
            onClick={() => setInputText("PTW 작업허가서 최종 승인 버튼 클릭 시 TBM AI 생성과 Gemini 지연을 완전 분리하고 뱃지 알림이 즉시 갱신되도록 리팩토링 검토해줘.")}
            className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-sky-400 text-[11px] border shrink-0 transition"
          >
            ⚡ PTW 지연 분리
          </button>
          <button
            type="button"
            onClick={() => setInputText("시스템 무중단 운영을 위해 로그인 세션, 결재 데이터 무결성, PC 메신저 소켓 연결 안정성에 잠재적 위험이 없는지 철저히 감사해줘.")}
            className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-emerald-400 text-[11px] border shrink-0 transition"
          >
            🛡️ 접속·결재·소켓 무장애 감사
          </button>
        </div>

        <div className="flex items-end gap-1.5 sm:gap-2 bg-background border rounded-2xl p-1.5 sm:p-2 focus-within:ring-1 focus-within:ring-primary shadow-xs min-w-0">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="박서로 디렉터님의 의제를 입력하세요... (Enter: 원탁 소집)"
            className="flex-1 min-w-0 min-h-[40px] sm:min-h-[44px] max-h-28 resize-none border-0 shadow-none focus-visible:ring-0 text-xs p-1.5 leading-relaxed"
            rows={1}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || isDebating}
            className="h-9 px-3 sm:px-4 rounded-xl shrink-0 font-bold gap-1.5 shadow-sm text-xs"
          >
            <Send className="h-3.5 w-3.5" />
            <span>원탁 소집</span>
          </Button>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Settings className="h-4 w-4" />
              <span>AI Council API 및 모델 개별 설정</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* OpenRouter Unified Key */}
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border">
              <label className="font-bold flex items-center justify-between">
                <span>🔑 OpenRouter 통합 API Key (선택 사항)</span>
                <span className="text-[10px] text-emerald-400">
                  {config.openrouterApiKey?.trim() ? "입력됨" : "미설정"}
                </span>
              </label>
              <Input
                type="password"
                value={config.openrouterApiKey}
                onChange={(e) => setConfig({ ...config, openrouterApiKey: e.target.value })}
                placeholder="sk-or-v1-..."
                className="font-mono text-xs h-8"
              />
            </div>

            {/* Individual AI Model & Custom Key overrides */}
            <div className="grid grid-cols-2 gap-3">
              {/* Gemini */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-blue-400">🔷 Gemini Arbiter</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  브라우저 키가 아닙니다. 서버의 GEMINI_API_KEY로 Gemini 4 Argon에 묻고, 그 모델을 쓸 수 없으면 Gemini 3.8 Flash로 넘깁니다.
                </p>
              </div>

              {/* Cursor */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-sky-400">⚡ Cursor</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  OpenRouter 모델이 아닙니다. 마스터 계정으로 이 대화의 Cursor 에이전트에게 묻고, 그 답변을 그대로 보여 줍니다.
                </p>
              </div>

              {/* Claude */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-amber-400">📐 Claude</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  브라우저 키가 아닙니다. 서버의 ANTHROPIC_API_KEY로 Anthropic에 묻고, 그 답변을 그대로 보여 줍니다.
                </p>
              </div>

              {/* GPT */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-emerald-400">🛡️ GPT</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  브라우저 키가 아닙니다. 서버의 OPENAI_API_KEY로 OpenAI에 묻고, 그 답변을 그대로 보여 줍니다.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsSettingsOpen(false)}>
              취소
            </Button>
            <Button size="sm" onClick={() => saveConfig(config)}>
              설정 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
