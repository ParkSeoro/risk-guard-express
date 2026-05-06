import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, QrCode, Printer, Users, Trash2, Power } from 'lucide-react';

interface Props {
  projectId: string;
  runId?: string;
  /** Risk briefing items pre-filled into new TBM (hazard/grade/measure) */
  defaultRisks?: Array<{ hazard: string; grade: string; measure: string }>;
}

type TbmSession = {
  id: string; title: string; tbm_date: string; location: string; leader_name: string;
  qr_token: string; is_active: boolean; briefing_summary: string; briefing_risks: any;
};

export default function TbmManager({ projectId, runId, defaultRisks = [] }: Props) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<TbmSession[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [qrSession, setQrSession] = useState<TbmSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [participants, setParticipants] = useState<any[]>([]);
  const [showParts, setShowParts] = useState<TbmSession | null>(null);

  // form
  const [title, setTitle] = useState('');
  const [tbmDate, setTbmDate] = useState(new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState('');
  const [leader, setLeader] = useState('');
  const [summary, setSummary] = useState('');

  const load = async () => {
    let q = supabase.from('tbm_sessions' as any).select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    if (runId) q = q.eq('run_id', runId);
    const { data } = await q;
    setSessions((data as any) || []);
  };

  useEffect(() => { load(); }, [projectId, runId]);

  const create = async () => {
    if (!title.trim()) return toast({ title: '제목을 입력하세요.', variant: 'destructive' });
    const { error } = await supabase.from('tbm_sessions' as any).insert({
      project_id: projectId, run_id: runId || null,
      title, tbm_date: tbmDate, location, leader_name: leader,
      briefing_summary: summary, briefing_risks: defaultRisks as any,
    });
    if (error) return toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    toast({ title: 'TBM이 생성되었습니다.' });
    setShowCreate(false); setTitle(''); setLocation(''); setLeader(''); setSummary('');
    load();
  };

  const toggleActive = async (s: TbmSession) => {
    await supabase.from('tbm_sessions' as any).update({ is_active: !s.is_active }).eq('id', s.id);
    load();
  };

  const remove = async (s: TbmSession) => {
    if (!confirm('이 TBM을 삭제하시겠습니까?')) return;
    await supabase.from('tbm_sessions' as any).delete().eq('id', s.id);
    load();
  };

  const openQr = async (s: TbmSession) => {
    const url = `${window.location.origin}/tbm/${s.qr_token}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 2 });
    setQrDataUrl(dataUrl);
    setQrSession(s);
  };

  const openParts = async (s: TbmSession) => {
    setShowParts(s);
    const { data } = await supabase.from('tbm_participations' as any).select('*').eq('tbm_session_id', s.id).order('participated_at');
    setParticipants((data as any) || []);
  };

  const printQr = () => {
    if (!qrSession || !qrDataUrl) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>TBM QR</title><style>
      body{font-family:'Malgun Gothic',sans-serif;text-align:center;padding:40px}
      img{width:380px;height:380px}
      h1{font-size:24px;margin:8px 0}
      p{color:#555;margin:4px 0}
    </style></head><body>
      <h1>${qrSession.title}</h1>
      <p>${qrSession.tbm_date} · ${qrSession.location || ''}</p>
      <img src="${qrDataUrl}"/>
      <p style="font-size:14px;margin-top:16px">스마트폰으로 QR을 스캔하여 참여하세요</p>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><QrCode className="h-4 w-4" /> TBM 세션 (QR 근로자 참여)</h3>
        <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" />TBM 생성</Button>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">등록된 TBM이 없습니다.</p>
      ) : (
        <div className="grid gap-2">
          {sessions.map(s => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{s.title}</p>
                    <Badge variant={s.is_active ? 'default' : 'secondary'}>{s.is_active ? '진행중' : '종료'}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.tbm_date} · {s.location} · {s.leader_name}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openQr(s)}><QrCode className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => openParts(s)}><Users className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(s)}><Power className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => remove(s)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>TBM 생성</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>제목 *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026-05-06 오전 TBM" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>일자</Label><Input type="date" value={tbmDate} onChange={(e) => setTbmDate(e.target.value)} /></div>
              <div><Label>장소</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
            </div>
            <div><Label>주관자</Label><Input value={leader} onChange={(e) => setLeader(e.target.value)} /></div>
            <div><Label>브리핑 요약</Label><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} /></div>
            {defaultRisks.length > 0 && (
              <p className="text-xs text-muted-foreground">위험성평가에서 주요 위험 {defaultRisks.length}건이 자동 포함됩니다.</p>
            )}
            <Button onClick={create} className="w-full">생성</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrSession} onOpenChange={(v) => !v && setQrSession(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{qrSession?.title} QR</DialogTitle></DialogHeader>
          <div className="text-center space-y-3">
            {qrDataUrl && <img src={qrDataUrl} alt="QR" className="mx-auto w-72 h-72" />}
            <p className="text-xs text-muted-foreground break-all">{qrSession && `${window.location.origin}/tbm/${qrSession.qr_token}`}</p>
            <Button onClick={printQr} className="w-full"><Printer className="h-4 w-4 mr-1" />QR 인쇄</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showParts} onOpenChange={(v) => !v && setShowParts(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{showParts?.title} 참여자 ({participants.length}명)</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {participants.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">아직 참여자가 없습니다.</p>
            ) : participants.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-md border">
                {p.signature_data && <img src={p.signature_data} alt="sig" className="h-12 w-24 object-contain border rounded bg-white" />}
                <div className="flex-1 text-sm">
                  <p className="font-semibold">{p.worker_name} <span className="text-xs text-muted-foreground">({p.worker_phone})</span></p>
                  <p className="text-xs text-muted-foreground">{p.company_name || '-'} · {new Date(p.participated_at).toLocaleString('ko-KR')}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
