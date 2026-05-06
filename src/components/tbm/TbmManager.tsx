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
import { Plus, QrCode, Printer, Users, Trash2, Power, Pencil } from 'lucide-react';

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
  const [editing, setEditing] = useState<TbmSession | null>(null);
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
  const [companyId, setCompanyId] = useState('');
  const [processCategory, setProcessCategory] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);

  const load = async () => {
    let q = supabase.from('tbm_sessions' as any).select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    if (runId) q = q.eq('run_id', runId);
    const { data } = await q;
    setSessions((data as any) || []);
    const { data: cs } = await supabase.from('companies').select('id, name, type').eq('project_id', projectId).order('name');
    setCompanies(cs || []);
  };

  useEffect(() => { load(); }, [projectId, runId]);

  const resetForm = () => {
    setTitle(''); setTbmDate(new Date().toISOString().slice(0, 10));
    setLocation(''); setLeader(''); setSummary(''); setCompanyId(''); setProcessCategory('');
  };

  const openEdit = (s: any) => {
    setEditing(s);
    setTitle(s.title || ''); setTbmDate(s.tbm_date || ''); setLocation(s.location || '');
    setLeader(s.leader_name || ''); setSummary(s.briefing_summary || '');
    setCompanyId(s.company_id || ''); setProcessCategory(s.process_category || '');
  };

  const save = async () => {
    if (!title.trim()) return toast({ title: '제목을 입력하세요.', variant: 'destructive' });
    if (!companyId) return toast({ title: '회사(시공사/협력사)를 선택하세요.', variant: 'destructive' });
    const cmpName = companies.find(c => c.id === companyId)?.name || '';
    const payload: any = {
      title, tbm_date: tbmDate, location, leader_name: leader,
      briefing_summary: summary, company_id: companyId, company_name: cmpName,
      process_category: processCategory,
    };
    if (editing) {
      const { error } = await supabase.from('tbm_sessions' as any).update(payload).eq('id', editing.id);
      if (error) return toast({ title: '수정 실패', description: error.message, variant: 'destructive' });
      toast({ title: 'TBM이 수정되었습니다.' });
      setEditing(null);
    } else {
      const { error } = await supabase.from('tbm_sessions' as any).insert({
        ...payload, project_id: projectId, run_id: runId || null,
        briefing_risks: defaultRisks as any,
      });
      if (error) return toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
      toast({ title: 'TBM이 생성되었습니다.' });
      setShowCreate(false);
    }
    resetForm();
    load();
  };

  const toggleActive = async (s: TbmSession) => {
    await supabase.from('tbm_sessions' as any).update({ is_active: !s.is_active }).eq('id', s.id);
    load();
  };

  const remove = async (s: TbmSession) => {
    const reason = prompt(`이 TBM "${s.title}"을(를) 삭제합니다. 사유를 입력하세요.`);
    if (!reason) return;
    const { error } = await supabase.from('tbm_sessions' as any).delete().eq('id', s.id);
    if (error) return toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    toast({ title: 'TBM이 삭제되었습니다.' });
    load();
  };

  const getPublicBase = () => {
    const stored = (typeof window !== 'undefined' && localStorage.getItem('tbm_public_base_url')) || '';
    if (stored) return stored.replace(/\/$/, '');
    const origin = window.location.origin;
    // 미리보기/샌드박스 도메인은 로그인 필요 → 게시 도메인으로 대체
    if (/id-preview--|lovable\.dev|lovable-sandbox|localhost|127\.0\.0\.1/.test(origin)) {
      return 'https://safenex.org';
    }
    return origin;
  };

  const openQr = async (s: TbmSession) => {
    const base = getPublicBase();
    const url = `${base}/tbm/${s.qr_token}`;
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
                  <Button size="sm" variant="outline" onClick={() => openQr(s)} title="QR"><QrCode className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => openParts(s)} title="참여자"><Users className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(s)} title="활성/종료"><Power className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)} title="수정"><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => remove(s)} title="삭제"><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate || !!editing} onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditing(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'TBM 수정' : 'TBM 생성'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>제목 *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026-05-06 오전 TBM" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>일자</Label><Input type="date" value={tbmDate} onChange={(e) => setTbmDate(e.target.value)} /></div>
              <div><Label>장소</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
            </div>
            <div><Label>주관자</Label><Input value={leader} onChange={(e) => setLeader(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>회사 (시공사/협력사) *</Label>
                <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">선택</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                </select>
              </div>
              <div><Label>공종</Label><Input value={processCategory} onChange={(e) => setProcessCategory(e.target.value)} placeholder="예: 철근콘크리트" /></div>
            </div>
            <div><Label>브리핑 요약</Label><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} /></div>
            {!editing && defaultRisks.length > 0 && (
              <p className="text-xs text-muted-foreground">위험성평가에서 주요 위험 {defaultRisks.length}건이 자동 포함됩니다.</p>
            )}
            <p className="text-xs text-warning">⚠ 회사 선택 필수: QR 스캔 시 해당 회사의 위험성평가만 매칭됩니다.</p>
            <Button onClick={save} className="w-full">{editing ? '수정' : '생성'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrSession} onOpenChange={(v) => !v && setQrSession(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{qrSession?.title} QR</DialogTitle></DialogHeader>
          <div className="text-center space-y-3">
            {qrDataUrl && <img src={qrDataUrl} alt="QR" className="mx-auto w-72 h-72" />}
            <p className="text-xs text-muted-foreground break-all">{qrSession && `${getPublicBase()}/tbm/${qrSession.qr_token}`}</p>
            <div className="text-left space-y-1">
              <Label className="text-xs">QR 공개 베이스 URL (모바일에서 접속 가능한 도메인)</Label>
              <div className="flex gap-1">
                <Input
                  defaultValue={localStorage.getItem('tbm_public_base_url') || getPublicBase()}
                  placeholder="https://safenex.org"
                  className="h-8 text-xs"
                  onBlur={(e) => {
                    const v = e.target.value.trim().replace(/\/$/, '');
                    if (v) localStorage.setItem('tbm_public_base_url', v);
                    else localStorage.removeItem('tbm_public_base_url');
                    if (qrSession) openQr(qrSession);
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">미리보기 도메인은 로그인이 필요해 외부 폰에서 접속이 안 됩니다. 게시된 도메인(예: safenex.org)을 사용하세요.</p>
            </div>
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
