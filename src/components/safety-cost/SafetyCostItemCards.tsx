import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Camera, ChevronDown, Eye, Paperclip, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { SAFETY_COST_CATEGORY_SHORT, formatKRW } from '@/lib/safetyCost';
import type { EvidenceKind } from '@/lib/safetyCostEvidencePack';
import {
  categoryTaxAllocationNotes,
  countCategoryKind,
  filesForItem,
  itemDailyChecklist,
  monthEndTaxLabel,
} from '@/lib/safetyCostItemEvidence';
import { ocrStatusBadge, ocrStatusBadgeVariant, ocrStatusLabel, summarizeOcrItems } from '@/lib/safetyCostOcr';

const statusVariant = (status: string) => (status === 'usable' ? 'default' : status === 'warning' ? 'destructive' : 'secondary');
export const statusLabel: Record<string, string> = { usable: '사용 가능', warning: '사용 불가', review: '검토 필요' };

type Item = {
  id: string;
  item_name?: string;
  specification?: string;
  maker?: string;
  supplier_name?: string;
  category_code?: string;
  category_name?: string;
  classification_status?: string;
  ai_reason?: string;
  amount?: number;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  supply_amount?: number;
  vat_amount?: number;
  transaction_date?: string;
  usage_date?: string;
  ocr_status?: string;
  ocr_raw_text?: string;
  project_id?: string;
  report_id?: string;
  construction_id?: string;
  company_id?: string;
};

type Evidence = {
  id?: string;
  item_id?: string | null;
  evidence_kind?: string | null;
  category_code?: string | null;
  file_name?: string;
  file_url?: string;
  note?: string | null;
};

type Props = {
  items: Item[];
  evidence: Evidence[];
  highlightedIds?: string[];
  reportLocked: boolean;
  isLegacyImport: boolean;
  itemSearch: string;
  onItemSearch: (v: string) => void;
  displayDate: (item: Item) => string;
  datePriorityLabel: (item: Item) => string;
  onAdd: () => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  onLegal: (item: Item) => void;
  onOpenPpe?: () => void;
  onOpenPack?: () => void;
  onOpenAi?: () => void;
  onUpload: (item: Item, files: FileList | null, kind: EvidenceKind) => void;
};

function FileChips({ files }: { files: Evidence[] }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {files.map((f, i) => (
        <li key={f.id || `${f.file_name}-${i}`}>
          {f.file_url ? (
            <a href={f.file_url} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline-offset-2 hover:underline">
              {f.file_name || '파일'}
            </a>
          ) : (
            <span className="text-[11px] text-muted-foreground">{f.file_name || '파일'}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function KindUpload({
  label,
  disabled,
  capture,
  accept,
  onUpload,
}: {
  label: string;
  disabled: boolean;
  capture?: boolean;
  accept: string;
  onUpload: (files: FileList | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={disabled} onClick={() => ref.current?.click()}>
        {capture ? <Camera className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        accept={accept}
        capture={capture ? 'environment' : undefined}
        disabled={disabled}
        onChange={(e) => {
          onUpload(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </>
  );
}

export function SafetyCostItemCards({
  items,
  evidence,
  highlightedIds,
  reportLocked,
  isLegacyImport,
  itemSearch,
  onItemSearch,
  displayDate,
  datePriorityLabel,
  onAdd,
  onEdit,
  onDelete,
  onLegal,
  onOpenPpe,
  onOpenPack,
  onOpenAi,
  onUpload,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const highlight = useMemo(() => new Set(highlightedIds || []), [highlightedIds]);
  const ocrSummary = summarizeOcrItems(items);

  return (
    <div className="space-y-3">
      {items.length > 0 && (ocrSummary.rawChars || ocrSummary.lowCount || ocrSummary.correctedCount || ocrSummary.fallbackCount) ? (
        <p className="text-xs text-muted-foreground">
          OCR 원문 {ocrSummary.rawChars}자 · 신뢰도 낮음 {ocrSummary.lowCount}건 · AI 보정 {ocrSummary.correctedCount}건
          {ocrSummary.fallbackCount ? ` · 예비 추출 ${ocrSummary.fallbackCount}건` : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[12rem]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={itemSearch} onChange={(e) => onItemSearch(e.target.value)} placeholder="품명·공급자·분류·메이커 검색" className="pl-8" />
        </div>
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={onAdd} disabled={reportLocked}>
          <Plus className="h-3.5 w-3.5" /> 수기 입력
        </Button>
        {onOpenAi ? (
          <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={onOpenAi}>
            AI 자동분석
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {itemSearch ? '검색 결과가 없습니다.' : (
              <div className="space-y-3">
                <p>항목이 없습니다. OCR이 안 되면 수기로 넣고 명세·사진을 붙이세요.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" size="sm" onClick={onAdd} disabled={reportLocked}>수기 입력</Button>
                  {onOpenAi ? (
                    <Button type="button" size="sm" variant="outline" onClick={onOpenAi}>AI 자동분석</Button>
                  ) : null}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => {
            const taxCount = countCategoryKind(items, evidence, String(it.category_code || ''), 'tax_invoice');
            const taxNotes = categoryTaxAllocationNotes(items, evidence, String(it.category_code || ''));
            const checks = itemDailyChecklist(it, evidence, taxCount, taxNotes.length > 0);
            const daily = checks.filter((c) => c.timing === 'daily');
            const monthEnd = checks.find((c) => c.timing === 'month_end');
            const txFiles = filesForItem(evidence, it.id).filter((f) => f.evidence_kind === 'transaction');
            const photoFiles = filesForItem(evidence, it.id).filter((f) => f.evidence_kind === 'site_photo');
            const short = SAFETY_COST_CATEGORY_SHORT[String(it.category_code || '')] || it.category_name || '미분류';
            const locked = reportLocked || isLegacyImport;
            return (
              <Card key={it.id} className={highlight.has(it.id) ? 'ring-2 ring-primary' : undefined}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{short}</Badge>
                        <Badge variant={statusVariant(it.classification_status || 'review') as 'default' | 'destructive' | 'secondary'}>
                          {statusLabel[it.classification_status || ''] || it.classification_status || '검토 필요'}
                        </Badge>
                        {ocrStatusBadge(it.ocr_status) ? (
                          <Badge variant={ocrStatusBadgeVariant(it.ocr_status)} title={ocrStatusLabel(it.ocr_status)}>
                            {ocrStatusBadge(it.ocr_status)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="font-medium text-sm">{it.item_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {displayDate(it) || '—'} · {it.supplier_name || '공급자 없음'}
                        {it.specification ? ` · ${it.specification}` : ''}
                      </p>
                    </div>
                    <p className="font-semibold shrink-0">{formatKRW(it.amount)}</p>
                  </div>
                  {it.ai_reason ? <p className="text-xs text-muted-foreground leading-snug">{it.ai_reason}</p> : null}

                  {isLegacyImport ? (
                    <p className="text-xs text-muted-foreground">이관 면제 — 항목별 증빙을 요구하지 않습니다.</p>
                  ) : (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {daily.map((row) => (
                          <span key={row.kind} className={row.ok ? 'text-foreground' : 'text-destructive'}>
                            {row.ok ? '✓' : '!'} {row.label} {row.count}장
                          </span>
                        ))}
                        {monthEnd ? (
                          <span className="text-muted-foreground">{monthEndTaxLabel(monthEnd.ok, taxCount > 0)}</span>
                        ) : null}
                      </div>
                      {taxNotes.length ? (
                        <p className="text-[11px] text-muted-foreground">계산서 배분: {taxNotes.join(' · ')}</p>
                      ) : null}
                      <FileChips files={[...txFiles, ...photoFiles]} />
                      <div className="flex flex-wrap gap-1.5">
                        <KindUpload
                          label="명세 추가"
                          disabled={locked}
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"
                          onUpload={(files) => onUpload(it, files, 'transaction')}
                        />
                        <KindUpload
                          label="사진대지"
                          disabled={locked}
                          accept="image/*"
                          onUpload={(files) => onUpload(it, files, 'site_photo')}
                        />
                        <KindUpload
                          label="촬영"
                          disabled={locked}
                          capture
                          accept="image/*"
                          onUpload={(files) => onUpload(it, files, 'site_photo')}
                        />
                        {it.category_code === '3' && onOpenPpe ? (
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onOpenPpe}>
                            지급대장
                          </Button>
                        ) : null}
                        {monthEnd && onOpenPack ? (
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onOpenPack}>
                            월말 세금계산서
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-8 gap-1" onClick={() => onLegal(it)}>
                      <Eye className="h-3 w-3" /> 근거
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => onEdit(it)} disabled={reportLocked} aria-label="항목 수정">
                      <Pencil className="h-3.5 w-3.5" /> 수정
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(it)} disabled={reportLocked} aria-label="항목 삭제">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Collapsible open={showTable} onOpenChange={setShowTable}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTable ? 'rotate-180' : ''}`} />
            전체 표
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card>
            <CardContent className="p-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>거래날짜</TableHead>
                    <TableHead>공급자</TableHead>
                    <TableHead>분류</TableHead>
                    <TableHead>품명/규격</TableHead>
                    <TableHead>금액</TableHead>
                    <TableHead>판정</TableHead>
                    <TableHead>판독</TableHead>
                    <TableHead>증빙</TableHead>
                    <TableHead>관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={`tbl-${it.id}`}>
                      <TableCell className="text-xs">
                        {displayDate(it) || '—'}
                        <div className="text-[10px] text-muted-foreground">{datePriorityLabel(it)}</div>
                      </TableCell>
                      <TableCell className="text-xs">{it.supplier_name || '—'}</TableCell>
                      <TableCell className="text-xs">{SAFETY_COST_CATEGORY_SHORT[String(it.category_code || '')] || it.category_name}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{it.item_name}</div>
                        <div className="text-[11px] text-muted-foreground">{it.specification || ''}</div>
                      </TableCell>
                      <TableCell className="font-semibold">{formatKRW(it.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(it.classification_status || 'review') as 'default' | 'destructive' | 'secondary'}>
                          {statusLabel[it.classification_status || ''] || it.classification_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ocrStatusBadgeVariant(it.ocr_status)} title={ocrStatusLabel(it.ocr_status)}>
                          {ocrStatusBadge(it.ocr_status) || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{filesForItem(evidence, it.id).length}장</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(it)} aria-label="항목 수정">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => onDelete(it)} disabled={reportLocked} aria-label="항목 삭제">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
