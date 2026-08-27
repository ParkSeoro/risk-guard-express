import { formatPermitStamp } from '@/lib/permitDateFormat';

/** 결재 화면 전용. 허가서 본문·인쇄에는 쓰지 않는다. */
export default function PermitExtendReasonBanner({
  formData,
  until,
}: {
  formData?: Record<string, unknown> | null;
  until?: string | null;
}) {
  const reason = String((formData || {}).work_extend_requested_reason || '').trim();
  const untilText = until ? formatPermitStamp(String(until)) : '';
  if (!reason && !untilText) return null;
  return (
    <div className="text-sm rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-1">
      {untilText ? (
        <div>
          연장 요청 시각: <strong>{untilText}</strong> 까지
        </div>
      ) : null}
      {reason ? (
        <div>
          <span className="text-muted-foreground">연장 사유: </span>
          <span className="whitespace-pre-wrap">{reason}</span>
        </div>
      ) : null}
    </div>
  );
}
