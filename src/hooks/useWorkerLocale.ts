import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  parseWorkerLocale,
  readStoredWorkerLocale,
  writeStoredWorkerLocale,
  type WorkerLocale,
} from "@/lib/i18n/workerLocale";
import { roleLabelForLocale, workerT, type WorkerStringKey } from "@/lib/i18n/workerStrings";
import { saveUiLocale } from "@/lib/profilePreferences";

export function useWorkerLocale() {
  const { user, profile, refreshProfile } = useAuth();
  const [locale, setLocaleState] = useState<WorkerLocale>(() => {
    const fromProfile = parseWorkerLocale((profile as { ui_locale?: string | null } | null)?.ui_locale);
    if ((profile as { ui_locale?: string | null } | null)?.ui_locale) return fromProfile;
    return readStoredWorkerLocale();
  });

  useEffect(() => {
    const raw = (profile as { ui_locale?: string | null } | null)?.ui_locale;
    if (!raw) return;
    const next = parseWorkerLocale(raw);
    setLocaleState(next);
    writeStoredWorkerLocale(next);
  }, [profile]);

  const setLocale = useCallback(
    async (nextRaw: WorkerLocale) => {
      const next = parseWorkerLocale(nextRaw);
      setLocaleState(next);
      writeStoredWorkerLocale(next);
      if (user?.id) {
        await saveUiLocale(user.id, next);
        await refreshProfile();
      }
    },
    [user?.id, refreshProfile],
  );

  const t = useCallback((key: WorkerStringKey) => workerT(locale, key), [locale]);
  const roleLabel = useCallback((role: string) => roleLabelForLocale(role, locale), [locale]);

  return useMemo(
    () => ({ locale, setLocale, t, roleLabel }),
    [locale, setLocale, t, roleLabel],
  );
}