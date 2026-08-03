import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { profileSchema } from '@/lib/inputValidation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Save, User, KeyRound, Building2, Shield } from 'lucide-react';

const statusLabel: Record<string, string> = {
  pending: '승인대기',
  active: '활성',
  inactive: '비활성',
};

const SettingsAccount = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, roles, refreshProfile, hasRole } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const backTo = location.pathname.startsWith('/app/worker')
    ? '/app/worker/more'
    : '/settings';

  const [form, setForm] = useState({
    display_name: '',
    company: '',
    phone: '',
    position: '',
  });
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  const [memberships, setMemberships] = useState<
    Array<{ project_name: string; role_new: string | null; position_new: string | null; company: string | null }>
  >([]);

  const accountStatus = (profile as any)?.account_status || 'active';
  const createdAt = (profile as any)?.created_at as string | undefined;

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name || '',
        company: profile.company || '',
        phone: profile.phone || '',
        position: profile.position || '',
      });
    }
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('project_members')
        .select('role_new, position_new, company, projects(name)')
        .eq('user_id', user.id);
      setMemberships(
        (data || []).map((m: any) => ({
          project_name: m.projects?.name || '프로젝트',
          role_new: m.role_new,
          position_new: m.position_new,
          company: m.company,
        })),
      );
    })();
  }, [user]);

  const roleBadges = useMemo(() => {
    const labels: string[] = [];
    if (hasRole('master')) labels.push('마스터');
    roles
      .filter((r) => r !== 'master')
      .forEach((r) => labels.push(r));
    return labels;
  }, [roles, hasRole]);

  const handleSave = async () => {
    if (!user) return;
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      toast({ title: parsed.error.errors[0]?.message || '입력값을 확인해주세요.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('profiles').update(parsed.data).eq('user_id', user.id);
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '계정 정보가 저장되었습니다.' });
      log('프로필수정', 'profile', user.id, undefined, { fields: Object.keys(form) });
      await refreshProfile();
    }
    setSaving(false);
  };

  const handlePasswordChange = async () => {
    if (!user?.email) return;
    if (newPassword.length < 8) {
      toast({ title: '새 비밀번호는 8자 이상이어야 합니다.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: '새 비밀번호 확인이 일치하지 않습니다.', variant: 'destructive' });
      return;
    }
    if (!currentPassword) {
      toast({ title: '현재 비밀번호를 입력해 주세요.', variant: 'destructive' });
      return;
    }
    if (currentPassword === newPassword) {
      toast({ title: '새 비밀번호는 현재 비밀번호와 달라야 합니다.', variant: 'destructive' });
      return;
    }

    setPwdSaving(true);
    try {
      // Re-auth with current password before updating
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (authErr) {
        throw new Error('현재 비밀번호가 올바르지 않습니다.');
      }

      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) throw updErr;

      toast({ title: '비밀번호가 변경되었습니다.' });
      log('비밀번호변경', 'auth_user', user.id);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      toast({
        title: '비밀번호 변경 실패',
        description: e?.message || '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-lg">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(backTo)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          {!location.pathname.startsWith('/app/worker') && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <span>설정</span><span>/</span><span>계정 정보</span>
            </div>
          )}
          <h1 className="text-xl font-bold flex items-center gap-2">
            <User className="h-5 w-5" /> 계정 정보
          </h1>
        </div>
      </div>

      {/* Account summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" /> 계정 요약
          </CardTitle>
          <CardDescription className="text-xs">로그인·권한·소속 현황</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">이메일</p>
              <p className="font-medium break-all">{user?.email || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">계정 상태</p>
              <Badge variant="outline" className="text-[10px] mt-0.5">
                {statusLabel[accountStatus] || accountStatus}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">가입일</p>
              <p className="font-medium">
                {createdAt ? new Date(createdAt).toLocaleDateString('ko-KR') : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">전역 권한</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {roleBadges.length === 0 ? (
                  <span className="text-muted-foreground">일반 사용자</span>
                ) : (
                  roleBadges.map((r) => (
                    <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                  ))
                )}
              </div>
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" /> 프로젝트 소속
            </p>
            {memberships.length === 0 ? (
              <p className="text-xs text-muted-foreground">등록된 프로젝트 소속이 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {memberships.map((m, i) => (
                  <li key={`${m.project_name}-${i}`} className="text-xs flex flex-wrap gap-1 items-center">
                    <Badge variant="outline" className="text-[10px]">{m.project_name}</Badge>
                    {m.role_new && <span className="text-muted-foreground">{m.role_new}</span>}
                    {m.company && <span className="text-muted-foreground">· {m.company}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">프로필 정보</CardTitle>
          <CardDescription className="text-xs">이름·연락처 등 기본 정보</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">이름</Label>
            <Input value={form.display_name} onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">이메일 (로그인 ID)</Label>
            <Input value={user?.email || ''} disabled className="bg-muted" />
            <p className="text-[10px] text-muted-foreground">
              이메일 변경이 필요하면 마스터 관리자에게 요청하세요.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">회사/소속</Label>
            <Input value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">직위</Label>
            <Input value={form.position} onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">연락처</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder="010-0000-0000"
            />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '프로필 저장'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> 비밀번호 변경
          </CardTitle>
          <CardDescription className="text-xs">
            현재 비밀번호 확인 후 새 비밀번호로 변경합니다. 분실 시{' '}
            <Link to="/forgot-password" className="underline text-foreground">
              비밀번호 찾기
            </Link>
            를 이용하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">현재 비밀번호</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">새 비밀번호</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              placeholder="8자 이상"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">새 비밀번호 확인</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button
            onClick={handlePasswordChange}
            disabled={pwdSaving || !currentPassword || !newPassword || !confirmPassword}
            className="w-full gap-1.5"
            variant="secondary"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {pwdSaving ? '변경 중...' : '비밀번호 변경'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsAccount;
