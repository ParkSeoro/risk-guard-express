/**
 * 전회차 허가서 복제 다이얼로그
 * 같은 프로젝트·같은 종류의 최근 허가서 목록을 보여주고,
 * 선택 시 form_data / 위치 / 설명만 복사. 서명·결재·문서번호·상태는 초기화.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, FileSignature } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  permitType: string;
  currentPermitId: string;
  onCloned: () => void;
}

export default function ClonePreviousPermitDialog({
  open, onOpenChange, projectId, permitType, currentPermitId, onCloned,
}: Props) {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('work_permits' as any)
        .select('id, permit_date, work_description, work_location, permit_type, status, form_data')
        .eq('project_id', projectId)
        .eq('is_deleted', false)
        .eq('permit_type', permitType)
        .neq('id', currentPermitId)
        .order('permit_date', { ascending: false })
        .limit(20);
      setList((data as any[]) || []);
      setLoading(false);
    })();
  }, [open, projectId, permitType, currentPermitId]);

  const apply = async (src: any) => {
    // 복사 대상: form_data, work_description, work_location
    // 초기화 대상: signatures, gate_check_result, 결재 상태 유지 (현재 문서의 것)
    const cleanForm = { ...(src.form_data || {}) };
    // 서명/결재 파생 필드는 제거
    ['approved_at'].forEach((k) => delete (cleanForm as any)[k]);

    const { error } = await supabase.from('work_permits' as any).update({
      form_data: cleanForm,
      work_description: src.work_description || null,
      work_location: src.work_location || null,
    }).eq('id', currentPermitId);
    if (error) return toast({ title: '복제 실패', description: error.message, variant: 'destructive' });
    toast({ title: '전회차 내용을 복제했습니다.', description: '서명·결재·문서번호는 초기화 상태로 유지됩니다.' });
    onOpenChange(false);
    onCloned();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />전회차 허가서 복제
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          같은 종류의 최근 허가서 내용을 현재 문서에 복사합니다. 서명·결재선·문서번호·유효일자는 복사되지 않습니다.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">불러오는 중...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">복제할 수 있는 이전 허가서가 없습니다.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {list.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 p-3 border rounded">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileSignature className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium truncate">{p.work_description || '(설명 없음)'}</span>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p.permit_date} · {p.work_location || '-'}
                  </p>
                </div>
                <Button size="sm" onClick={() => apply(p)}>
                  <Copy className="h-3 w-3 mr-1" />복제
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
