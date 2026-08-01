import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, FileCheck2, ShieldAlert, ClipboardList, BookOpen } from "lucide-react";

const DOCS = [
  {
    label: "작업허가서",
    sub: "승인·진행 중 문서 조회",
    to: "/app/worker/permits",
    icon: FileCheck2,
    note: "작성은 PC",
  },
  {
    label: "위험성평가",
    sub: "승인본 위험요인·조치",
    to: "/app/worker/risk-assessment",
    icon: ShieldAlert,
    note: "뷰어",
  },
  {
    label: "작업계획서",
    sub: "승인본 핵심 위험",
    to: "/app/worker/work-plans",
    icon: ClipboardList,
    note: "뷰어",
  },
  {
    label: "사용 설명서",
    sub: "앱 도움말",
    to: "/manual",
    icon: BookOpen,
    note: "",
  },
];

export default function MobileDocs() {
  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="mobile-docs">
      <div>
        <h1 className="text-base font-bold">자료</h1>
        <p className="text-xs text-muted-foreground">
          모바일에서는 승인된 문서를 조회합니다. 작성·결재선 변경은 PC에서 합니다.
        </p>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {DOCS.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50"
            >
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <d.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {d.label}
                  {d.note && (
                    <span className="text-[10px] text-muted-foreground font-normal">{d.note}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{d.sub}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
