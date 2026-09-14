import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, FileCheck2, ShieldAlert, ClipboardList, BookOpen } from "lucide-react";
import { useWorkerLocale } from "@/hooks/useWorkerLocale";

export default function MobileDocs() {
  const { t } = useWorkerLocale();
  const docs = [
    {
      label: t("permitDoc"),
      sub: t("permitDocSub"),
      to: "/app/worker/permits",
      icon: FileCheck2,
    },
    {
      label: t("raDoc"),
      sub: t("raDocSub"),
      to: "/app/worker/risk-assessment",
      icon: ShieldAlert,
    },
    {
      label: t("planDoc"),
      sub: t("planDocSub"),
      to: "/app/worker/work-plans",
      icon: ClipboardList,
    },
    {
      label: "Manual",
      sub: "",
      to: "/manual",
      icon: BookOpen,
    },
  ];

  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="mobile-docs">
      <div>
        <h1 className="text-base font-bold">{t("docsTitle")}</h1>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {docs.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50"
            >
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <d.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{d.label}</div>
                {d.sub ? <div className="text-xs text-muted-foreground">{d.sub}</div> : null}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
