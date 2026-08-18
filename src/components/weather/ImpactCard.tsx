export default function ImpactCard({
  title,
  status,
  detail,
}: {
  title: string;
  status: string;
  detail: string;
}) {
  const colors = {
    safe: "border-success/30 bg-success/5",
    warning: "border-warning/30 bg-warning/5",
    danger: "border-destructive/30 bg-destructive/5",
  };
  const dotColors = { safe: "bg-success", warning: "bg-warning", danger: "bg-destructive" };
  const labels = { safe: "안전", warning: "주의", danger: "위험" };

  return (
    <div className={`p-3 rounded-lg border ${colors[status as keyof typeof colors] || colors.safe}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <div className={`h-2 w-2 rounded-full ${dotColors[status as keyof typeof dotColors]}`} />
          <span className="text-[10px] font-medium">{labels[status as keyof typeof labels]}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground whitespace-normal break-words">{detail}</p>
    </div>
  );
}
