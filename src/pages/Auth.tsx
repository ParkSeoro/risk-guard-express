import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { HardHat, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

type Mode = 'login' | 'signup' | 'forgot';

interface InvitePreview {
  project_name: string;
  company_name: string;
  role: string;
  valid: boolean;
  error?: string;
}

const roleLabels: Record<string, string> = {
  master: '마스터',
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  contractor: '협력사 담당자',
  viewer: '열람자',
};

const Auth = () => {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [company, setCompany] = useState('');
  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') || '');
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [validatingCode, setValidatingCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Auto-switch to signup if invite param present
  useEffect(() => {
    if (searchParams.get('invite')) {
      setMode('signup');
    }
  }, [searchParams]);

  // Validate invite code with debounce
  useEffect(() => {
    if (!inviteCode.trim() || mode !== 'signup') {
      setInvitePreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      setValidatingCode(true);
      try {
        const { data: invite } = await supabase
          .from('project_invites')
          .select('*, projects(name)')
          .eq('code', inviteCode.trim())
          .maybeSingle();

        if (!invite) {
          setInvitePreview({ project_name: '', company_name: '', role: '', valid: false, error: '유효하지 않은 초대코드입니다.' });
          return;
        }
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
          setInvitePreview({ project_name: '', company_name: '', role: '', valid: false, error: '만료된 초대코드입니다.' });
          return;
        }
        if (invite.max_uses && invite.max_uses > 0 && (invite.use_count || 0) >= invite.max_uses) {
          setInvitePreview({ project_name: '', company_name: '', role: '', valid: false, error: '사용 횟수가 초과된 초대코드입니다.' });
          return;
        }

        // Get company name if company_id exists
        let companyName = '';
        if ((invite as any).company_id) {
          const { data: comp } = await supabase
            .from('companies')
            .select('name')
            .eq('id', (invite as any).company_id)
            .single();
          companyName = comp?.name || '';
        }

        setInvitePreview({
          project_name: (invite as any).projects?.name || '',
          company_name: companyName,
          role: invite.default_role,
          valid: true,
        });
      } catch {
        setInvitePreview({ project_name: '', company_name: '', role: '', valid: false, error: '코드 확인 중 오류가 발생했습니다.' });
      } finally {
        setValidatingCode(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [inviteCode, mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast({ title: '로그인 실패', description: error.message, variant: 'destructive' });
    setLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: '비밀번호는 8자 이상이어야 합니다.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            display_name: displayName,
            company,
            invite_code: inviteCode.trim() || undefined,
          },
        },
      });

      if (error) {
        toast({ title: '회원가입 실패', description: error.message, variant: 'destructive' });
        return;
      }

      // If invite code provided AND user was auto-confirmed (session exists), process it immediately
      if (inviteCode.trim() && signUpData.user) {
        const { data: result } = await supabase.rpc('process_invite_code', {
          _user_id: signUpData.user.id,
          _invite_code: inviteCode.trim(),
        });
        if (result && (result as any).error) {
          const errMap: Record<string, string> = {
            INVALID_CODE: '유효하지 않은 초대코드입니다.',
            EXPIRED: '만료된 초대코드입니다.',
            MAX_USES_EXCEEDED: '사용 횟수가 초과되었습니다.',
          };
          toast({ title: errMap[(result as any).error] || '초대코드 처리 실패', variant: 'destructive' });
        }
      }

      toast({ title: '회원가입 완료', description: '이메일을 확인하여 인증을 완료해주세요.' });
      setMode('login');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast({ title: '오류', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '비밀번호 재설정 이메일이 발송되었습니다.' });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <HardHat className="h-7 w-7 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">
            {mode === 'login' ? '로그인' : mode === 'signup' ? '회원가입' : '비밀번호 재설정'}
          </CardTitle>
          <p className="text-sm font-semibold text-foreground">안전관리시스템</p>
          <p className="text-xs text-muted-foreground">Safety Management System</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleForgot} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div className="space-y-1.5">
                  <Label>이름</Label>
                  <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="홍길동" required />
                </div>
                <div className="space-y-1.5">
                  <Label>소속 회사</Label>
                  <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="(주)한국건설" />
                </div>
                <div className="space-y-1.5">
                  <Label>초대코드 <span className="text-muted-foreground font-normal">(선택)</span></Label>
                  <div className="relative">
                    <Input
                      value={inviteCode}
                      onChange={e => setInviteCode(e.target.value)}
                      placeholder="초대코드 입력"
                      className="pr-8"
                    />
                    {validatingCode && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    {!validatingCode && invitePreview?.valid && <CheckCircle2 className="absolute right-2.5 top-2.5 h-4 w-4 text-emerald-500" />}
                    {!validatingCode && invitePreview && !invitePreview.valid && <AlertCircle className="absolute right-2.5 top-2.5 h-4 w-4 text-destructive" />}
                  </div>
                  {invitePreview && !invitePreview.valid && (
                    <p className="text-xs text-destructive">{invitePreview.error}</p>
                  )}
                  {invitePreview?.valid && (
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 mt-1">
                      <p className="text-xs font-medium text-foreground">초대 정보 미리보기</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[11px]">프로젝트: {invitePreview.project_name}</Badge>
                        {invitePreview.company_name && (
                          <Badge variant="secondary" className="text-[11px]">업체: {invitePreview.company_name}</Badge>
                        )}
                        <Badge className="text-[11px]">{roleLabels[invitePreview.role] || invitePreview.role}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">가입 완료 시 자동으로 연결됩니다.</p>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>이메일</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" required />
            </div>
            {mode !== 'forgot' && (
              <div className="space-y-1.5">
                <Label>비밀번호</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={8} />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '처리 중...' : mode === 'login' ? '로그인' : mode === 'signup' ? '회원가입' : '재설정 링크 발송'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm space-y-1">
            {mode === 'login' && (
              <>
                <button onClick={() => setMode('forgot')} className="text-accent hover:underline block w-full">비밀번호를 잊으셨나요?</button>
                <button onClick={() => setMode('signup')} className="text-muted-foreground hover:underline block w-full">계정이 없으신가요? 회원가입</button>
              </>
            )}
            {mode !== 'login' && (
              <button onClick={() => setMode('login')} className="text-muted-foreground hover:underline">← 로그인으로 돌아가기</button>
            )}
          </div>
         </CardContent>
      </Card>
      <a href="/manual" className="mt-4 text-xs text-muted-foreground hover:text-foreground hover:underline">
        📖 사용 설명서 보기 (관리자 & 근로자용)
      </a>
    </div>
  );
};

export default Auth;
