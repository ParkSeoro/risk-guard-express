import { useAuth } from "@/contexts/AuthContext";
import { Sparkles } from "lucide-react";

export function AICreditBanner() {
  const { roles, user } = useAuth();
  const isMaster = (roles || []).includes("master") || user?.email === "psr1579@gmail.com";

  if (!isMaster) return null;

  return (
    <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-300 border border-emerald-600/40 text-[11px] shadow-sm shrink-0 whitespace-nowrap">
      <Sparkles className="h-3 w-3 text-amber-400 shrink-0" />
      <span className="font-semibold">Google Gemini 3.8 Flash AI 엔진 연동</span>
      <span className="text-[10px] bg-emerald-900/80 text-emerald-200 px-1 rounded font-bold">정상 가동</span>
    </div>
  );
}
