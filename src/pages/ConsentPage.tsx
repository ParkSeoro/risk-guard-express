/**
 * Universal first-login consent (/consent).
 * Checkbox set depends on admin vs worker role.
 */
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  CONSENT_DOCS,
  consentItemsForRoles,
  type ConsentDocId,
} from "@/lib/legal/consentDocs";
import {
  isAdminShellUser,
  needsConsent,
  postConsentHomePath,
  readLoginIntent,
  resolvePostLoginShell,
  WORKER_HOME,
} from "@/components/AuthGuard";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldCheck, MapPin, FileText, ScrollText, Lock } from "lucide-react";
import {
  hasCompletedNativePermissions,
  isNativeApp,
} from "@/lib/native/isNativeApp";
import { setTrackingConsent } from "@/lib/tracking/locationTracker";
import { toast } from "sonner";

const ICONS: Record<ConsentDocId, typeof FileText> = {
  terms: ScrollText,
  location: MapPin,
  privacy: FileText,
  admin_security: Lock,
};

export default function ConsentPage() {
  const { user, session, isAuthLoading, roles, profile, applyProfilePatch, reloadAuthProfile } =
    useAuth();
  const navigate = useNavigate();
  const shell = resolvePostLoginShell(roles, {
    rolesReady: true,
    loginIntent: readLoginIntent(),
  });
  const isAdmin = shell === "admin" || isAdminShellUser(roles);
  const items = useMemo(() => consentItemsForRoles(isAdmin), [isAdmin]);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<ConsentDocId | null>(null);
  const [busy, setBusy] = useState(false);

  // ① Wait for global auth boot only
  if (isAuthLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground native-safe-pad">
        세션 확인 중…
      </div>
    );
  }
  // ④ Race defense: unauthenticated URL hit → login
  if (!session || !user) return <Navigate to="/login?next=/consent" replace />;
  if (!needsConsent(profile, roles)) {
    const home = postConsentHomePath(roles, { loginIntent: readLoginIntent() });
    // Never render a blank page — /consent looping would look like a white freeze.
    if (home === "/consent") return <Navigate to={WORKER_HOME} replace />;
    return <Navigate to={home} replace />;
  }

  const allChecked = items.every((id) => checked[id] === true);

  const setAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    items.forEach((id) => {
      next[id] = v;
    });
    setChecked(next);
  };

  const submit = async () => {
    if (!user || !allChecked) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const payload = isAdmin
        ? {
            agreed_to_terms: true,
            agreed_to_privacy: true,
            agreed_to_admin_security: true,
            // Admins are not required to grant GPS; keep prior value or false
            consent_agreed_at: now,
          }
        : {
            agreed_to_terms: true,
            agreed_to_privacy: true,
            agreed_to_location: true,
            consent_agreed_at: now,
          };

      // ① Persist consent flags
      const { error } = await supabase.from("profiles").update(payload).eq("user_id", user.id);
      if (error) throw error;

      if (!isAdmin) {
        // Must be "yes" — locationTracker.hasTrackingConsent() rejected legacy "1"
        setTrackingConsent(true);
      }

      // ② Critical: sync AuthContext BEFORE navigate so AuthGuard sees needsConsent=false
      applyProfilePatch(payload);
      try {
        await reloadAuthProfile();
      } catch {
        /* local patch already applied — navigate anyway */
      }

      // ③ Native: OS permissions next; otherwise role-aware home
      toast.success("약관 동의가 완료되었습니다");
      if (isNativeApp() && !hasCompletedNativePermissions()) {
        navigate("/native-permissions", { replace: true });
      } else {
        navigate(postConsentHomePath(roles, { loginIntent: readLoginIntent() }), { replace: true });
      }
    } catch (e: any) {
      toast.error(e?.message || "동의 저장에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const activeDoc = modal ? CONSENT_DOCS[modal] : null;
  const audienceLabel = isAdmin ? "관리자·매니저" : "근로자";

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-900 via-slate-800 to-emerald-950 text-white flex flex-col native-safe-pad">
      <header className="p-5 pt-6 space-y-2 max-w-lg w-full mx-auto">
        <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">약관 동의</h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          {audienceLabel} 계정 최초 이용을 위해 필수 동의가 필요합니다. 동의 전에는 시스템을 이용할 수
          없습니다.
        </p>
      </header>

      <main className="flex-1 px-4 pb-8 space-y-3 max-w-lg w-full mx-auto">
        <label className="flex items-center gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3.5">
          <Checkbox
            checked={allChecked}
            onCheckedChange={(v) => setAll(v === true)}
            className="border-emerald-300 data-[state=checked]:bg-emerald-500"
          />
          <span className="font-semibold text-base">모두 동의합니다</span>
        </label>

        <div className="space-y-2">
          {items.map((id) => {
            const doc = CONSENT_DOCS[id];
            const Icon = ICONS[id];
            return (
              <div
                key={id}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 flex items-start gap-3"
              >
                <Checkbox
                  checked={checked[id] === true}
                  onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [id]: v === true }))}
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
          {busy ? "저장 중…" : "모두 동의 및 시작하기"}
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
