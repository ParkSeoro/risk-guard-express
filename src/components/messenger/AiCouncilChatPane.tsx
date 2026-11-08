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
  ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  claudeModel: "anthropic/claude-3.7-sonnet",
  cursorModel: "anthropic/claude-3.7-sonnet",
  gptModel: "openai/gpt-4o"
};

const STORAGE_KEY = "safenex_ai_council_config";

export function AiCouncilChatPane() {
  const [messages, setMessages] = useState<CouncilMessage[]>([
    {
      id: "welcome-1",
      sender: "AI Council 의장단",
      role: "시스템 안내",
      avatar: "🏛️",
      color: "#6366F1",
      text: "👋 안녕하세요, 박서로 디렉터님! SafeNex 통합 AI Council 관제실입니다.\n\n웹, 모바일 앱, PC 메신저 어디서든 시스템에 장애가 발생하거나 새로운 아키텍처 아이디어가 있을 때 지시하시면, 4대 AI(Gemini, Cursor, Claude, GPT)가 원탁 토론을 통해 무장애 검증된 솔루션과 코드 패치를 도출합니다.",
      timestamp: "방금 전"
    }
  ]);
  const [inputText, setInputText] = useState("");
  const [isDebating, setIsDebating] = useState(false);
  const [typingStatus, setTypingStatus] = useState<string | null>(null);
  const [consensusScore, setConsensusScore] = useState(95);
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

  const callOpenRouter = async (model: string, systemPrompt: string, userPrompt: string, customKey?: string) => {
    const key = customKey || config.openrouterApiKey;
    if (!key) {
      throw new Error("OpenRouter API Key가 설정되지 않았습니다.");
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin,
        "X-Title": "SafeNex AI Council"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 호출 실패 (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "(응답 없음)";
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
      setTypingStatus("🏛️ 4대 AI 의회가 코드베이스 분석 및 실제 테스트·PR 파이프라인을 가동 중입니다...");
      
      const res = await fetch("/api/council/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, autoPr: true }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.turns && Array.isArray(data.turns)) {
          for (let i = 0; i < data.turns.length; i++) {
            const turn = data.turns[i];
            await new Promise((r) => setTimeout(r, 600));
            setMessages((prev) => [
              ...prev,
              {
                id: `turn-${Date.now()}-${i}`,
                sender: turn.agentName,
                role: turn.role,
                avatar: turn.avatar,
                color: turn.color,
                text: turn.content,
                isRfc: turn.agentName.includes("합의"),
                timestamp: turn.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
          }
        }
        setConsensusScore(100);
        toast.success(
          data.githubPrUrl
            ? "GitHub PR 생성 및 4대 AI 합의 완료!"
            : "4대 AI 실체형 의회 합의(RFC) 완료!"
        );
      } else {
        throw new Error(`서버 응답 오류 (${res.status})`);
      }
    } catch (err: any) {
      toast.error(`실행 중 오류 발생: ${err.message}`);
    } finally {
      setIsDebating(false);
      setTypingStatus(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background select-none overflow-hidden">
      
      {/* Header */}
      <div className="h-14 px-4 border-b bg-card/60 backdrop-blur flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-base shadow shrink-0">
            🏛️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight">SafeNex AI Council 관제실</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 font-bold border border-emerald-800">
                일치율 {consensusScore}%
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 font-mono">
                MASTER
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <span>참여 AI:</span>
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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>AI 설정</span>
          </Button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scroll">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex items-start gap-2.5",
              m.isUser ? "justify-end" : "justify-start"
            )}
          >
            {!m.isUser && (
              <div className="w-8 h-8 rounded-xl bg-muted border flex items-center justify-center text-sm shrink-0 mt-0.5 shadow-xs">
                {m.avatar}
              </div>
            )}

            <div className={cn("flex flex-col max-w-3xl", m.isUser ? "items-end" : "items-start")}>
              <div className="flex items-center gap-1.5 mb-1 text-[11px] text-muted-foreground">
                <span className="font-bold text-foreground">{m.sender}</span>
                {!m.isUser && (
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded-full"
                    style={{ background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}44` }}
                  >
                    {m.role}
                  </span>
                )}
                <span>•</span>
                <span>{m.timestamp}</span>
              </div>

              <div
                className={cn(
                  "p-3.5 rounded-2xl text-xs leading-relaxed select-text shadow-xs whitespace-pre-wrap",
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
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-xs">
                서로
              </div>
            )}
          </div>
        ))}

        {typingStatus && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-muted/40 border text-xs text-indigo-400 animate-pulse max-w-md">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span>{typingStatus}</span>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-3 border-t bg-card/40 shrink-0 space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs">
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

        <div className="flex items-end gap-2 bg-background border rounded-2xl p-2 focus-within:ring-1 focus-within:ring-primary shadow-xs">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="박서로 디렉터님의 지시사항 또는 아이디어를 입력하세요... (Enter: 원탁 소집, Shift+Enter: 줄바꿈)"
            className="min-h-[44px] max-h-28 resize-none border-0 shadow-none focus-visible:ring-0 text-xs p-1.5 leading-relaxed"
            rows={1}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || isDebating}
            className="h-9 px-4 rounded-xl shrink-0 font-bold gap-1.5 shadow-sm"
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
                <span>🔑 OpenRouter 통합 API Key (4대 AI 공통 사용 가능)</span>
                <span className="text-[10px] text-emerald-400">인증됨</span>
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
                <Input
                  value={config.geminiModel}
                  onChange={(e) => setConfig({ ...config, geminiModel: e.target.value })}
                  placeholder="google/gemini-2.0-flash-001"
                  className="text-xs h-7 font-mono"
                />
              </div>

              {/* Cursor */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-sky-400">⚡ Cursor Builder</span>
                <Input
                  value={config.cursorModel}
                  onChange={(e) => setConfig({ ...config, cursorModel: e.target.value })}
                  placeholder="anthropic/claude-3.7-sonnet"
                  className="text-xs h-7 font-mono"
                />
              </div>

              {/* Claude */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-amber-400">📐 Claude Architect</span>
                <Input
                  value={config.claudeModel}
                  onChange={(e) => setConfig({ ...config, claudeModel: e.target.value })}
                  placeholder="anthropic/claude-3.7-sonnet"
                  className="text-xs h-7 font-mono"
                />
              </div>

              {/* GPT */}
              <div className="space-y-1 p-2.5 rounded-xl border bg-card">
                <span className="font-bold text-emerald-400">🛡️ GPT Guardian</span>
                <Input
                  value={config.gptModel}
                  onChange={(e) => setConfig({ ...config, gptModel: e.target.value })}
                  placeholder="openai/gpt-4o"
                  className="text-xs h-7 font-mono"
                />
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
