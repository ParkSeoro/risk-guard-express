import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { printHtmlDocument } from '@/lib/printHtmlDocument';
import { loadSafetyCostDocument } from '@/lib/safetyCostDocumentLoad';
import {
  buildSafetyCostDocument,
  defaultSafetyCostPrintScope,
  safetyCostPrintPreset,
  safetyCostPrintTitle,
  type SafetyCostPrintScope,
} from '@/lib/safetyCostDocumentBuilder';

const FIELDS: Array<{ key: keyof SafetyCostPrintScope; label: string; extra?: boolean }> = [
  { key: 'cover', label: '표지' },
  { key: 'toc', label: '목차', extra: true },
  { key: 'summary', label: '총괄' },
  { key: 'items', label: '항목별 내역' },
  { key: 'categorySheets', label: '사진·세금계산서 대지', extra: true },
  { key: 'ledger', label: '보호구 지급대장', extra: true },
  { key: 'stock', label: '보호구 수불', extra: true },
  { key: 'certificates', label: '보호구 인증서', extra: true },
  { key: 'emptyDividers', label: '실적 없는 비목 간지', extra: true },
  { key: 'originals', label: '인증서·결과서 원본 전체', extra: true },
];

export default function SafetyCostPrintDialog({
  open,
  onOpenChange,
  reportId,
  legacy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  legacy: boolean;
}) {
  const { toast } = useToast();
  const [scope, setScope] = useState<SafetyCostPrintScope>(() => defaultSafetyCostPrintScope(legacy));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setScope(defaultSafetyCostPrintScope(legacy));
  }, [open, legacy]);

  const toggle = (key: keyof SafetyCostPrintScope, checked: boolean) => {
    setScope((prev) => ({ ...prev, [key]: checked }));
  };

  const print = async () => {
    if (!reportId) return;
    setBusy(true);
    try {
      const input = await loadSafetyCostDocument(reportId, { includeStock: scope.stock });
      const pageImages: Record<string, string[]> = {};
      const unopened = [...(input.unopened || [])];
      if ((scope.originals || scope.certificates) && !legacy) {
        const { rasterizePdfUrlToPngDataUrls } = await import('@/lib/pdfPageRasterizer');
        for (const file of input.files) {
          const name = file.file_name || '';
          const isPdf = String(file.mime_type || '').includes('pdf') || name.toLowerCase().endsWith('.pdf');
          const want = (scope.certificates && file.evidence_kind === 'certificate')
            || (scope.originals && (file.evidence_kind === 'certificate' || (file.evidence_kind === 'report' && isPdf)));
          if (!want || !isPdf || !file.file_url) continue;
          try {
            const pages = await rasterizePdfUrlToPngDataUrls(file.file_url);
            if (!pages.length) unopened.push(name || file.id);
            else pageImages[file.id] = pages;
          } catch {
            unopened.push(name || file.id);
          }
        }
      }
      const { html } = buildSafetyCostDocument({ ...input, pageImages, unopened }, scope);
      await printHtmlDocument(html, {
        title: safetyCostPrintTitle({
          construction: input.report.construction_name,
          company: input.companyName,
          yearMonth: input.report.year_month,
        }),
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: '인쇄를 열지 못했습니다', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>사용내역서 인쇄</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">인쇄 창에서 머리글과 바닥글을 끄고 배율은 100%로 맞춥니다.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setScope(safetyCostPrintPreset('claim', legacy))}>기성</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setScope(safetyCostPrintPreset('supervise', legacy))}>감리</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setScope(safetyCostPrintPreset('close', legacy))}>준공</Button>
          </div>
          {legacy && <p className="text-sm text-muted-foreground">이관 월은 표지, 총괄, 항목 금액만 인쇄합니다.</p>}
          {FIELDS.map((field) => (
            <label key={field.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={scope[field.key]}
                disabled={busy || (legacy && field.extra)}
                onCheckedChange={(value) => toggle(field.key, value === true)}
              />
              {field.label}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>닫기</Button>
          <Button type="button" onClick={print} disabled={busy || !reportId}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            인쇄
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
