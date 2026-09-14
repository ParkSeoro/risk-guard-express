import { useEffect, useMemo, useState } from "react";
import {
  translateDocViewFields,
  type DocViewEntityType,
} from "@/lib/docViewTranslate";
import { parseWorkerLocale, type WorkerLocale } from "@/lib/i18n/workerLocale";

export function useTranslatedDocFields(
  entityType: DocViewEntityType,
  entityId: string | null | undefined,
  locale: WorkerLocale,
  fields: Record<string, string>,
) {
  const parsed = parseWorkerLocale(locale);
  const [translated, setTranslated] = useState<Record<string, string>>(fields);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const fieldKey = useMemo(
    () =>
      Object.keys(fields)
        .sort()
        .map((k) => `${k}:${fields[k] || ""}`)
        .join("|"),
    [fields],
  );

  useEffect(() => {
    if (!entityId || parsed === "ko") {
      setTranslated(fields);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void translateDocViewFields({ entityType, entityId, locale: parsed, fields })
      .then((next) => {
        if (!cancelled) setTranslated(next);
      })
      .catch(() => {
        if (!cancelled) {
          setTranslated(fields);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fieldKey stands in for fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, parsed, fieldKey]);

  return { translated, loading, failed, isOriginal: parsed === "ko" };
}