import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Megaphone, CheckCircle2, Plus, Users } from 'lucide-react';
import { format } from 'date-fns';

interface Notice {
  id: string;
  project_id: string;
  run_id: string | null;
  title: string;
  body: string | null;
  posted_at: string;
  expires_at: string | null;
  acknowledged_worker_ids: string[] | null;
  created_at: string;
}

export default function AssessmentNotices() {
  const { user } = useAuth();
  const { selectedProjectId } = useGlobalProjectAccess();
  const { toast } = useToast();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!selectedProjectId) { setNotices([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('assessment_notices')
      .select('*')
      .eq('project_id', selectedProjectId)
      .order('posted_at', { ascending: false });
    if (error) toast({ title: '공지 조회 실패', description: error.message, variant: 'destructive' });
    setNotices((data as Notice[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [selectedProjectId]);

  const handleCreate = async () => {
    if (!title.trim() || !selectedProjectId) return;
    setSaving(true);
    const payload: any = {
      project_id: selectedProjectId,
      title: title.trim(),
      body: body.trim() || null,
      posted_at: new Date().toISOString(),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      created_by: user?.id,
    };
    const { error } = await supabase.from('assessment_notices').insert(payload);
    setSaving(false);
    if (error) { toast({ title: '공지 등록 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '공지 등록 완료' });
    setOpenCreate(false); setTitle(''); setBody(''); setExpiresAt('');
    load();
  };

  const handleAcknowledge = async (id: string) => {
    const { error } = await supabase.rpc('acknowledge_assessment_notice', { _notice_id: id });
    if (error) { toast({ title: '확인 실패', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '확인 처리되었습니다.' });
    load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> 위험성평가 공지
          </h1>
          <p className="text-sm text-muted-foreground">근로자 의견수렴·결과 공지 (위험성평가 고시)</p>
        </div>
        <Button size="sm" onClick={() => setOpenCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> 공지 작성
        </Button>
      </header>

      {loading ? (
        <div className="text-center text-muted-foreground py-12">로딩 중...</div>
      ) : notices.length === 0 ? (
        <Card><CardContent className="text-center text-muted-foreground py-12">등록된 공지가 없습니다.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {notices.map((n) => {
            const ackCount = n.acknowledged_worker_ids?.length ?? 0;
            const me = user?.id;
            const acked = me ? (n.acknowledged_worker_ids ?? []).includes(me) : false;
            const expired = n.expires_at && new Date(n.expires_at) < new Date();
            return (
              <Card key={n.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">{n.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary"><Users className="h-3 w-3 mr-1" />확인 {ackCount}</Badge>
                      {expired ? <Badge variant="outline">만료</Badge> : <Badge>게시중</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {n.body && <p className="text-sm whitespace-pre-wrap">{n.body}</p>}
                  <div className="text-xs text-muted-foreground">
                    게시 {format(new Date(n.posted_at), 'yyyy-MM-dd HH:mm')}
                    {n.expires_at && <> · 만료 {format(new Date(n.expires_at), 'yyyy-MM-dd HH:mm')}</>}
                  </div>
                  <div>
                    <Button size="sm" variant={acked ? 'secondary' : 'default'} disabled={acked} onClick={() => handleAcknowledge(n.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {acked ? '확인 완료' : '확인했습니다'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>위험성평가 공지 작성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>제목</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><Label>내용</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} /></div>
            <div><Label>만료일시 (선택)</Label><Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>취소</Button>
            <Button onClick={handleCreate} disabled={saving || !title.trim()}>등록</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
