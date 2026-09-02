import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, AlertTriangle, Upload, Paperclip, ListOrdered } from 'lucide-react';
import {
  CATEGORY_EVIDENCE_PACK,
  EVIDENCE_BIND_TOC,
  EVIDENCE_KIND_LABEL,
  evaluateEvidencePack,
  packGateSummary,
  type EvidenceKind,
  type ItemLike,
  type EvidenceFileLike,
} from '@/lib/safetyCostEvidencePack';
import { formatKRW } from '@/lib/safetyCost';
import { cloneEvidenceToCategories, itemMissingDailyHard, resolvedFileCategory } from '@/lib/safetyCostItemEvidence';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';

type Props = {
  projectId: string;
  companyId: string;
  constructionId: string;
  reportId: string;
  items: ItemLike[];
  evidence: Array<EvidenceFileLike & { id?: string; file_name?: string; file_url?: string }>;
  ppeLedgerSignedCount: number;
  userId?: string;
  onChanged: () => void;
  onOpenPpeLedger?: () => void;
  /** 승인본 이관 월 — 항목별 증빙 업로드·게이트 없음 */
  exempt?: boolean;
};

const KIND_OPTIONS = Object.entries(EVIDENCE_KIND_LABEL) as [EvidenceKind, string][];

export function EvidencePackPanel({
  projectId, companyId, constructionId, reportId,
  items, evidence, ppeLedgerSignedCount, userId, onChanged, onOpenPpeLedger, exempt,
}: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadCat, setUploadCat] = useState('3');
  const [uploadCats, setUploadCats] = useState<string[]>([]);
  const [uploadKind, setUploadKind] = useState<EvidenceKind>('tax_invoice');
  const [uploading, setUploading] = useState(false);

  const pack = useMemo(
    () => evaluateEvidencePack({ items, files: evidence, ppeLedgerSignedCount, exempt }),
    [items, evidence, ppeLedgerSignedCount, exempt],
  );

  const activeCats = useMemo(() => {
    const codes = new Set((pack.eligibleItems || []).map((i) => String(i.category_code || '')));
    return CATEGORY_EVIDENCE_PACK.filter((p) => codes.has(p.code));
  }, [pack.eligibleItems]);

  const itemCat = useMemo(
    () => new Map((pack.eligibleItems || []).map((i) => [i.id, String(i.category_code || '')])),
    [pack.eligibleItems],
  );

  const gate = packGateSummary(pack);
  const taxTargetCats = useMemo(
    () => CATEGORY_EVIDENCE_PACK.filter((p) => p.requirements.some((r) => r.kind === 'tax_invoice')),
    [],
  );

  useEffect(() => {
    setUploadCats((prev) => {
      if (prev.length) return prev;
      const defaults = activeCats
        .filter((c) => c.requirements.some((r) => r.kind === 'tax_invoice'))
        .map((c) => c.code);
      return defaults.length ? defaults : ['3'];
    });
  }, [activeCats]);

  if (exempt || pack.exempt) {
    return (
      <Card className="border-success/40">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              이관 월 증빙 면제
            </CardTitle>
            <Badge>이관 면제</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>승인본 총괄 이관 월은 <span className="text-foreground">월×비목 금액</span>만 적재합니다. 항목별 거래명세·세금계산서·지급대장은 요구하지 않습니다.</p>
          <p className="text-xs">최초본(이관)은 승인본 보관으로 충분합니다. 당월 신규 작성 내역서만 증빙 패키지를 맞춥니다.</p>
        </CardContent>
      </Card>
    );
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length || !userId) return;
    const targetCats = uploadKind === 'tax_invoice'
      ? [...new Set(uploadCats.filter(Boolean))]
      : [uploadCat];
    if (!targetCats.length) {
      toast({ title: '세금계산서가 해당하는 비목을 선택하세요.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const rows: any[] = [];
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        // storage RLS: path must contain project UUID
        const path = `safety-cost/${projectId}/${reportId}/pack/${targetCats.join('-')}_${uploadKind}_${Date.now()}_${safe}`;
        let uploaded;
        try {
          uploaded = await uploadAttachmentFile(path, file);
        } catch (e: any) {
          toast({ title: '업로드 실패', description: e?.message || String(e), variant: 'destructive' });
          continue;
        }
        const source = {
          report_id: reportId,
          construction_id: constructionId,
          project_id: projectId,
          company_id: companyId,
          file_name: uploaded.file.name,
          file_path: uploaded.path,
          file_url: uploaded.publicUrl,
          mime_type: uploaded.file.type || 'application/octet-stream',
          file_size: uploaded.finalBytes,
          uploaded_by: userId,
          evidence_kind: uploadKind,
        };
        if (uploadKind === 'tax_invoice') {
          rows.push(...cloneEvidenceToCategories(source, targetCats));
        } else {
          rows.push({
            ...source,
            item_id: null,
            category_code: targetCats[0],
          });
        }
      }
      if (rows.length) {
        const { error } = await supabase.from('safety_cost_evidence_files' as any).insert(rows);
        if (error) throw error;
        toast({ title: `증빙 ${rows.length}건 첨부됨` });
        onChanged();
      }
    } catch (e: any) {
      toast({ title: '증빙 저장 실패', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListOrdered className="h-4 w-4" /> 실무 철 순서 (감사 대응 TOC)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-sm space-y-1 list-decimal pl-5 text-muted-foreground">
            {EVIDENCE_BIND_TOC.map((t) => (
              <li key={t.id}><span className="text-foreground">{t.title}</span></li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground mt-3">
            출력/결재 전 아래 필수 증빙을 맞추면, 하이테크 승인본과 같은 패키지로 정리됩니다.
          </p>
        </CardContent>
      </Card>

      <Card className={pack.ready ? 'border-success/40' : 'border-destructive/40'}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              {pack.ready
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <AlertTriangle className="h-4 w-4 text-destructive" />}
              월말 상신 · 법정·실무 필수 증빙 게이트
            </CardTitle>
            <Badge variant={gate.ok ? 'default' : 'destructive'}>
              {gate.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeCats.length === 0 ? (
            <p className="text-sm text-muted-foreground">금액이 있는 사용 항목이 없습니다. 먼저 항목을 입력하세요.</p>
          ) : (
            activeCats.map((cat) => {
              const catRows = pack.rows.filter((r) => r.code === cat.code);
              const amount = catRows[0]?.amount || 0;
              return (
                <div key={cat.code} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{cat.code}. {cat.name}</p>
                    <span className="text-xs text-muted-foreground">{formatKRW(amount)}</span>
                  </div>
                  {(() => {
                    const recon = pack.reconcile.find((r) => r.code === cat.code);
                    if (!recon) return null;
                    return (
                      <p className={`text-xs ${recon.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                        대사: 사용 {formatKRW(recon.usableTotal)} · 명세연결 {formatKRW(recon.statementLinkedTotal)}
                        {recon.ok ? ' · 일치' : ` · 차액 ${formatKRW(recon.difference)}`}
                      </p>
                    );
                  })()}
                  {items.filter((i) => String(i.category_code) === cat.code && itemMissingDailyHard(i, evidence)).map((i) => (
                    <p key={i.id} className="text-[11px] text-destructive">
                      {(i as { item_name?: string }).item_name || i.id} — 매일 증빙(명세·사진) 부족
                    </p>
                  ))}
                  <div className="grid gap-1.5">
                    {catRows.map((row) => (
                      <div key={`${row.code}-${row.requirement.kind}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5">
                          {row.ok
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                            : <AlertTriangle className={`h-3.5 w-3.5 ${row.requirement.hard ? 'text-destructive' : 'text-warning'}`} />}
                          {row.requirement.label}
                          {row.requirement.hard
                            ? <Badge variant="outline" className="text-[10px] h-5">필수</Badge>
                            : <Badge variant="secondary" className="text-[10px] h-5">권장</Badge>}
                        </span>
                        <span className="text-muted-foreground">{row.count}건</span>
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const taxFiles = evidence.filter(
                      (f) => f.evidence_kind === 'tax_invoice' && resolvedFileCategory(f, itemCat) === cat.code,
                    );
                    if (!taxFiles.length) {
                      return <p className="text-[11px] text-muted-foreground">월말 세금계산서: 이 비목 대기</p>;
                    }
                    return (
                      <ul className="text-[11px] text-muted-foreground space-y-0.5">
                        {taxFiles.map((f, i) => (
                          <li key={(f as { id?: string }).id || `${cat.code}-tax-${i}`}>
                            세금계산서 {i + 1}: {(f as { file_name?: string }).file_name || '파일'}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                  {cat.code === '3' && (
                    <Button size="sm" variant="outline" className="mt-1" onClick={onOpenPpeLedger}>
                      보호구 지급대장 작성
                    </Button>
                  )}
                  <p className="text-[11px] text-muted-foreground">{cat.tips.join(' · ')}</p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" /> 증빙 첨부 (비목·종류 지정)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>증빙 종류</Label>
              <Select value={uploadKind} onValueChange={(v) => setUploadKind(v as EvidenceKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {uploadKind === 'tax_invoice' ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>이 계산서가 해당하는 비목 (여러 개 가능)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {taxTargetCats.map((c) => {
                    const checked = uploadCats.includes(c.code);
                    return (
                      <label key={c.code} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setUploadCats((prev) => (v === true
                              ? [...new Set([...prev, c.code])]
                              : prev.filter((code) => code !== c.code)));
                          }}
                        />
                        <span>{c.code}. {c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>비목</Label>
                <Select value={uploadCat} onValueChange={setUploadCat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_EVIDENCE_PACK.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.code}. {c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} className="gap-1">
              <Paperclip className="h-4 w-4" /> {uploading ? '업로드 중…' : '파일 선택·첨부'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"
              onChange={(e) => handleUpload(e.target.files)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            세금계산서 한 장에 여러 비목 금액이 같이 있으면 해당 비목을 모두 고릅니다. 파일은 하나이고 비목마다 연결됩니다.
            계산서 금액은 읽지 않습니다. 상신 대사는 <span className="text-foreground">사용 가능 합 ↔ 거래명세가 연결된 줄 합</span>입니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
