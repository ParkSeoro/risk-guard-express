import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { HardHat } from 'lucide-react';

/**
 * Email recovery landing page.
 * Supabase redirects here with `#access_token=...&type=recovery` (or PKCE session).
 */
const UpdatePassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const markReady = () => {
      if (!cancelled) {
        setReady(true);
        setChecking(false);
      }
    };

    const hash = window.location.hash || '';
    if (hash.includes('type=recovery') || hash.includes('access_token=')) {
      markReady();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        markReady();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        markReady();
      } else if (!hash.includes('type=recovery') && !hash.includes('access_token=')) {
        setChecking(false);
      }
    });

    // Give hash/session a moment to settle after redirect
    const t = window.setTimeout(() => {
      if (!cancelled) setChecking(false);
    }, 2500);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.clearTimeout(t);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: '비밀번호는 8자 이상이어야 합니다.', variant: 'destructive' });
      return;
    }
    if (password !== confirm) {
      toast({ title: '비밀번호 확인이 일치하지 않습니다.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: '변경 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '비밀번호가 변경되었습니다.', description: '새 비밀번호로 로그인해 주세요.' });
      await supabase.auth.signOut();
      navigate('/auth', { replace: true });
    }
    setLoading(false);
  };

  if (checking && !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground text-sm">비밀번호 재설정 링크를 확인하는 중...</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-lg">유효하지 않은 링크</CardTitle>
            <CardDescription>
              재설정 링크가 만료되었거나 잘못되었습니다. 비밀번호 찾기를 다시 요청해 주세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/forgot-password">비밀번호 다시 찾기</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <HardHat className="h-7 w-7 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">새 비밀번호 설정</CardTitle>
          <CardDescription className="text-xs">이메일 링크로 인증되었습니다. 새 비밀번호를 입력하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">새 비밀번호</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="8자 이상"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '처리 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default UpdatePassword;
