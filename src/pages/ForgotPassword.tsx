import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { HardHat, Mail } from 'lucide-react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) {
      toast({ title: '발송 실패', description: error.message, variant: 'destructive' });
    } else {
      setSent(true);
      toast({ title: '재설정 이메일을 발송했습니다.', description: '메일함(스팸함 포함)을 확인해주세요.' });
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
          <CardTitle className="text-xl">비밀번호 찾기</CardTitle>
          <CardDescription className="text-xs">
            가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{email}</span>
                으로 재설정 링크를 보냈습니다. 링크는 일정 시간 후 만료됩니다.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                다른 이메일로 다시 보내기
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">이메일</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@company.com"
                  required
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
                {loading ? '발송 중...' : '재설정 링크 발송'}
              </Button>
            </form>
          )}
          <div className="mt-4 text-center text-sm">
            <Link to="/auth" className="text-muted-foreground hover:underline">
              ← 로그인으로 돌아가기
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;
