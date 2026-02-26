import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { sampleApprovals, sampleRiskItems } from "@/data/mockData";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

const Approvals = () => {
  // Group approvals by riskItemId
  const grouped = sampleApprovals.reduce((acc, ap) => {
    if (!acc[ap.riskItemId]) acc[ap.riskItemId] = [];
    acc[ap.riskItemId].push(ap);
    return acc;
  }, {} as Record<string, typeof sampleApprovals>);

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">결재함</h1>
        <p className="text-sm text-muted-foreground mt-1">작성 → 검토 → 승인 워크플로우</p>
      </div>

      <div className="space-y-3">
        {Object.entries(grouped).map(([riskId, steps]) => {
          const riskItem = sampleRiskItems.find(r => r.id === riskId);
          if (!riskItem) return null;
          return (
            <Card key={riskId}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">{riskItem.process} – {riskItem.subTask}</h3>
                    <p className="text-xs text-muted-foreground">{riskItem.hazard}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {steps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                        step.status === '승인' ? 'bg-success/10 text-success' :
                        step.status === '반려' ? 'bg-destructive/10 text-destructive' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {step.status === '승인' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                         step.status === '반려' ? <XCircle className="h-3.5 w-3.5" /> :
                         <Clock className="h-3.5 w-3.5" />}
                        <span>{step.step}</span>
                        <span className="opacity-70">({step.approver})</span>
                      </div>
                      {i < steps.length - 1 && (
                        <div className="h-px w-6 bg-border" />
                      )}
                    </div>
                  ))}
                </div>
                {steps.some(s => s.comment) && (
                  <p className="text-xs text-muted-foreground mt-2 ml-1">
                    코멘트: {steps.filter(s => s.comment).map(s => `${s.approver}: "${s.comment}"`).join(' | ')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Approvals;
