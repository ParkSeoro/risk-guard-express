/**
 * 설정 > AI — 생성은 OpenAI(gpt-4o-mini). NVIDIA 체인은 예비.
 * 키는 Supabase Edge Secrets(OPENAI_API_KEY / NVIDIA_API_KEY). DB에 키를 저장하지 않음.
 */
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Bot,
  Save,
  Loader2,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Timer,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_MODEL_CHAIN,
  NVIDIA_MODEL_CATALOG,
  catalogLabel,
  enabledModelIds,
  moveChainItem,
  normalizeModelChain,
  type AiModelChainItem,
} from '@/lib/aiNvidiaModels';

const SettingsAI = () => {
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const isMaster = hasRole('master');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [chain, setChain] = useState<AiModelChainItem[]>(DEFAULT_MODEL_CHAIN);
  const [keyStatus, setKeyStatus] = useState<'unknown' | 'ok' | 'missing' | 'error'>('unknown');
  const [keyMessage, setKeyMessage] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [stats, setStats] = useState({ total: 0, success: 0, failed: 0, avgLatency: 0, today: 0 });

  useEffect(() => {
    if (isMaster) loadAll();
    else setLoading(false);
  }, [isMaster]);

  const loadStats = async () => {
    const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [{ data: jobs }, { data: logs }] = await Promise.all([
      supabase.from('ai_generation_jobs').select('id,status,created_at').gte('created_at', since7d).limit(500),
      supabase.from('ai_generation_logs').select('latency_ms,error,created_at').gte('created_at', since7d).limit(1000),
    ]);
    const j = jobs || [];
    const l = logs || [];
    const lat = l.map((x) => x.latency_ms).filter((n): n is number => typeof n === 'number');
    setStats({
      total: j.length,
      success: j.filter((x) => x.status === 'completed').length,
      failed: j.filter((x) => x.status === 'failed').length,
      avgLatency: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
      today: j.filter((x) => new Date(x.created_at) >= todayStart).length,
    });
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('ai_runtime_settings')
        .select('is_enabled, failover_enabled, model_chain')
        .eq('id', 1)
        .maybeSingle();
      if (error) {
        console.warn('ai_runtime_settings load:', error.message);
        // Table may not be migrated yet — keep defaults
      } else if (data) {
        setIsEnabled(data.is_enabled !== false);
        setFailoverEnabled(data.failover_enabled !== false);
        setChain(normalizeModelChain(data.model_chain));
      }
      await loadStats();
      await runHealthCheck(false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const runHealthCheck = async (toastOnResult: boolean) => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-ai-credits');
      if (error) {
        setKeyStatus('error');
        setKeyMessage(error.message || '헬스체크 실패');
        if (toastOnResult) toast.error('AI 헬스체크 실패');
        return;
      }
      const status = (data as any)?.status;
      setActiveModel((data as any)?.model || enabledModelIds(chain)[0] || '');
      setKeyMessage((data as any)?.message || '');
      if (status === 'ok') {
        setKeyStatus('ok');
        if (toastOnResult) toast.success((data as any)?.provider === 'openai' ? 'OpenAI API 정상' : 'NVIDIA API 정상');
      } else if (/설정되지 않았|missing|INVALID_KEY/i.test(String((data as any)?.message || ''))) {
        setKeyStatus('missing');
        if (toastOnResult) toast.error('OPENAI_API_KEY가 Edge Secrets에 없습니다');
      } else {
        setKeyStatus('error');
        if (toastOnResult) toast.message((data as any)?.message || '응답 확인 필요');
      }
    } catch (e: any) {
      setKeyStatus('error');
      setKeyMessage(e?.message || '헬스체크 오류');
      if (toastOnResult) toast.error('헬스체크 오류');
    } finally {
      setChecking(false);
    }
  };

  const handleSave = async () => {
    const enabled = enabledModelIds(chain);
    if (enabled.length === 0) {
      toast.error('활성 모델을 1개 이상 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id: 1,
        is_enabled: isEnabled,
        failover_enabled: failoverEnabled,
        model_chain: chain,
        updated_by: user?.id ?? null,
      };
      const { error } = await (supabase as any)
        .from('ai_runtime_settings')
        .upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      toast.success('AI 설정이 저장되었습니다.');
    } catch (err: any) {
      toast.error(
        '저장 실패: ' +
          (err?.message || '알 수 없는 오류') +
          (String(err?.message || '').includes('ai_runtime_settings')
            ? ' — SQL 마이그레이션(ai_runtime_settings) 적용이 필요할 수 있습니다.'
            : ''),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = (id: string, on: boolean) => {
    setChain((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: on } : m)));
  };

  if (!isMaster) {
    return (
      <div className="space-y-4 animate-fade-in max-w-3xl">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5" /> AI 설정
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            마스터 권한이 필요합니다.
          </CardContent>
        </Card>
      </div>
    );
  }

  const primaryId = enabledModelIds(chain)[0];

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span>
            <span>/</span>
            <span>AI 설정</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5" /> AI 설정
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            생성은 OpenAI. 아래 NVIDIA 순위는 예비용입니다.
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" />7일 작업
                </div>
                <div className="text-xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-success" />성공
                </div>
                <div className="text-xl font-bold text-success">{stats.success}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-destructive" />실패
                </div>
                <div className="text-xl font-bold text-destructive">{stats.failed}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Timer className="h-3 w-3" />평균 응답
                </div>
                <div className="text-xl font-bold">{stats.avgLatency}ms</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] text-muted-foreground">오늘 작업</div>
                <div className="text-xl font-bold">{stats.today}</div>
              </CardContent>
            </Card>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            상세 로그는
            <Link to="/ai-logs" className="text-primary hover:underline">
              AI 로그 페이지
            </Link>
            에서 확인하세요.
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">OpenAI API 키</CardTitle>
              <CardDescription className="text-xs">
                키는 브라우저/DB에 저장하지 않습니다. 텍스트 생성은 Edge Secrets의{' '}
                <code className="text-[11px]">OPENAI_API_KEY</code>를 사용합니다. OCR은{' '}
                <code className="text-[11px]">GEMINI_API_KEY</code>, NVIDIA는 예비입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {keyStatus === 'ok' && <Badge className="bg-success/15 text-success border-success/30">등록·정상</Badge>}
                {keyStatus === 'missing' && <Badge variant="destructive">미등록</Badge>}
                {keyStatus === 'error' && <Badge variant="outline">확인 필요</Badge>}
                {keyStatus === 'unknown' && <Badge variant="outline">미확인</Badge>}
                {activeModel && (
                  <span className="text-xs text-muted-foreground truncate max-w-[280px]">
                    ping model: {activeModel}
                  </span>
                )}
              </div>
              {keyMessage && <p className="text-xs text-muted-foreground">{keyMessage}</p>}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={checking}
                  onClick={() => runHealthCheck(true)}
                >
                  {checking ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  )}
                  헬스체크
                </Button>
                <Button type="button" variant="ghost" size="sm" asChild>
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenAI 키 발급
                    <ExternalLink className="h-3.5 w-3.5 ml-1" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">AI 사용</CardTitle>
              <CardDescription className="text-xs">
                끄면 Edge AI 호출이 거부됩니다. 라이브러리 대체는 각 화면 정책에 따릅니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">AI 자동생성 활성화</p>
                  <p className="text-xs text-muted-foreground">전역 on/off</p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">모델 자동 폴백</p>
                  <p className="text-xs text-muted-foreground">
                    429·410(모델 종료)·할당량·모델 미존재 시 다음 순위로 전환. 평소는 1순위만 사용.
                  </p>
                </div>
                <Switch checked={failoverEnabled} onCheckedChange={setFailoverEnabled} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">예비 NVIDIA 모델 순위</CardTitle>
              <CardDescription className="text-xs">
                OpenAI가 실패할 때만 사용합니다. 위쪽이 우선. Nemotron Super 49B는 NIM 호스팅이 종료되어 꺼 두세요.
                {primaryId && (
                  <>
                    {' '}
                    현재 1순위: <strong>{catalogLabel(primaryId)}</strong>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {chain.map((item, index) => {
                const meta = NVIDIA_MODEL_CATALOG.find((c) => c.id === item.id);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2"
                  >
                    <Badge variant="outline" className="w-8 justify-center shrink-0">
                      {index + 1}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{meta?.label || item.id}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.id}</p>
                      {meta?.note && (
                        <p className="text-[10px] text-muted-foreground">{meta.note}</p>
                      )}
                    </div>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(on) => toggleEnabled(item.id, on)}
                    />
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === 0}
                        onClick={() => setChain((c) => moveChainItem(c, index, -1))}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={index === chain.length - 1}
                        onClick={() => setChain((c) => moveChainItem(c, index, 1))}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-muted/30">
            <CardContent className="py-4 text-xs text-muted-foreground space-y-1">
              <p>• 평소 호출은 1순위 모델만 사용합니다 (위험성평가 프롬프트·파싱 변경 없음).</p>
              <p>• 폴백은 한도/장애(429·503·할당량·모델 없음)일 때만 동작합니다.</p>
              <p>• API 키는 Edge Secrets에만 둡니다. 이 화면에 키를 붙여넣지 마세요.</p>
            </CardContent>
          </Card>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            저장
          </Button>
        </div>
      )}
    </div>
  );
};

export default SettingsAI;
