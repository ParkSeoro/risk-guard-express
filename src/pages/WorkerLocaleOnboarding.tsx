/**
 * First worker-app language pick. Existing Korean accounts skip this
 * (profiles.ui_locale_chosen is already true).
 */
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { afterConsentHomePath, needsConsent, readLoginIntent } from "@/components/AuthGuard";
import { useWorkerLocale } from "@/hooks/useWorkerLocale";
import {
  WORKER_LOCALE_LABELS,
  WORKER_LOCALES,
  needsWorkerLocaleChoice,
  type WorkerLocale,
} from "@/lib/i18n/workerLocale";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";

const HINTS: Record<WorkerLocale, string> = {
  ko: "메뉴를 한국어로 사용합니다.",
  en: "All menus stay in English.",
  zh: "之后菜单将使用中文。",
  ja: "以降のメニューは日本語です。",
};

export default function WorkerLocaleOnboarding() {
  const { user, session, isAuthLoading, roles, profileReady, profile, applyProfilePatch } = useAuth();
  const { setLocale } = useWorkerLocale();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<WorkerLocale | null>(null);

  if (isAuthLoading || (session && (!profileReady || !profile))) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground native-safe-pad">
        …
      </div>
    );
  }
  if (!session || !user) return <Navigate to="/login?next=/app-language" replace />;
  if (needsConsent(profile, roles)) return <Navigate to="/consent" replace />;
  if (!needsWorkerLocaleChoice(profile)) {
    return (
      <Navigate
        to={afterConsentHomePath(roles, profile, { loginIntent: readLoginIntent() })}
        replace
      />
    );
  }

  const pick = async (locale: WorkerLocale) => {
    setBusy(locale);
    try {
      await setLocale(locale);
      applyProfilePatch({ ui_locale: locale, ui_locale_chosen: true } as any);
      navigate(afterConsentHomePath(roles, { ...profile, ui_locale_chosen: true }, { loginIntent: readLoginIntent() }), {
        replace: true,
      });
    } catch (e: any) {
      toast.error(e?.message || "Could not save language");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-center p-4 native-safe-pad">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
            Safenex
          </p>
          <h1 className="text-xl font-semibold leading-snug">
            언어 · Language · 语言 · 言語
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            한국어를 고르면 지금과 같은 화면입니다.
            <br />
            Choose your language. Menus stay in that language.
          </p>
        </div>
        <div className="grid gap-2">
          {WORKER_LOCALES.map((loc) => (
            <Button
              key={loc}
              type="button"
              variant={loc === "ko" ? "default" : "outline"}
              className="h-14 text-base w-full flex flex-col gap-0.5"
              disabled={!!busy}
              onClick={() => void pick(loc)}
              data-testid={`locale-pick-${loc}`}
            >
              <span>{WORKER_LOCALE_LABELS[loc]}</span>
              <span className="text-[11px] font-normal opacity-80">{HINTS[loc]}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
