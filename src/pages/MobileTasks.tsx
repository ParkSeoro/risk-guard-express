import { Link } from "react-router-dom";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { managerFieldSections } from "@/lib/mobileFieldMenu";
import { usePreview } from "@/contexts/PreviewContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronRight,
  ClipboardCheck,
  AlertOctagon,
  Users,
  Wrench,
  HeartPulse,
  CloudSun,
  HardHat,
  MapPin,
  Video,
} from "lucide-react";
import { useWorkerLocale } from "@/hooks/useWorkerLocale";

const FIELD_ICONS: Record<string, typeof Video> = {
  vision: Video,
  inspect: ClipboardCheck,
  actions: Wrench,
  "work-stop": AlertOctagon,
  incident: AlertOctagon,
  tbm: Users,
  workers: Users,
  distribution: MapPin,
  weather: CloudSun,
  ppe: HardHat,
};

export default function MobileTasks() {
  const { role, isMaster } = useMobileAccess();
  const { t } = useWorkerLocale();
  const preview = usePreview();
  const effectiveRole = preview.isPreview ? preview.syntheticRole : role;
  const manager = isManagerMobileRole(
    effectiveRole,
    preview.isPreview ? effectiveRole === "master" : isMaster,
  );

  const workerItems = [
    { label: t("taskMyActions"), sub: t("taskMyActionsSub"), to: "/app/worker/actions", icon: Wrench },
    { label: t("taskTbm"), sub: t("taskTbmSub"), to: "/app/worker/tbm", icon: Users },
    { label: t("taskIncident"), sub: t("taskIncidentSub"), to: "/app/worker/incident", icon: AlertOctagon },
    { label: t("taskWorkStop"), sub: t("taskWorkStopSub"), to: "/app/worker/work-stop", icon: AlertOctagon },
    { label: t("taskHealth"), sub: t("taskHealthSub"), to: "/app/worker/daily-health-log", icon: HeartPulse },
    { label: t("taskPpe"), sub: t("taskPpeSub"), to: "/app/worker/ppe-receipt", icon: HardHat },
  ];

  if (!manager) {
    return (
      <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="mobile-tasks">
        <div>
          <h1 className="text-base font-bold">{t("tasksTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t("tasksSub")}</p>
        </div>
        <Card>
          <CardContent className="p-0 divide-y">
            {workerItems.map((it) => (
              <Link
                key={it.to + it.label}
                to={it.to}
                className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50"
              >
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <it.icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.sub}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const sections = managerFieldSections();

  return (
    <div className="p-4 space-y-4 max-w-md mx-auto" data-testid="mobile-tasks">
      <div>
        <h1 className="text-base font-bold">현장</h1>
        <p className="text-xs text-muted-foreground">관제·점검·사람·현장 환경</p>
      </div>
      {sections.map((section) => (
        <div key={section.key} data-testid={`field-section-${section.key}`}>
          <h2 className="text-xs font-medium text-muted-foreground px-0.5 mb-1.5">{section.title}</h2>
          <Card>
            <CardContent className="p-0 divide-y">
              {section.items.map((it) => {
                const Icon = FIELD_ICONS[it.key] || ClipboardCheck;
                return (
                  <Link
                    key={it.to + it.label}
                    to={it.to}
                    data-testid={`field-link-${it.key}`}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50"
                  >
                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{it.label}</div>
                      <div className="text-xs text-muted-foreground">{it.sub}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
