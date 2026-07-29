/**
 * Worker first-login legal consent (terms / location / privacy).
 * Checkbox UX with master "agree all" + per-doc modal.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CONSENT_DOCS, type ConsentDocId } from "@/lib/legal/workerConsentDocs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldCheck, MapPin, FileText, ScrollText } from "lucide-react";
import { toast } from "sonner";

const ITEMS: { id: ConsentDocId; icon: typeof FileText; requiredKey: "terms" | "location" | "privacy" }[] = [
  { id: "terms", icon: ScrollText, requiredKey: "terms" },
  { id: "location", icon: MapPin, requiredKey: "location" },
  { id: "privacy", icon: FileText, requiredKey: "privacy" },
];

export default function WorkerConsentPage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [terms, setTerms] = useState(false);
  const [location, setLocation] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [modal, setModal] = useState<ConsentDocId | null>(null);
  const [busy, setBusy] = useState(false);

  const allChecked = terms && location && privacy;
  const masterChecked = allChecked;

  const setAll = (v: boolean) => {
    setTerms(v);
    setLocation(v);
    setPrivacy(v);
  };

  const checkedMap = useMemo(
    () => ({ terms, location, privacy }),
    [terms, location, privacy],
  );

  const setOne = (key: "terms" | "location" | "privacy", v: boolean) => {
    if (key === "terms") setTerms(v);
    if (key === "location") setLocation(v);
    if (key === "privacy") setPrivacy(v);
  };

  const submit = async () => {
    if (!user || !allChecked) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("profiles")
        .update({
          agreed_to_terms: true,
          agreed_to_location: true,
          agreed_to_privacy: true,
          consent_agreed_at: now,
        })
        .eq("user_id", user.id);
      if (error) throw error;

      // Align GPS tracker consent flag with legal location consent
      try {
        localStorage.setItem("tracking-consent-v1", "1");
      } catch {
        /* ignore */
      }

      await refreshProfile();
      toast.success("약관 동의가 완료되었습니다");
      navigate("/app/worker/home", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "동의 저장에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const activeDoc = modal ? CONSENT_DOCS[modal] : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-emerald-950 text-white flex flex-col">
      <header className="p-5 pt-10 space-y-2">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">약관 동의</h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          위치정보보호법·개인정보보호법 준수를 위해 최초 1회 동의가 필요합니다.
          동의 전에는 근로자 기능을 이용할 수 없습니다.
        </p>
      </header>

      <main className="flex-1 px-4 pb-8 space-y-3 max-w-lg w-full mx-auto">
        <label className="flex items-center gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3.5">
          <Checkbox
            checked={masterChecked}
            onCheckedChange={(v) => setAll(v === true)}
            className="border-emerald-300 data-[state=checked]:bg-emerald-500"
          />
          <span className="font-semibold text-base">모두 동의합니다</span>
        </label>

        <div className="space-y-2">
          {ITEMS.map(({ id, icon: Icon, requiredKey }) => {
            const doc = CONSENT_DOCS[id];
            const checked = checkedMap[requiredKey];
            return (
              <div
                key={id}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 flex items-start gap-3"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => setOne(requiredKey, v === true)}
                  className="mt-0.5 border-slate-400 data-[state=checked]:bg-emerald-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                    <span>[필수] {doc.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{doc.summary}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-xs text-emerald-200 hover:text-white hover:bg-white/10"
                  onClick={() => setModal(id)}
                >
                  내용 보기
                </Button>
              </div>
            );
          })}
        </div>

        <Button
          className="w-full h-12 mt-4 text-base font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-900 disabled:opacity-40"
          disabled={!allChecked || busy}
          onClick={() => void submit()}
        >
          {busy ? "저장 중…" : "확인 및 시작하기"}
        </Button>
      </main>

      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{activeDoc?.title}</DialogTitle>
            <DialogDescription>{activeDoc?.summary}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto text-sm whitespace-pre-wrap leading-relaxed text-foreground/90 pr-1">
            {activeDoc?.body}
          </div>
          <Button className="mt-2" onClick={() => setModal(null)}>
            닫기
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
