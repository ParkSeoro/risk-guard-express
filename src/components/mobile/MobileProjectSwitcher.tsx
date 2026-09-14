import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useMobileProjectList } from "@/hooks/useMobileProjectList";
import { usePreview } from "@/contexts/PreviewContext";
import { useWorkerLocale } from "@/hooks/useWorkerLocale";
import { saveDefaultProjectId } from "@/lib/profilePreferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function MobileProjectSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { user, profile, refreshProfile, hasRole } = useAuth();
  const { projectId, setProjectId } = useMobileAccess();
  const preview = usePreview();
  const { projects } = useMobileProjectList();
  const { t } = useWorkerLocale();
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const defaultId = String((profile as { default_project_id?: string | null } | null)?.default_project_id || "");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) => (p.name || "").toLowerCase().includes(needle));
  }, [projects, q]);

  if (projects.length === 0) return null;

  const saveDefault = async () => {
    if (!user?.id || !projectId || preview.isPreview) return;
    setSaving(true);
    try {
      await saveDefaultProjectId(user.id, projectId);
      await refreshProfile();
      toast.success(t("savedAsDefault"));
    } catch (e: any) {
      toast.error(e?.message || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"} data-testid="mobile-project-switcher">
      {!compact && <div className="text-xs font-medium text-muted-foreground">{t("project")}</div>}
      {projects.length > 8 && (
        <Input
          className="h-9 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={hasRole("master") ? t("selectProject") : t("project")}
        />
      )}
      <select
        className="w-full h-11 rounded-md border bg-background px-2 text-sm"
        value={projectId || preview.previewProjectId || ""}
        disabled={preview.isPreview}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <option value="">{t("selectProject")}</option>
        {filtered.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.id === defaultId ? ` · ${t("defaultSite")}` : ""}
          </option>
        ))}
      </select>
      {!!projectId && projectId !== defaultId && !preview.isPreview && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full h-9"
          disabled={saving}
          onClick={() => void saveDefault()}
        >
          {t("saveAsDefault")}
        </Button>
      )}
    </div>
  );
}