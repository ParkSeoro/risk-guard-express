import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { HardHat } from 'lucide-react';

type Mode = 'login' | 'signup' | 'forgot';

const Auth = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName, company },
      },
    });
    if (error) {
      toast({ title: '회원가입 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '회원가입 완료', description: '이메일을 확인하여 인증을 완료해주세요.' });
      setMode('login');
    }
    setLoading(false);
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
          <p className="text-sm text-muted-foreground">위험성평가 관리 시스템</p>
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
    </div>
  );
};

export default Auth;
