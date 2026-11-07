import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AmountNotice } from '@/lib/safetyCostAmountMatch';

export default function SafetyCostMatchPanel({
  notices,
  monthMessage,
  cumulativeMessage,
  level,
  onSaveStatementTotal,
  onAttachApproval,
  onSaveReason,
  busy,
}: {
  notices: AmountNotice[];
  monthMessage: string;
  cumulativeMessage: string;
  level: 'ok' | 'approval' | 'over';
  onSaveStatementTotal: (fileId: string, total: number) => Promise<void>;
  onAttachApproval: (file: File) => Promise<void>;
  onSaveReason: (reason: string) => Promise<void>;
  busy?: boolean;
}) {
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const prompts = notices.filter((n) => !n.blocking && n.message.includes('합계를 적어'));
  const problems = notices.filter((n) => n.blocking);
  if (!monthMessage && !problems.length && !prompts.length) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">이번 달 맞추기</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {monthMessage ? <p>{monthMessage}</p> : null}
        {cumulativeMessage ? <p className="text-muted-foreground">{cumulativeMessage}</p> : null}
        {level !== 'ok' ? (
          <div className="space-y-2 rounded-md border p-2">
            <p>발주처 승인 공문 또는 사유가 있으면 50%를 넘어도 상신할 수 있습니다.</p>
            <Input type="file" disabled={busy} onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onAttachApproval(file);
            }} />
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="착공 초기처럼 인건비만 쓴 사유" />
            <Button type="button" size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => void onSaveReason(reason.trim())}>사유 저장</Button>
          </div>
        ) : null}
        {problems.map((n) => <p key={n.message}>{n.message}</p>)}
        {prompts.map((n) => {
          const key = n.fileId || n.message;
          return (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <span>{n.message}</span>
              <Input className="w-36" inputMode="numeric" value={totals[key] || ''} onChange={(e) => setTotals((p) => ({ ...p, [key]: e.target.value }))} placeholder="합계" />
              <Button type="button" size="sm" variant="outline" disabled={busy || !n.fileId} onClick={() => {
                const amount = Number(String(totals[key] || '').replace(/,/g, ''));
                if (n.fileId && Number.isFinite(amount)) void onSaveStatementTotal(n.fileId, amount);
              }}>저장</Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
