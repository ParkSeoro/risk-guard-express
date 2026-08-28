import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { uploadAttachmentFile } from '@/lib/compressUploadFile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';

type ArchiveFile = {
  id: string;
  file_name?: string;
  file_url?: string;
  created_at?: string;
  evidence_kind?: string;
  construction_id?: string;
};

type Props = {
  projectId: string;
  companyId: string;
  constructionId: string;
  userId?: string;
  files?: ArchiveFile[];
  onChanged?: () => void;
};

const sanitizeStorageFileName = (fileName: string) => {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}` : '';
  const baseName = fileName.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return `${baseName || 'document'}${extension}`;
};

/** 승인본은 보관만 한다. OCR/자동이관 없음. 월·항목은 수기. */
export function LegacyImportWizard({
  projectId, companyId, constructionId, userId, files, onChanged,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const archives = (files || []).filter(
    (f) => f.construction_id === constructionId && f.evidence_kind === 'legacy_pack',
  );

  async function attachFile(file: File) {
    setLoading(true);
    try {
      const safeName = sanitizeStorageFileName(file.name);
      const path = `safety-cost/${projectId}/${constructionId}/legacy-import/${Date.now()}_${safeName}`;
      const uploaded = await uploadAttachmentFile(path, file);
      const { error } = await supabase.from('safety_cost_evidence_files' as any).insert({
        project_id: projectId,
        company_id: companyId,
        construction_id: constructionId,
        report_id: null,
        evidence_kind: 'legacy_pack',
        file_name: uploaded.file.name,
        file_path: uploaded.path,
        file_url: uploaded.publicUrl,
        mime_type: uploaded.file.type || file.type || 'application/octet-stream',
        file_size: uploaded.finalBytes,
        uploaded_by: userId || null,
      });
      if (error) throw error;
      toast({ title: '승인본을 보관했습니다.', description: '월별 작성 후 사용 항목에서 수기로 입력하세요. 이 파일은 읽지 않습니다.' });
      onChanged?.();
    } catch (e: any) {
      toast({ title: '승인본 보관 실패', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function removeFile(id: string) {
    if (!window.confirm('이 보관 파일을 삭제할까요?')) return;
    const { error } = await supabase.from('safety_cost_evidence_files' as any).delete().eq('id', id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: '보관 파일을 삭제했습니다.' });
    onChanged?.();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          승인본 보관
          <Badge variant="secondary">수기 입력</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          발주처 승인본은 여기에 보관만 합니다. 글자를 읽거나 월보를 자동 만들지 않습니다.
          아래 <b>월별 작성</b>으로 달을 만든 뒤, 사용 항목에서 총괄·내역을 직접 입력하세요.
        </p>
        <Label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {loading ? '올리는 중…' : '승인본 첨부'}
          <Input
            type="file"
            accept=".pdf,.xls,.xlsx,.csv,.txt,image/*"
            className="hidden"
            disabled={loading}
            onChange={(e) => e.target.files?.[0] && attachFile(e.target.files[0])}
          />
        </Label>
        {archives.length > 0 && (
          <ul className="space-y-1">
            {archives.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-xs rounded-md border px-2 py-1.5">
                <a href={f.file_url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
                  {f.file_name || '승인본'}
                </a>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => removeFile(f.id)} aria-label="보관 파일 삭제">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default LegacyImportWizard;
