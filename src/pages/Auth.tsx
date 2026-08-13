import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

import {
  positionsForCompanyType,
  positionLabel,
} from '@/lib/projectPositions';
import { normalizeCompanyType } from '@/lib/companyTypes';
import JobTypeSelect from '@/components/JobTypeSelect';
import { jobTypeSchema, type StandardJobType } from '@/lib/jobCategories';
import { koreanName, zodErrorMessage } from '@/lib/commonSchemas';
import {
  formatPhoneMask,
  phoneToWorkerEmail,
  signInWorkerWithPhone,
  workerPhoneSchema,
  workerPinSchema,
} from '@/lib/workerAuth';
import { writeLoginIntent } from '@/components/AuthGuard';
import { isNativeApp } from '@/lib/native/isNativeApp';
import { openPlayStore } from '@/lib/playStore';
import { isIosWebClient } from '@/lib/iosWebPath';
import { authBannedErrorMessage, signupIdentityErrorMessage } from '@/lib/accountStatus';

type Mode = 'login' | 'signup';
type Audience = 'worker' | 'manager';
type SignupMethod = 'directory' | 'invite';

interface InvitePreview {
  project_name: string;
  company_name: string;
  role: string;
  valid: boolean;
  error?: string;
}

interface DirectoryRow {
  project_id: string;
  project_name: string;
  company_id: string;
  company_name: string;
  company_type: string;
}

const roleLabels: Record<string, string> = {
  master: '마스터',
  project_admin: '프로젝트 관리자',
  safety_manager: '안전관리자',
  contractor: '협력사 담당자',
  viewer: '열람자',
};

function modeFromPath(pathname: string, invitePresent: boolean): Mode {
  if (pathname === '/register' || invitePresent) return 'signup';
  if (pathname === '/login') return 'login';
  return invitePresent ? 'signup' : 'login';
}

const Auth = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const inviteParam = searchParams.get('invite') || '';
  const qrProject = searchParams.get('project') || '';
  const qrCompany = searchParams.get('company') || '';
  const qrAudience = searchParams.get('audience') || '';
  /** 현장 등록 QR — 프로젝트·회사 고정 */
  const workerQrContext = !!(qrProject && qrCompany && (qrAudience === 'worker' || location.pathname === '/register'));

  const [mode, setMode] = useState<Mode>(() =>
    workerQrContext || modeFromPath(location.pathname, !!inviteParam) === 'signup'
      ? 'signup'
      : modeFromPath(location.pathname, !!inviteParam),
  );
  const [signupAudience, setSignupAudience] = useState<Audience>(() =>
    workerQrContext || isNativeApp() ? 'worker' : 'manager',
  );
  const [loginAudience, setLoginAudience] = useState<Audience>(() =>
    isNativeApp() || workerQrContext ? 'worker' : 'manager',
  );
  const [signupMethod, setSignupMethod] = useState<SignupMethod>('directory');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteParam);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [validatingCode, setValidatingCode] = useState(false);
  const [loading, setLoading] = useState(false);

  const [directory, setDirectory] = useState<DirectoryRow[]>([]);
  const [signupProjects, setSignupProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState(qrProject);
  const [selectedCompany, setSelectedCompany] = useState(qrCompany);
  const [selectedPosition, setSelectedPosition] = useState('');
  const [selectedJobType, setSelectedJobType] = useState<StandardJobType | ''>('');
  const [qrProjectName, setQrProjectName] = useState('');
  const [qrCompanyName, setQrCompanyName] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (workerQrContext) {
      setMode('signup');
      setSignupAudience('worker');
      setSignupMethod('directory');
      setSelectedProject(qrProject);
      setSelectedCompany(qrCompany);
      return;
    }
    setMode(modeFromPath(location.pathname, !!searchParams.get('invite')));
  }, [location.pathname, searchParams, workerQrContext, qrProject, qrCompany]);

  useEffect(() => {
    if (!workerQrContext) return;
    (async () => {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from('projects').select('name').eq('id', qrProject).maybeSingle(),
        supabase.from('companies').select('name').eq('id', qrCompany).maybeSingle(),
      ]);
      setQrProjectName((p as any)?.name || '');
      setQrCompanyName((c as any)?.name || '');
    })();
  }, [workerQrContext, qrProject, qrCompany]);

  useEffect(() => {
    if (searchParams.get('invite')) {
      setMode('signup');
      setSignupAudience('manager');
      setSignupMethod('invite');
    }
  }, [searchParams]);

  // Invite validation
  useEffect(() => {
    if (!inviteCode.trim() || mode !== 'signup' || signupAudience !== 'manager' || signupMethod !== 'invite') {
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
  }, [inviteCode, mode, signupAudience, signupMethod]);

  // Projects + company directory for signup (anon RPCs)
  useEffect(() => {
    if (mode !== 'signup') return;
    if (signupAudience === 'manager' && signupMethod === 'invite') return;
    (async () => {
      const [{ data: projects }, { data: dir }] = await Promise.all([
        (supabase as any).rpc('get_signup_projects'),
        (supabase as any).rpc('get_signup_company_directory'),
      ]);
      const fromRpc = ((projects as any[]) || [])
        .map((p) => ({ id: String(p.id), name: String(p.name || '') }))
        .filter((p) => p.id && p.name);
      // Fallback if RPC not deployed yet: derive from directory
      if (fromRpc.length === 0) {
        const map = new Map<string, string>();
        ((dir as DirectoryRow[]) || []).forEach((d) => {
          if (!map.has(d.project_id)) map.set(d.project_id, d.project_name);
        });
        setSignupProjects(Array.from(map, ([id, name]) => ({ id, name })));
      } else {
        setSignupProjects(fromRpc);
      }
      setDirectory((dir as DirectoryRow[]) || []);
    })();
  }, [mode, signupAudience, signupMethod]);

  const projectOptions = useMemo(() => {
    if (signupProjects.length > 0) return signupProjects;
    const map = new Map<string, string>();
    directory.forEach((d) => {
      if (!map.has(d.project_id)) map.set(d.project_id, d.project_name);
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [signupProjects, directory]);

  /** 근로자: 협력사/공급사 우선, 없으면 전체 */
  const companyOptions = useMemo(() => {
    const inProject = directory.filter((d) => d.project_id === selectedProject);
    if (signupAudience !== 'worker') return inProject;
    const contractors = inProject.filter((d) => {
      const t = normalizeCompanyType(d.company_type);
      return t === 'contractor' || t === 'vendor';
    });
    return contractors.length > 0 ? contractors : inProject;
  }, [directory, selectedProject, signupAudience]);

  const selectedCompanyRow = useMemo(
    () => directory.find((d) => d.company_id === selectedCompany) || null,
    [directory, selectedCompany],
  );
  const signupPositionOptions = useMemo(
    () => positionsForCompanyType(selectedCompanyRow?.company_type),
    [selectedCompanyRow?.company_type],
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 근로자: 전화번호 → 가상 이메일 랩핑 후 signIn
      if (loginAudience === 'worker') {
        writeLoginIntent('worker');
        const { error } = await signInWorkerWithPhone(phone, pin);
        if (error) {
          toast({
            title: '로그인 실패',
            description: authBannedErrorMessage(error.message) || error.message,
            variant: 'destructive',
          });
        }
        // AuthRoute waits for rolesReady then routes to /app/worker/*
        return;
      }

      // 관리자: 표준 이메일/비밀번호
      writeLoginIntent('admin');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({
          title: '로그인 실패',
          description: authBannedErrorMessage(error.message) || error.message,
          variant: 'destructive',
        });
      }
      // AuthRoute → postLoginPath → /consent 또는 모바일=/app/worker/menu · 데스크톱=/app/admin
    } finally {
      setLoading(false);
    }
  };

  const handleWorkerSignup = async () => {
    const nameParsed = koreanName.safeParse(displayName);
    const phoneParsed = workerPhoneSchema.safeParse(phone);
    const pinParsed = workerPinSchema.safeParse(pin);
    const jobParsed = jobTypeSchema.safeParse(selectedJobType);

    if (!nameParsed.success) {
      toast({ title: zodErrorMessage(nameParsed.error), variant: 'destructive' });
      return;
    }
    if (!phoneParsed.success) {
      toast({ title: zodErrorMessage(phoneParsed.error), variant: 'destructive' });
      return;
    }
    if (!pinParsed.success) {
      toast({ title: zodErrorMessage(pinParsed.error), variant: 'destructive' });
      return;
    }
    if (!selectedProject || !selectedCompany) {
      toast({
        title: workerQrContext
          ? '등록 QR의 프로젝트·소속사 정보가 없습니다. QR을 다시 스캔해 주세요.'
          : '참여 프로젝트와 소속(협력사)을 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }
    if (!workerQrContext) {
      toast({
        title: '현장 등록 QR 필요',
        description: '프로젝트·소속사는 관리자가 제공한 등록 QR로만 지정됩니다. QR을 스캔해 가입해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    if (!jobParsed.success) {
      toast({ title: zodErrorMessage(jobParsed.error), variant: 'destructive' });
      return;
    }

    const digits = phoneParsed.data;
    const dummyEmail = phoneToWorkerEmail(digits);
    const companyName = directory.find((d) => d.company_id === selectedCompany)?.company_name || '';

    setLoading(true);
    try {
      const { data: ident } = await (supabase as any).rpc('signup_identity_available', {
        _email: dummyEmail,
        _phone: digits,
      });
      const identErr = signupIdentityErrorMessage((ident as any)?.error);
      if (identErr) {
        toast({ title: '회원가입 불가', description: identErr, variant: 'destructive' });
        return;
      }
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: dummyEmail,
        password: pinParsed.data,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            display_name: nameParsed.data,
            phone: digits,
            company: companyName,
            account_kind: 'worker',
            signup_project_id: selectedProject,
            signup_company_id: selectedCompany,
            signup_position: 'WORKER',
            signup_job_type: jobParsed.data,
          },
        },
      });

      if (error) {
        toast({ title: '회원가입 실패', description: error.message, variant: 'destructive' });
        return;
      }

      if (signUpData.user) {
        if (!signUpData.session) {
          await signInWorkerWithPhone(digits, pinParsed.data);
        }
        const { data: rosterRes, error: rpcErr } = await (supabase as any).rpc(
          'complete_worker_roster_signup',
          {
            _user_id: signUpData.user.id,
            _project_id: selectedProject,
            _company_id: selectedCompany,
            _name: nameParsed.data,
            _phone: digits,
            _job_type: jobParsed.data,
          },
        );
        if (rpcErr || rosterRes?.error) {
          toast({
            title: '명부 등록 실패',
            description: rpcErr?.message || rosterRes?.error || '다시 시도해 주세요',
            variant: 'destructive',
          });
        }
      }

      toast({
        title: '근로자 가입 완료',
        description: '등록대기 상태입니다. 관리자 승인 후 전화번호·PIN으로 로그인하세요.',
      });
      setMode('login');
      setLoginAudience('worker');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleManagerSignup = async () => {
    if (password.length < 8) {
      toast({ title: '비밀번호는 8자 이상이어야 합니다.', variant: 'destructive' });
      return;
    }
    if (signupMethod === 'directory' && (!selectedProject || !selectedCompany || !selectedPosition)) {
      toast({ title: '참여할 프로젝트·소속 업체·직책을 선택해주세요.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data: ident } = await (supabase as any).rpc('signup_identity_available', {
        _email: email,
        _phone: phone || null,
      });
      const identErr = signupIdentityErrorMessage((ident as any)?.error);
      if (identErr) {
        toast({ title: '회원가입 불가', description: identErr, variant: 'destructive' });
        return;
      }
      const selectedCompanyName =
        directory.find((d) => d.company_id === selectedCompany)?.company_name || '';
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            display_name: displayName,
            company: selectedCompanyName,
            account_kind: 'manager',
            invite_code: signupMethod === 'invite' ? inviteCode.trim() || undefined : undefined,
            signup_project_id: signupMethod === 'directory' ? selectedProject : undefined,
            signup_company_id: signupMethod === 'directory' ? selectedCompany : undefined,
            signup_position: signupMethod === 'directory' ? selectedPosition : undefined,
          },
        },
      });

      if (error) {
        toast({ title: '회원가입 실패', description: error.message, variant: 'destructive' });
        return;
      }

      if (signUpData.user) {
        if (signupMethod === 'invite' && inviteCode.trim()) {
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
        } else if (signupMethod === 'directory') {
          const { error: rpcErr } = await (supabase as any).rpc('process_signup_company_selection', {
            _user_id: signUpData.user.id,
            _project_id: selectedProject,
            _company_id: selectedCompany,
            _position: selectedPosition,
          });
          if (rpcErr) {
            toast({ title: '업체 연결 실패', description: rpcErr.message, variant: 'destructive' });
          }
        }
      }

      toast({ title: '회원가입 완료', description: '이메일을 확인해주세요. 관리자 승인 후 이용 가능합니다.' });
      setMode('login');
      setLoginAudience('manager');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupAudience === 'worker') {
      await handleWorkerSignup();
    } else {
      await handleManagerSignup();
    }
  };

  const resetCompanySelection = () => {
    setSelectedCompany('');
    setSelectedPosition('');
    setSelectedJobType('');
  };

  return (
    <div className="min-h-dvh bg-background flex flex-col items-center justify-center p-4 native-safe-pad">
      <Card className="w-full max-w-md border-border/80 shadow-sm">
        <CardHeader className="text-center space-y-1.5 pb-4">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
            Safenex
          </p>
          <CardTitle className="text-xl font-semibold tracking-tight">
            {mode === 'login' ? '로그인' : '회원가입'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">안전관리시스템</p>
        </CardHeader>
        <CardContent>
          {mode === 'signup' && (
            <div
              role="tablist"
              aria-label="가입 유형"
              className="mb-5 grid grid-cols-2 rounded-md border border-border bg-muted/40 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={signupAudience === 'manager'}
                onClick={() => {
                  setSignupAudience('manager');
                  resetCompanySelection();
                }}
                className={`rounded-[5px] px-3 py-2.5 text-sm transition ${
                  signupAudience === 'manager'
                    ? 'bg-background text-foreground font-semibold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                관리자
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={signupAudience === 'worker'}
                onClick={() => {
                  setSignupAudience('worker');
                  resetCompanySelection();
                }}
                className={`rounded-[5px] px-3 py-2.5 text-sm transition ${
                  signupAudience === 'worker'
                    ? 'bg-background text-foreground font-semibold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                근로자
              </button>
            </div>
          )}

          {mode === 'login' && (
            <div
              role="tablist"
              aria-label="로그인 유형"
              className="mb-5 grid grid-cols-2 rounded-md border border-border bg-muted/40 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={loginAudience === 'manager'}
                onClick={() => setLoginAudience('manager')}
                className={`rounded-[5px] px-3 py-2.5 text-sm transition ${
                  loginAudience === 'manager'
                    ? 'bg-background text-foreground font-semibold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                관리자
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={loginAudience === 'worker'}
                onClick={() => setLoginAudience('worker')}
                className={`rounded-[5px] px-3 py-2.5 text-sm transition ${
                  loginAudience === 'worker'
                    ? 'bg-background text-foreground font-semibold shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                근로자
              </button>
            </div>
          )}

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
            {/* ── 근로자 가입 ── */}
            {mode === 'signup' && signupAudience === 'worker' && (
              <>
                {workerQrContext ? (
                  <div className="rounded-lg border bg-muted/40 p-3 space-y-1 text-sm">
                    <p className="font-medium text-foreground">현장 등록 QR</p>
                    <p className="text-muted-foreground">
                      프로젝트: <span className="text-foreground font-medium">{qrProjectName || '…'}</span>
                    </p>
                    <p className="text-muted-foreground">
                      소속사: <span className="text-foreground font-medium">{qrCompanyName || '…'}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground pt-1">
                      프로젝트·소속사는 QR로 고정됩니다. 잘못됐으면 관리자에게 새 QR을 요청하세요.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
                    <p className="font-medium">현장 등록 QR이 필요합니다</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      프로젝트와 소속사는 관리자가 만든 등록 QR로만 지정됩니다. QR을 스캔한 뒤 가입해 주세요.
                    </p>
                  </div>
                )}
                {!isNativeApp() && isIosWebClient() && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed space-y-1">
                    <p className="font-medium text-foreground">iPhone · Safari 웹 이용</p>
                    <p>
                      App Store 앱이 없습니다. 이 화면에서 가입하면 Android 앱과 같은 메뉴를
                      씁니다. 가입 후 Safari 공유 → 「홈 화면에 추가」를 권장합니다.
                    </p>
                    <p className="text-[11px]">
                      참고: 백그라운드 GPS·무음 강제 사이렌은 Android 앱 전용입니다.
                    </p>
                  </div>
                )}
                {!isNativeApp() && !isIosWebClient() && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-11"
                    onClick={() => openPlayStore()}
                  >
                    SafeNex 앱 다운로드 (Play 스토어)
                  </Button>
                )}
                <div className="space-y-1.5">
                  <Label>이름 *</Label>
                  <Input
                    className="h-12 text-base"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="홍길동"
                    autoComplete="name"
                    required
                    disabled={!workerQrContext}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>전화번호 *</Label>
                  <Input
                    className="h-12 text-lg tracking-wide"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                    placeholder="010-1234-5678"
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                    disabled={!workerQrContext}
                  />
                  <p className="text-[10px] text-muted-foreground">숫자만 입력하면 자동으로 하이픈이 붙습니다.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>직종 *</Label>
                  <JobTypeSelect
                    value={selectedJobType}
                    onValueChange={setSelectedJobType}
                    placeholder="표준 직종 선택"
                    disabled={!workerQrContext}
                    triggerClassName="h-12 text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>PIN 비밀번호 (숫자 4~6자리) *</Label>
                  <Input
                    className="h-12 text-lg tracking-[0.3em]"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••"
                    autoComplete="new-password"
                    required
                    disabled={!workerQrContext}
                  />
                </div>
              </>
            )}

            {/* ── 관리자 가입 ── */}
            {mode === 'signup' && signupAudience === 'manager' && (
              <>
                <div className="space-y-1.5">
                  <Label>이름 *</Label>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="홍길동" required />
                </div>

                <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
                  <button
                    type="button"
                    onClick={() => setSignupMethod('directory')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition ${
                      signupMethod === 'directory' ? 'bg-background shadow font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    업체 조회로 가입
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignupMethod('invite')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition ${
                      signupMethod === 'invite' ? 'bg-background shadow font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    초대코드로 가입
                  </button>
                </div>

                {signupMethod === 'directory' && (
                  <>
                    <div className="space-y-1.5">
                      <Label>참여 프로젝트 *</Label>
                      <Select
                        value={selectedProject}
                        onValueChange={(v) => {
                          setSelectedProject(v);
                          resetCompanySelection();
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
                        <SelectContent>
                          {projectOptions.length === 0 && (
                            <div className="p-2 text-xs text-muted-foreground">등록된 활성 프로젝트가 없습니다.</div>
                          )}
                          {projectOptions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>소속 업체 *</Label>
                      <Select
                        value={selectedCompany}
                        onValueChange={(v) => {
                          setSelectedCompany(v);
                          setSelectedPosition('');
                        }}
                        disabled={!selectedProject}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={selectedProject ? '업체 선택' : '프로젝트를 먼저 선택'} />
                        </SelectTrigger>
                        <SelectContent>
                          {companyOptions.length === 0 && selectedProject && (
                            <div className="p-2 text-xs text-muted-foreground">이 프로젝트에 등록된 업체가 없습니다.</div>
                          )}
                          {companyOptions.map((c) => (
                            <SelectItem key={c.company_id} value={c.company_id}>{c.company_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>직책 *</Label>
                      <Select
                        value={selectedPosition}
                        onValueChange={setSelectedPosition}
                        disabled={!selectedCompany}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={selectedCompany ? '직책 선택' : '업체를 먼저 선택'} />
                        </SelectTrigger>
                        <SelectContent>
                          {signupPositionOptions.map((p) => (
                            <SelectItem key={p} value={p}>{positionLabel(p)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedCompanyRow?.company_type && (() => {
                        const t = normalizeCompanyType(selectedCompanyRow.company_type);
                        if (t === 'client') return <p className="text-[10px] text-muted-foreground">발주처: PM / CM / SM</p>;
                        if (t === 'gc') return <p className="text-[10px] text-muted-foreground">시공사: 감리 · 관리감독자 분리</p>;
                        if (t === 'contractor' || t === 'vendor') {
                          return <p className="text-[10px] text-muted-foreground">협력사/공급사: 관리감독자 · 현장소장 등</p>;
                        }
                        return null;
                      })()}
                      <p className="text-[10px] text-muted-foreground">관리자 승인 후 이용 가능합니다.</p>
                    </div>
                  </>
                )}

                {signupMethod === 'invite' && (
                  <div className="space-y-1.5">
                    <Label>초대코드</Label>
                    <div className="relative">
                      <Input
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="초대코드 입력"
                        className="pr-8"
                      />
                      {validatingCode && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                      {!validatingCode && invitePreview?.valid && <CheckCircle2 className="absolute right-2.5 top-2.5 h-4 w-4 text-emerald-500" />}
                      {!validatingCode && invitePreview && !invitePreview.valid && (
                        <AlertCircle className="absolute right-2.5 top-2.5 h-4 w-4 text-destructive" />
                      )}
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
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>이메일 *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@company.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>비밀번호 (8자 이상) *</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                </div>
              </>
            )}

            {/* ── 근로자 로그인 (전화 → 가상 이메일) ── */}
            {mode === 'login' && loginAudience === 'worker' && (
              <>
                <div className="space-y-1.5">
                  <Label>전화번호</Label>
                  <Input
                    className="h-12 text-lg tracking-wide"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                    placeholder="전화번호 (예: 01012345678)"
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground">숫자만 입력됩니다. 로그인 시 자동으로 계정에 연결됩니다.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>PIN 비밀번호 (숫자 4~6자리)</Label>
                  <Input
                    className="h-12 text-lg tracking-[0.3em]"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="숫자 PIN"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </>
            )}

            {/* ── 관리자 로그인 (이메일/비밀번호) ── */}
            {mode === 'login' && loginAudience === 'manager' && (
              <>
                <div className="space-y-1.5">
                  <Label>이메일</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@company.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>비밀번호</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                </div>
              </>
            )}

            <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
              {loading
                ? '처리 중...'
                : mode === 'login'
                  ? (loginAudience === 'worker' ? '근로자 로그인' : '관리자 로그인')
                  : (signupAudience === 'worker' ? '근로자 가입' : '관리자 가입')}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm space-y-1">
            {mode === 'login' && (
              <>
                {loginAudience === 'manager' && (
                  <Link to="/forgot-password" className="text-accent hover:underline block w-full">
                    비밀번호를 잊으셨나요?
                  </Link>
                )}
                <Link to="/register" className="text-muted-foreground hover:underline block w-full" onClick={() => setMode('signup')}>
                  계정이 없으신가요? 회원가입
                </Link>
              </>
            )}
            {mode !== 'login' && (
              <Link to="/login" className="text-muted-foreground hover:underline" onClick={() => setMode('login')}>
                ← 로그인으로 돌아가기
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
      {!isNativeApp() && (
        <a href="/manual" className="mt-4 text-xs text-muted-foreground hover:text-foreground hover:underline">
          사용 설명서 보기 (관리자 & 근로자용)
        </a>
      )}
    </div>
  );
};

export default Auth;
