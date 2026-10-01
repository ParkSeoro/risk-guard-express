import type { RejectionNote } from "@/lib/priorRejectionReason";

export default function RejectionReasonBanner({
  title,
  notes,
}: {
  title: string;
  notes: RejectionNote[];
}) {
  if (!notes.length) return null;
  return (
    <div className="text-xs mt-1 space-y-1 print:hidden" data-testid="rejection-reason-banner">
      {notes.map((note) => (
        <p key={note.id} className="whitespace-pre-wrap text-foreground">
          <span className="font-medium text-destructive">{title}</span>
          {note.approverName ? ` · ${note.approverName}` : ""}
          {": "}
          {note.comment}
        </p>
      ))}
    </div>
  );
}
