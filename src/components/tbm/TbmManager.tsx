import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { ExternalLink, Plus, QrCode, Printer, RefreshCw, Users, Trash2, Power, Pencil, FileText, Copy, ClipboardList, Search, CalendarDays, CheckCircle2, FileSignature, Sparkles } from 'lucide-react';
import AssigneeSelect from '@/components/AssigneeSelect';
import { useSoftDelete } from '@/hooks/useSoftDelete';
import { useGlobalProjectAccessOptional } from '@/components/AppLayout';
import { ensureTbmForPermit } from '@/lib/tbmFromPermit';
import { closeExpiredTbmSessions } from '@/lib/tbmLifecycle';
import { syncPermitCrewToTbm } from '@/lib/syncPermitCrewToTbm';
import { todayKst } from '@/lib/permitWorkDate';
import { useAuth } from '@/contexts/AuthContext';


interface Props {
  projectId: string;
  runId?: string;
  /** Risk briefing items pre-filled into new TBM (hazard/grade/measure) */
  defaultRisks?: Array<{ hazard: string; grade: string; measure: string }>;
}

type TbmSession = {
  id: string; title: string; tbm_date: string; location: string; leader_name: string;
  qr_token: string; is_active: boolean; briefing_summary: string; briefing_risks: any;
  work_content?: string; work_steps?: string; special_notes?: string; prohibited_actions?: string;
  process_category?: string; company_id?: string; company_name?: string;
};

const BRIEFING_TEMPLATE = `■ 오늘 작업 설명:
- 

■ 주요 위험 강조:
- 

■ 특별 주의사항:
- 

■ 작업 금지사항:
- `;

export default function TbmManager({ projectId, runId, defaultRisks = [] }: Props) {
  const access = useGlobalProjectAccessOptional();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { softDelete } = useSoftDelete();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusSessionId = searchParams.get('session');
  const focusHandledRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<TbmSession[]>([]);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPermitPick, setShowPermitPick] = useState(false);
  const [permitCandidates, setPermitCandidates] = useState<any[]>([]);
  const [permitPickBusy, setPermitPickBusy] = useState(false);

  const [editing, setEditing] = useState<TbmSession | null>(null);
  const [qrSession, setQrSession] = useState<TbmSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [qrGenerating, setQrGenerating] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [showParts, setShowParts] = useState<TbmSession | null>(null);

  // form
  const [title, setTitle] = useState('');
  const [tbmDate, setTbmDate] = useState(new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState('');
  const [leader, setLeader] = useState('');
  const [summary, setSummary] = useState(BRIEFING_TEMPLATE);
  const [companyId, setCompanyId] = useState('');
  const [processCategory, setProcessCategory] = useState('');
  const [companies, setCompanies] = useState<any[]>([]);
  const [workContent, setWorkContent] = useState('');
  const [workSteps, setWorkSteps] = useState('');
  const [specialNotes, setSpecialNotes] = useState('');
  const [prohibitedActions, setProhibitedActions] = useState('');
  const [risksDraft, setRisksDraft] = useState<Array<{ hazard: string; grade: string; measure: string }>>([]);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyCandidates, setCopyCandidates] = useState<TbmSession[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  /** '' = all dates; otherwise YYYY-MM-DD */
  const [dateFilter, setDateFilter] = useState(() => todayKst());

  const load = async () => {
    setLoading(true);
    // Past-dated sessions → 종료 (idempotent)
    await closeExpiredTbmSessions(projectId);
    let q = supabase.from('tbm_sessions' as any)
      .select('*')
      .eq('project_id', projectId)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .order('tbm_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (runId) q = q.eq('run_id', runId);
    if (access?.applyCompanyFilter) q = access.applyCompanyFilter(q);
    const { data } = await q;
    const list = ((data as any) || []) as TbmSession[];
    setSessions(list);
    // fetch participant counts in one shot
    if (list.length > 0) {
      const ids = list.map((s) => s.id);
      const { data: parts } = await supabase
        .from('tbm_participations' as any)
        .select('tbm_session_id')
        .in('tbm_session_id', ids);
      const counts: Record<string, number> = {};
      ((parts as any[]) || []).forEach((p) => {
        counts[p.tbm_session_id] = (counts[p.tbm_session_id] || 0) + 1;
      });
      setParticipantCounts(counts);
    } else {
      setParticipantCounts({});
    }
    const { fetchProjectCompanies } = await import('@/lib/projectCompanies');
    const cs = await fetchProjectCompanies(projectId);
    setCompanies(cs.map(c => ({ id: c.id, name: c.name, type: c.type })));
    setLoading(false);
  };


  useEffect(() => {
    load();
    const ch = supabase
      .channel(`tbm-rt-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tbm_sessions', filter: `project_id=eq.${projectId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tbm_participations' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [projectId, runId]);

  const resetForm = () => {
    setTitle(''); setTbmDate(new Date().toISOString().slice(0, 10));
    setLocation(''); setLeader(''); setSummary(BRIEFING_TEMPLATE);
    setCompanyId(''); setProcessCategory('');
    setWorkContent(''); setWorkSteps(''); setSpecialNotes(''); setProhibitedActions('');
    setRisksDraft(defaultRisks.length ? defaultRisks.map(r => ({ ...r })) : []);
  };

  // Initialize risksDraft when opening create dialog
  useEffect(() => {
    if (showCreate && !editing) {
      setRisksDraft(defaultRisks.length ? defaultRisks.map(r => ({ ...r })) : []);
    }
  }, [showCreate, editing, defaultRisks]);

  const openEdit = (s: any) => {
    setEditing(s);
    setTitle(s.title || ''); setTbmDate(s.tbm_date || ''); setLocation(s.location || '');
    setLeader(s.leader_name || ''); setSummary(s.briefing_summary || '');
    setCompanyId(s.company_id || ''); setProcessCategory(s.process_category || '');
    setWorkContent(s.work_content || ''); setWorkSteps(s.work_steps || '');
    setSpecialNotes(s.special_notes || ''); setProhibitedActions(s.prohibited_actions || '');
    const r = s.briefing_risks;
    const arr = Array.isArray(r) ? r : (r ? (() => { try { return JSON.parse(r); } catch { return []; } })() : []);
    setRisksDraft(arr.map((x: any) => ({ hazard: x.hazard || '', grade: x.grade || '', measure: x.measure || '' })));
  };

  const openCopyDialog = async () => {
    let q = supabase.from('tbm_sessions' as any)
      .select('*').eq('project_id', projectId)
      .order('tbm_date', { ascending: false }).limit(20);
    if (processCategory) q = q.eq('process_category', processCategory);
    if (access?.applyCompanyFilter) q = access.applyCompanyFilter(q);
    const { data } = await q;
    setCopyCandidates((data as any) || []);
    setShowCopyDialog(true);
  };

  const applyCopyFrom = (s: any) => {
    setWorkContent(s.work_content || '');
    setWorkSteps(s.work_steps || '');
    setSpecialNotes(s.special_notes || '');
    setProhibitedActions(s.prohibited_actions || '');
    setSummary(s.briefing_summary || BRIEFING_TEMPLATE);
    if (!processCategory && s.process_category) setProcessCategory(s.process_category);
    const r = s.briefing_risks;
    const arr = Array.isArray(r) ? r : (r ? (() => { try { return JSON.parse(r); } catch { return []; } })() : []);
    setRisksDraft(arr.map((x: any) => ({ hazard: x.hazard || '', grade: x.grade || '', measure: x.measure || '' })));
    setShowCopyDialog(false);
    toast({ title: '이전 TBM 내용을 불러왔습니다.', description: '근로자/서명/날짜는 복사되지 않았습니다.' });
  };

  const updateRisk = (idx: number, key: 'hazard' | 'grade' | 'measure', value: string) => {
    setRisksDraft(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  };
  const addRisk = () => setRisksDraft(prev => [...prev, { hazard: '', grade: '', measure: '' }]);
  const removeRisk = (idx: number) => setRisksDraft(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (!title.trim()) return toast({ title: '제목을 입력하세요.', variant: 'destructive' });
    if (!companyId) return toast({ title: '회사(시공사/협력사)를 선택하세요.', variant: 'destructive' });
    const cmpName = companies.find(c => c.id === companyId)?.name || '';
    const cleanRisks = risksDraft.filter(r => (r.hazard || '').trim() || (r.measure || '').trim());
    const payload: any = {
      title, tbm_date: tbmDate, location, leader_name: leader,
      briefing_summary: summary, company_id: companyId, company_name: cmpName,
      process_category: processCategory,
      work_content: workContent, work_steps: workSteps,
      special_notes: specialNotes, prohibited_actions: prohibitedActions,
      briefing_risks: cleanRisks as any,
    };
    if (editing) {
      const { error } = await supabase.from('tbm_sessions' as any).update(payload).eq('id', editing.id);
      if (error) return toast({ title: '수정 실패', description: error.message, variant: 'destructive' });
      toast({ title: 'TBM이 수정되었습니다.' });
      setEditing(null);
    } else {
      const { error } = await supabase.from('tbm_sessions' as any).insert({
        ...payload, project_id: projectId, run_id: runId || null,
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
    const res = await softDelete('tbm_sessions', s.id, {
      projectId,
      label: `TBM "${s.title}"`,
    });
    if (res.ok) load();
  };


  const PUBLIC_TBM_BASE_URL = 'https://safenex.org';

  const normalizePublicBase = (value?: string | null) => {
    const raw = (value || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withProtocol);
      if (/id-preview--|lovable\.dev|lovable-sandbox|localhost|127\.0\.0\.1/.test(url.host)) {
        return PUBLIC_TBM_BASE_URL;
      }
      return url.origin;
    } catch {
      return PUBLIC_TBM_BASE_URL;
    }
  };

  const getPublicBase = () => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('tbm_public_base_url') : '';
    const normalizedStored = normalizePublicBase(stored);
    if (normalizedStored) return normalizedStored;
    const normalizedOrigin = typeof window !== 'undefined' ? normalizePublicBase(window.location.origin) : '';
    return normalizedOrigin || PUBLIC_TBM_BASE_URL;
  };

  const createQrToken = () => {
    const webCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (webCrypto?.randomUUID) {
      return webCrypto.randomUUID().replace(/-/g, '');
    }
    if (webCrypto?.getRandomValues) {
      const bytes = new Uint8Array(24);
      webCrypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  };

  const hasValidQrToken = (token?: string) => /^[a-zA-Z0-9_-]{20,}$/.test(token || '');

  const buildQrUrl = (token: string) => `${getPublicBase()}/tbm/${encodeURIComponent(token)}`;

  const ensureQrToken = async (s: TbmSession, force = false) => {
    if (!force && hasValidQrToken(s.qr_token)) return s;
    const nextToken = createQrToken();
    const { data, error } = await supabase
      .from('tbm_sessions' as any)
      .update({ qr_token: nextToken })
      .eq('id', s.id)
      .select('*')
      .single();
    if (error) {
      toast({ title: 'QR 재생성 실패', description: error.message, variant: 'destructive' });
      return null;
    }
    const refreshed = ((data as any) || { ...s, qr_token: nextToken }) as TbmSession;
    setSessions((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
    setQrSession((current) => (current?.id === refreshed.id ? refreshed : current));
    return refreshed;
  };

  const renderQr = async (s: TbmSession) => {
    const url = buildQrUrl(s.qr_token);
    const dataUrl = await QRCode.toDataURL(url, {
      width: 512,
      margin: 4,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#ffffff' },
    });
    setQrUrl(url);
    setQrDataUrl(dataUrl);
    setQrSession(s);
  };

  const openQr = async (s: TbmSession) => {
    setQrGenerating(true);
    try {
      const refreshed = await ensureQrToken(s);
      if (refreshed) await renderQr(refreshed);
    } catch (err: any) {
      toast({ title: 'QR 이미지 생성 실패', description: err?.message || 'QR을 다시 생성해 주세요.', variant: 'destructive' });
    } finally {
      setQrGenerating(false);
    }
  };

  const regenerateQr = async () => {
    if (!qrSession) return;
    setQrGenerating(true);
    try {
      const refreshed = await ensureQrToken(qrSession, true);
      if (refreshed) {
        await renderQr(refreshed);
        toast({ title: 'QR이 새로 생성되었습니다.' });
      }
    } catch (err: any) {
      toast({ title: 'QR 재생성 실패', description: err?.message || '잠시 후 다시 시도하세요.', variant: 'destructive' });
    } finally {
      setQrGenerating(false);
    }
  };

  const openParts = async (s: TbmSession) => {
    setShowParts(s);
    const { data } = await supabase.from('tbm_participations' as any).select('*').eq('tbm_session_id', s.id).order('participated_at');
    setParticipants((data as any) || []);
  };

  // Deep-link from permit detail: ?session=<tbmId> → heal from permit crew, open participants
  useEffect(() => {
    if (!focusSessionId || loading || sessions.length === 0) return;
    if (focusHandledRef.current === focusSessionId) return;
    const target = sessions.find((s) => s.id === focusSessionId);
    if (!target) return;
    focusHandledRef.current = focusSessionId;

    let cancelled = false;
    (async () => {
      const { data: linked } = await supabase
        .from('work_permits' as any)
        .select('id')
        .eq('tbm_session_id', focusSessionId)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .maybeSingle();
      if (cancelled) return;
      if ((linked as any)?.id) {
        const sync = await syncPermitCrewToTbm({
          permitId: (linked as any).id,
          tbmSessionId: focusSessionId,
        });
        if (!cancelled && sync.ok && (sync.added > 0 || sync.removed > 0)) {
          toast({
            title: '허가서 명단 → TBM 맞춤',
            description: `추가 ${sync.added} · 정리 ${sync.removed}`,
          });
        }
      }
      if (!cancelled) {
        await openParts(target);
        if (target.tbm_date) setDateFilter(target.tbm_date);
        const next = new URLSearchParams(searchParams);
        next.delete('session');
        setSearchParams(next, { replace: true });
        await load();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot deep link
  }, [focusSessionId, loading, sessions]);

  const printQr = () => {
    if (!qrSession || !qrDataUrl) return;
    const printableUrl = qrUrl || buildQrUrl(qrSession.qr_token);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>TBM QR</title><style>
      body{font-family:'Malgun Gothic',sans-serif;text-align:center;padding:40px}
      img{width:380px;height:380px;image-rendering:pixelated}
      h1{font-size:24px;margin:8px 0}
      p{color:#555;margin:4px 0}
      .url{font-size:12px;word-break:break-all;color:#333;margin-top:10px}
    </style></head><body>
      <h1>${qrSession.title}</h1>
      <p>${qrSession.tbm_date} · ${qrSession.location || ''}</p>
      <img src="${qrDataUrl}"/>
      <p class="url">${printableUrl}</p>
      <p style="font-size:14px;margin-top:16px">스마트폰으로 QR을 스캔하여 참여하세요</p>
    </body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  const printTbmLog = async (s: TbmSession) => {
    // Fetch participants & project info
    const { data: parts } = await supabase.from('tbm_participations' as any)
      .select('*').eq('tbm_session_id', s.id).order('participated_at');
    const { data: project } = await supabase.from('projects')
      .select('name, site_name').eq('id', projectId).single();
    const sAny = s as any;
    const risksRaw = sAny.briefing_risks;
    const risks: Array<{ hazard?: string; grade?: string; measure?: string }> =
      Array.isArray(risksRaw) ? risksRaw : (risksRaw ? (() => { try { return JSON.parse(risksRaw); } catch { return []; } })() : []);
    const partsList = (parts as any[]) || [];

    const w = window.open('', '_blank');
    if (!w) { toast({ title: '팝업이 차단되었습니다.', variant: 'destructive' }); return; }

    const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const fmtDate = (d: string) => d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
    const today = sAny.tbm_date || '';

    const risksHtml = risks.length === 0
      ? `<tr><td colspan="3" class="muted">위험요인 없음</td></tr>`
      : risks.map((r) => `<tr>
          <td>${esc(r.hazard || '')}</td>
          <td class="center">${esc(r.grade || '')}</td>
          <td>${esc(r.measure || '')}</td>
        </tr>`).join('');

    const partsHtml = partsList.length === 0
      ? `<tr><td colspan="6" class="muted center">참여자 없음</td></tr>`
      : partsList.map((p, i) => `<tr>
          <td class="center">${i + 1}</td>
          <td>${esc(p.worker_name)}</td>
          <td>${esc(p.worker_phone)}</td>
          <td>${esc(p.company_name || '-')}</td>
          <td class="center">${fmtDate(p.participated_at)}</td>
          <td class="center">${p.signature_data ? `<img src="${esc(p.signature_data)}" />` : ''}</td>
        </tr>`).join('');

    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
      <title>TBM 일지 - ${esc(s.title)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; }
        body { font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif; color: #111; font-size: 11pt; }
        h1 { text-align: center; font-size: 18pt; margin: 0 0 4mm; border-bottom: 2px solid #111; padding-bottom: 3mm; }
        h2 { font-size: 12pt; margin: 5mm 0 2mm; padding: 2mm 3mm; background: #f0f0f0; border-left: 4px solid #111; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
        th, td { border: 1px solid #333; padding: 2mm 3mm; vertical-align: top; }
        th { background: #f5f5f5; font-weight: 600; text-align: left; }
        .info th { width: 22%; }
        .center { text-align: center; }
        .muted { color: #777; }
        td img { height: 14mm; max-width: 40mm; object-fit: contain; }
        /* 서명표는 한 장에 맞추지 않고 인원 수만큼 다음 장으로 이어짐 */
        html, body { height: auto; overflow: visible; }
        table, thead, tbody { page-break-inside: auto; }
        tr { page-break-inside: avoid; break-inside: avoid; }
        thead { display: table-header-group; }
        h2 { page-break-after: avoid; }
        .footer { margin-top: 6mm; font-size: 9pt; color: #555; text-align: right; }
      </style></head><body>
      <h1>TBM (Tool Box Meeting) 일지</h1>

      <h2>1. 기본 정보</h2>
      <table class="info">
        <tr><th>공사명</th><td>${esc((project as any)?.name || '')}</td><th>현장명</th><td>${esc((project as any)?.site_name || '')}</td></tr>
        <tr><th>작업명 / 제목</th><td>${esc(s.title)}</td><th>작업일자</th><td>${esc(today)} (KST)</td></tr>
        <tr><th>작업장소</th><td>${esc(s.location || '-')}</td><th>주관자</th><td>${esc(s.leader_name || '-')}</td></tr>
        <tr><th>공종</th><td>${esc(sAny.process_category || '-')}</td><th>회사 (시공사/협력사)</th><td>${esc(sAny.company_name || '-')}</td></tr>
      </table>

      <h2>2. 오늘 작업 내용</h2>
      <table><tr><td style="min-height:14mm;white-space:pre-wrap">${esc(sAny.work_content || '-')}</td></tr></table>

      <h2>3. 작업 순서</h2>
      <table><tr><td style="min-height:14mm;white-space:pre-wrap">${esc(sAny.work_steps || '-')}</td></tr></table>

      <h2>4. 위험요인 및 안전대책 (위험성평가 연동)</h2>
      <table>
        <thead><tr><th style="width:40%">위험요인</th><th style="width:15%" class="center">위험등급</th><th>안전대책</th></tr></thead>
        <tbody>${risksHtml}</tbody>
      </table>

      <h2>5. 특별 주의사항</h2>
      <table><tr><td style="min-height:12mm;white-space:pre-wrap">${esc(sAny.special_notes || '-')}</td></tr></table>

      <h2>6. 작업 금지사항</h2>
      <table><tr><td style="min-height:12mm;white-space:pre-wrap">${esc(sAny.prohibited_actions || '-')}</td></tr></table>

      <h2>7. TBM 브리핑 내용</h2>
      <table>
        <tr><td style="white-space:pre-wrap;min-height:18mm">${esc(s.briefing_summary || '-')}</td></tr>
      </table>

      <h2>8. 근로자 서명</h2>
      <table>
        <thead><tr>
          <th style="width:8%" class="center">No</th>
          <th style="width:14%">성명</th>
          <th style="width:18%">전화번호</th>
          <th style="width:18%">소속</th>
          <th style="width:18%" class="center">참여시간</th>
          <th style="width:24%" class="center">전자서명</th>
        </tr></thead>
        <tbody>${partsHtml}</tbody>
      </table>

      <p class="footer">출력일시: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 산업안전보건법 TBM 실시 기록</p>
      <script>
        window.onload = function(){
          var imgs = document.images;
          var pending = imgs.length;
          if (!pending) { setTimeout(function(){ window.print(); }, 200); return; }
          for (var i=0;i<imgs.length;i++){
            if (imgs[i].complete) { if(--pending===0) setTimeout(function(){window.print();},200); }
            else { imgs[i].onload = imgs[i].onerror = function(){ if(--pending===0) setTimeout(function(){window.print();},200); }; }
          }
        };
      </script>
    </body></html>`);
    w.document.close(); w.focus();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold flex items-center gap-2"><QrCode className="h-4 w-4" /> TBM 세션 (QR 근로자 참여)</h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const today = new Date().toISOString().slice(0, 10);
              let q = supabase
                .from('work_permits' as any)
                .select('id, work_name, work_description, permit_date, location, tbm_session_id, status, contractor_company')
                .eq('project_id', projectId)
                .eq('is_deleted', false)
                .is('tbm_session_id', null)
                .gte('permit_date', today)
                .order('permit_date', { ascending: true })
                .limit(30);
              if (access?.applyCompanyFilter) q = access.applyCompanyFilter(q);
              const { data } = await q;
              setPermitCandidates((data as any[]) || []);
              setShowPermitPick(true);
            }}
          >
            <FileSignature className="h-4 w-4 mr-1" />허가서에서
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" />TBM 생성</Button>
        </div>
      </div>

      <Dialog open={showPermitPick} onOpenChange={setShowPermitPick}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> 허가서에서 당일 TBM 만들기
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            TBM이 아직 연결되지 않은 허가서입니다. 선택하면 작업내용·위험을 가져와 1:1 TBM을 만들고 AI 브리핑 초안을 채웁니다.
          </p>
          {permitCandidates.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              연결 가능한 허가서가 없습니다. (오늘 이후 · TBM 미연결)
            </div>
          ) : (
            <div className="space-y-2">
              {permitCandidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={permitPickBusy}
                  className="w-full text-left border rounded-md p-3 hover:bg-muted/50 disabled:opacity-50"
                  onClick={async () => {
                    setPermitPickBusy(true);
                    const res = await ensureTbmForPermit({
                      permitId: p.id,
                      projectId,
                      leaderName: profile?.display_name || leader || '',
                      companyId: companyId || access?.userCompanyId || null,
                      useAiDraft: true,
                    });
                    setPermitPickBusy(false);
                    if (!res.ok) {
                      toast({ title: '생성 실패', description: res.error, variant: 'destructive' });
                      return;
                    }
                    toast({
                      title: res.reused ? '기존 TBM 연결' : 'TBM 생성 완료',
                      description: 'AI 브리핑 초안이 있으면 반영되었습니다.',
                    });
                    setShowPermitPick(false);
                    load();
                  }}
                >
                  <div className="font-medium text-sm truncate">
                    {p.work_name || p.work_description || '작업허가서'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.permit_date} · {p.location || '-'} · {p.status}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* KPI summary */}
      {(() => {
        const today = todayKst();
        const totalParts = Object.values(participantCounts).reduce((a, b) => a + b, 0);
        const activeN = sessions.filter(s => s.is_active).length;
        const todayN = sessions.filter(s => s.tbm_date === today).length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card><CardContent className="p-3 flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /><div><p className="text-[10px] text-muted-foreground">전체 TBM</p><p className="text-lg font-bold">{sessions.length}</p></div></CardContent></Card>
            <Card><CardContent className="p-3 flex items-center gap-2"><Power className="h-4 w-4 text-emerald-600" /><div><p className="text-[10px] text-muted-foreground">진행중</p><p className="text-lg font-bold">{activeN}</p></div></CardContent></Card>
            <Card><CardContent className="p-3 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><div><p className="text-[10px] text-muted-foreground">오늘</p><p className="text-lg font-bold">{todayN}</p></div></CardContent></Card>
            <Card><CardContent className="p-3 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><div><p className="text-[10px] text-muted-foreground">총 참여자</p><p className="text-lg font-bold">{totalParts}</p></div></CardContent></Card>
          </div>
        );
      })()}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-9 text-xs pl-7" placeholder="제목·장소·주관자·공종 검색…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Input
          type="date"
          className="h-9 w-[140px] text-xs"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          title="일자 필터"
        />
        <Button
          type="button"
          size="sm"
          variant={dateFilter === todayKst() ? 'default' : 'outline'}
          className="h-9 text-xs"
          onClick={() => setDateFilter(todayKst())}
        >
          오늘
        </Button>
        <Button
          type="button"
          size="sm"
          variant={dateFilter === '' ? 'default' : 'outline'}
          className="h-9 text-xs"
          onClick={() => setDateFilter('')}
        >
          전체 일자
        </Button>
        <select className="h-9 rounded-md border bg-background px-2 text-xs" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="all">상태: 전체</option>
          <option value="active">진행중</option>
          <option value="closed">종료</option>
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-xs" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="all">회사: 전체</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-md border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-10 border rounded-md bg-muted/20 gap-3">
          <ClipboardList className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-semibold">등록된 TBM이 없습니다.</p>
            <p className="text-xs text-muted-foreground mt-1">
              QR 코드를 발행해 근로자가 참여 서명할 수 있는 첫 TBM을 만들어 보세요.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />첫 TBM 생성
          </Button>
        </div>
      ) : (() => {
        const filtered = sessions.filter(s => {
          if (dateFilter && s.tbm_date !== dateFilter) return false;
          if (statusFilter === 'active' && !s.is_active) return false;
          if (statusFilter === 'closed' && s.is_active) return false;
          if (companyFilter !== 'all' && s.company_id !== companyFilter) return false;
          if (search) {
            const q = search.toLowerCase();
            const hay = `${s.title||''} ${s.location||''} ${s.leader_name||''} ${s.process_category||''} ${s.company_name||''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
        if (filtered.length === 0) {
          return <div className="text-center py-8 text-sm text-muted-foreground border rounded-md bg-muted/10">검색 결과가 없습니다.</div>;
        }
        return (
        <div className="grid gap-2">
          {filtered.map(s => (
            <Card key={s.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{s.title}</p>
                    <Badge variant={s.is_active ? 'default' : 'secondary'}>{s.is_active ? '진행중' : '종료'}</Badge>
                    <Badge variant="outline" className="text-[10px]">
                      <Users className="h-3 w-3 mr-1" />참여 {participantCounts[s.id] || 0}명
                    </Badge>
                    {s.company_name && (
                      <Badge variant="outline" className="text-[10px]">{s.company_name}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{s.tbm_date} · {s.location} · {s.leader_name}</p>
                </div>
                <div className="flex gap-1 shrink-0 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openQr(s)} title="QR"><QrCode className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => openParts(s)} title="참여자"><Users className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => printTbmLog(s)} title="TBM 일지 인쇄/PDF"><FileText className="h-3 w-3 mr-1" />일지 인쇄</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(s)} title="활성/종료"><Power className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)} title="수정"><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => remove(s)} title="휴지통으로 이동"><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        );
      })()}


      <Dialog open={showCreate || !!editing} onOpenChange={(v) => { if (!v) { setShowCreate(false); setEditing(null); resetForm(); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>{editing ? 'TBM 수정' : 'TBM 생성'}</DialogTitle>
              <Button type="button" size="sm" variant="outline" onClick={openCopyDialog}>
                <Copy className="h-3 w-3 mr-1" />이전 TBM 불러오기
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            {/* 기본 정보 */}
            <section className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold text-muted-foreground">① 기본 정보</p>
              <div><Label>제목 *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026-05-06 오전 TBM" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>일자</Label><Input type="date" value={tbmDate} onChange={(e) => setTbmDate(e.target.value)} /></div>
                <div><Label>장소</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>주관자</Label><AssigneeSelect projectId={projectId} companyId={companyId || null} value={leader} onChange={({ name }) => setLeader(name)} /></div>
                <div><Label>공종</Label><Input value={processCategory} onChange={(e) => setProcessCategory(e.target.value)} placeholder="예: 철근콘크리트" /></div>
              </div>
              <div>
                <Label>회사 (시공사/협력사) *</Label>
                <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">선택</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                </select>
              </div>
            </section>

            {/* 작업내용 */}
            <section className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold text-muted-foreground">② 작업내용</p>
              <div><Label>오늘 작업 내용</Label><Textarea value={workContent} onChange={(e) => setWorkContent(e.target.value)} rows={3} placeholder="예: 3F 슬래브 철근 배근 및 점검" /></div>
              <div><Label>작업 순서</Label><Textarea value={workSteps} onChange={(e) => setWorkSteps(e.target.value)} rows={4} placeholder="1) 자재 반입&#10;2) 배근 위치 측량&#10;3) 철근 배근&#10;4) 결속 및 검측" /></div>
            </section>

            {/* 위험요인 / 안전대책 */}
            <section className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">③ 위험요인 및 안전대책 (위험성평가 자동 연동)</p>
                <Button type="button" size="sm" variant="ghost" onClick={addRisk}><Plus className="h-3 w-3 mr-1" />추가</Button>
              </div>
              {risksDraft.length === 0 ? (
                <p className="text-xs text-muted-foreground">자동 불러올 위험요인이 없습니다. "추가"로 직접 입력하세요.</p>
              ) : (
                <div className="space-y-2">
                  {risksDraft.map((r, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-start">
                      <div className="col-span-5"><Label className="text-[11px]">위험요인</Label><Textarea rows={2} value={r.hazard} onChange={(e) => updateRisk(i, 'hazard', e.target.value)} /></div>
                      <div className="col-span-2"><Label className="text-[11px]">등급</Label><Input value={r.grade} onChange={(e) => updateRisk(i, 'grade', e.target.value)} placeholder="상/중/하" /></div>
                      <div className="col-span-4"><Label className="text-[11px]">안전대책</Label><Textarea rows={2} value={r.measure} onChange={(e) => updateRisk(i, 'measure', e.target.value)} /></div>
                      <div className="col-span-1 flex items-end h-full">
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeRisk(i)} title="삭제"><Trash2 className="h-3 w-3 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 주의/금지 */}
            <section className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold text-muted-foreground">④ 특별 주의사항 / 작업 금지사항</p>
              <div><Label>특별 주의사항</Label><Textarea value={specialNotes} onChange={(e) => setSpecialNotes(e.target.value)} rows={3} placeholder="예: 강풍 시 고소작업 중지, 상하 동시작업 금지 등" /></div>
              <div><Label>작업 금지사항</Label><Textarea value={prohibitedActions} onChange={(e) => setProhibitedActions(e.target.value)} rows={3} placeholder="예: 안전대 미체결 작업 금지, 무자격자 장비 운전 금지" /></div>
            </section>

            {/* 브리핑 */}
            <section className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground">⑤ TBM 브리핑 내용</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSummary(BRIEFING_TEMPLATE)}>템플릿 불러오기</Button>
              </div>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={8} placeholder={BRIEFING_TEMPLATE} />
            </section>

            <p className="text-xs text-warning">⚠ 회사 선택 필수: QR 스캔 시 해당 회사의 위험성평가만 매칭됩니다.</p>
            <Button onClick={save} className="w-full">{editing ? '수정' : '생성'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 이전 TBM 불러오기 */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>이전 TBM 불러오기 {processCategory && `· ${processCategory}`}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">
            동일 공종의 최근 TBM이 우선 표시됩니다. 작업내용·위험요인·안전대책·브리핑만 복사되며, 근로자/서명/날짜는 복사되지 않습니다.
          </p>
          {copyCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">불러올 TBM이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {copyCandidates.map((c: any) => (
                <div key={c.id} className="flex items-start justify-between gap-2 border rounded-md p-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold truncate">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.tbm_date} · {c.process_category || '-'} · {c.company_name || '-'}
                    </p>
                    {c.work_content && <p className="text-xs mt-1 line-clamp-2">{c.work_content}</p>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => applyCopyFrom(c)}>불러오기</Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrSession} onOpenChange={(v) => { if (!v) { setQrSession(null); setQrDataUrl(''); setQrUrl(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{qrSession?.title} QR</DialogTitle></DialogHeader>
          <div className="text-center space-y-3">
            {qrGenerating ? (
              <div className="mx-auto w-72 h-72 rounded-md border bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
                QR 생성 중...
              </div>
            ) : qrDataUrl ? (
              <img src={qrDataUrl} alt="TBM 참여 QR 코드" className="mx-auto w-72 h-72 bg-white p-3 rounded-md border" />
            ) : (
              <div className="mx-auto w-72 h-72 rounded-md border bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">
                QR을 생성할 수 없습니다.
              </div>
            )}
            <p className="text-xs text-muted-foreground break-all">{qrUrl || (qrSession ? buildQrUrl(qrSession.qr_token) : '')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={regenerateQr} disabled={qrGenerating || !qrSession}>
                <RefreshCw className="h-4 w-4 mr-1" />QR 자동재생성
              </Button>
              <Button type="button" variant="outline" onClick={() => qrUrl && window.open(qrUrl, '_blank')} disabled={!qrUrl}>
                <ExternalLink className="h-4 w-4 mr-1" />링크 테스트
              </Button>
            </div>
            <div className="text-left space-y-1">
              <Label className="text-xs">QR 공개 베이스 URL (모바일에서 접속 가능한 도메인)</Label>
              <div className="flex gap-1">
                <Input
                  defaultValue={localStorage.getItem('tbm_public_base_url') || getPublicBase()}
                  placeholder="https://safenex.org"
                  className="h-8 text-xs"
                  onBlur={(e) => {
                    const v = normalizePublicBase(e.target.value);
                    e.target.value = v || PUBLIC_TBM_BASE_URL;
                    if (v) localStorage.setItem('tbm_public_base_url', v);
                    else localStorage.removeItem('tbm_public_base_url');
                    if (qrSession) renderQr(qrSession);
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
