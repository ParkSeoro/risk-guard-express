import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertTriangle, HardHat, Loader2 } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

type Briefing = {
  id: string;
  title: string;
  briefing_summary: string;
  briefing_risks: any[];
  tbm_date: string;
  location: string;
  leader_name: string;
};

export default function TbmParticipate() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string>('');
  const [done, setDone] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const sigRef = useRef<SignatureCanvas | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) return;
      const { data, error } = await supabase.rpc('get_tbm_by_token' as any, { _token: token });
      if (error || !data || (data as any).error) {
        setError((data as any)?.error === 'NOT_FOUND' ? '유효하지 않거나 종료된 TBM입니다.' : '브리핑을 불러올 수 없습니다.');
      } else {
        setBriefing(data as any);
      }
      setLoading(false);
    })();
  }, [token]);

  const clearSig = () => sigRef.current?.clear();

  const handleSubmit = async () => {
    if (!name.trim()) return toast({ title: '이름을 입력하세요.', variant: 'destructive' });
    if (!phone.trim() || phone.replace(/\D/g, '').length < 8) return toast({ title: '전화번호를 정확히 입력하세요.', variant: 'destructive' });
    if (!confirmed) return toast({ title: '브리핑 확인 체크가 필요합니다.', variant: 'destructive' });
    if (!sigRef.current || sigRef.current.isEmpty()) return toast({ title: '전자서명이 필요합니다.', variant: 'destructive' });

    setSubmitting(true);
    const signature = sigRef.current.getCanvas().toDataURL('image/png');
    const { data, error } = await supabase.rpc('submit_tbm_participation' as any, {
      _token: token,
      _worker_name: name,
      _worker_phone: phone,
      _company_name: company,
      _briefing_confirmed: true,
      _signature_data: signature,
      _ip_hash: '',
      _user_agent: navigator.userAgent.slice(0, 200),
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      const code = (data as any)?.error;
      const msg = code === 'ALREADY_PARTICIPATED' ? '이미 참여하신 TBM입니다.' :
        code === 'BRIEFING_NOT_CONFIRMED' ? '브리핑 확인이 필요합니다.' :
        code === 'SIGNATURE_REQUIRED' ? '서명이 필요합니다.' :
        code === 'INVALID_PHONE' ? '전화번호가 올바르지 않습니다.' :
        '제출에 실패했습니다.';
      toast({ title: msg, variant: 'destructive' });
      return;
    }
    setDone(true);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (error || !briefing) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <p className="font-semibold">{error || '오류'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-3">
            <CheckCircle2 className="h-16 w-16 text-success mx-auto" />
            <h2 className="text-xl font-bold">참여가 완료되었습니다</h2>
            <p className="text-sm text-muted-foreground">{name}님, TBM 참여 및 전자서명이 정상 등록되었습니다.</p>
            <p className="text-xs text-muted-foreground">안전한 작업 되십시오.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const risks = Array.isArray(briefing.briefing_risks) ? briefing.briefing_risks : [];

  return (
    <div className="min-h-screen bg-muted/30 p-4 pb-12">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2 pt-4">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <HardHat className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">TBM 근로자 참여</p>
            <p className="font-bold">안전관리시스템</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{briefing.title || '오늘의 TBM'}</CardTitle>
            <div className="text-xs text-muted-foreground space-x-2">
              <span>📅 {briefing.tbm_date}</span>
              {briefing.location && <span>📍 {briefing.location}</span>}
              {briefing.leader_name && <span>👤 {briefing.leader_name}</span>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {briefing.briefing_summary && (
              <div>
                <Label className="text-xs">브리핑 요약</Label>
                <div className="mt-1 p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap">{briefing.briefing_summary}</div>
              </div>
            )}
            {risks.length > 0 && (
              <div>
                <Label className="text-xs">주요 위험요인 및 대책</Label>
                <div className="mt-1 space-y-2">
                  {risks.map((r: any, i: number) => (
                    <div key={i} className="p-3 rounded-md border bg-card">
                      <div className="flex items-start gap-2">
                        <Badge variant={r.grade === '상' ? 'destructive' : r.grade === '중' ? 'default' : 'secondary'}>
                          {r.grade || '중'}
                        </Badge>
                        <div className="flex-1 text-sm">
                          <p className="font-semibold">{r.hazard || r.title}</p>
                          {r.measure && <p className="text-xs text-muted-foreground mt-1">대책: {r.measure}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">근로자 정보</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>이름 *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
            </div>
            <div>
              <Label>전화번호 *</Label>
              <Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
            </div>
            <div>
              <Label>소속</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="○○건설" />
            </div>
          </CardContent>
        </Card>

        <Card className={confirmed ? 'border-success' : ''}>
          <CardContent className="p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(!!v)} />
              <span className="text-sm">
                위 브리핑 내용과 위험요인·안전대책을 확인하였으며, 안전수칙을 준수하여 작업하겠습니다. *
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">전자서명 *</CardTitle>
            <Button variant="ghost" size="sm" onClick={clearSig}>지우기</Button>
          </CardHeader>
          <CardContent>
            <div className="border-2 rounded-md bg-background touch-none">
              <SignatureCanvas
                ref={(r) => { sigRef.current = r; }}
                penColor="#0a1f44"
                canvasProps={{ className: 'w-full h-40 rounded-md', width: 600, height: 160 }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">손가락 또는 펜으로 위 영역에 서명해 주세요.</p>
          </CardContent>
        </Card>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full h-12 text-base" size="lg">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          참여 제출
        </Button>
      </div>
    </div>
  );
}
