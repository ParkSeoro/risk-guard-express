export const WORKER_LOCALES = ["ko", "en", "zh", "ja"] as const;
export type WorkerLocale = (typeof WORKER_LOCALES)[number];

export const WORKER_LOCALE_STORAGE_KEY = "safenex.ui_locale";
export const WORKER_LANGUAGE_PATH = "/app-language";

export type LocaleChoiceProfile = {
  ui_locale_chosen?: boolean | null;
} | null;

/** Missing column or already picked → do not block Korean workers. */
export function needsWorkerLocaleChoice(profile?: LocaleChoiceProfile): boolean {
  if (!profile) return false;
  if (profile.ui_locale_chosen == null) return false;
  return profile.ui_locale_chosen !== true;
}

export const WORKER_LOCALE_LABELS: Record<WorkerLocale, string> = {
  ko: "한국어",
  en: "English",
  zh: "中文",
  ja: "日本語",
};

export function parseWorkerLocale(raw?: string | null): WorkerLocale {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "en" || v === "zh" || v === "ja" || v === "ko") return v;
  return "ko";
}

export function readStoredWorkerLocale(): WorkerLocale {
  try {
    return parseWorkerLocale(localStorage.getItem(WORKER_LOCALE_STORAGE_KEY));
  } catch {
    return "ko";
  }
}

export function writeStoredWorkerLocale(locale: WorkerLocale): void {
  try {
    localStorage.setItem(WORKER_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function localeHtmlLang(locale: WorkerLocale): string {
  if (locale === "zh") return "zh-CN";
  if (locale === "ja") return "ja";
  if (locale === "en") return "en";
  return "ko";
}

export function isNonKoreanLocale(locale?: string | null): boolean {
  return parseWorkerLocale(locale) !== "ko";
}