import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, AlertTriangle, Upload, Paperclip, ListOrdered } from 'lucide-react';
import {
  CATEGORY_EVIDENCE_PACK,
  EVIDENCE_BIND_TOC,
  EVIDENCE_KIND_LABEL,
  evaluateEvidencePack,
  type EvidenceKind,
  type ItemLike,
  type EvidenceFileLike,
} from '@/lib/safetyCostEvidencePack';
import { formatKRW } from '@/lib/safetyCost';

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
};

const KIND_OPTIONS = Object.entries(EVIDENCE_KIND_LABEL) as [EvidenceKind, string][];

export function EvidencePackPanel({
  projectId, companyId, constructionId, reportId,
  items, evidence, ppeLedgerSignedCount, userId, onChanged, onOpenPpeLedger,
}: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadCat, setUploadCat] = useState('3');
  const [uploadKind, setUploadKind] = useState<EvidenceKind>('transaction');
  const [uploading, setUploading] = useState(false);

  const pack = useMemo(
    () => evaluateEvidencePack({ items, files: evidence, ppeLedgerSignedCount }),
    [items, evidence, ppeLedgerSignedCount],
  );

  const activeCats = useMemo(() => {
    const codes = new Set(items.filter((i) => Number(i.amount || 0) > 0).map((i) => String(i.category_code || '')));
    return CATEGORY_EVIDENCE_PACK.filter((p) => codes.has(p.code));
  }, [items]);

  async function handleUpload(files: FileList | null) {
    if (!files?.length || !userId) return;
    setUploading(true);
    try {
      const rows: any[] = [];
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `safety-cost/${reportId}/pack/${uploadCat}_${uploadKind}_${Date.now()}_${safe}`;
        const { error } = await supabase.storage.from('attachments').upload(path, file, {
          upsert: true,
          contentType: file.type || 'application/octet-stream',
        });
        if (error) {
          toast({ title: '업로드 실패', description: error.message, variant: 'destructive' });
          continue;
        }
        const { data } = supabase.storage.from('attachments').getPublicUrl(path);
        rows.push({
          report_id: reportId,
          item_id: null,
          construction_id: constructionId,
          project_id: projectId,
          company_id: companyId,
          category_code: uploadCat,
          evidence_kind: uploadKind,
          file_name: file.name,
          file_path: path,
          file_url: data.publicUrl,
          mime_type: file.type || 'application/octet-stream',
          file_size: file.size,
          uploaded_by: userId,
        });
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
              법정·실무 필수 증빙 게이트
            </CardTitle>
            <Badge variant={pack.ready ? 'default' : 'destructive'}>
              {pack.ready ? '상신 가능(증빙)' : `필수 누락 ${pack.hardMissing.length}건`}
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
            팁: 거래명세·세금계산서는 종류를 구분해 올리면 게이트가 자동으로 충족됩니다.
            보호구는 파일 지급대장 대신 아래 디지털 대장 서명을 권장합니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
