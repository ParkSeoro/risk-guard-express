import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Bot, Eye, EyeOff, Save, Loader2, Activity, CheckCircle2, AlertTriangle, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';

const MODELS = [
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (추천 · 기본)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (저렴)' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (고품질)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'openai/gpt-5', label: 'GPT-5' },
];


const SettingsAI = () => {
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const isMaster = hasRole('master');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyHint, setApiKeyHint] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [isEnabled, setIsEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // Get first project membership
      const { data: membership } = await supabase
        .from('project_members')
        .select('project_id')
        .limit(1)
        .maybeSingle();

      if (!membership) {
        // Try to get any project for master
        const { data: project } = await supabase
          .from('projects')
          .select('id')
          .limit(1)
          .maybeSingle();
        if (project) setProjectId(project.id);
      } else {
        setProjectId(membership.project_id);
      }

      const pid = membership?.project_id;
      if (!pid) { setLoading(false); return; }

      const { data } = await supabase
        .from('ai_settings')
        .select('*')
        .eq('project_id', pid)
        .maybeSingle();

      if (data) {
        setApiKeyHint((data as any).api_key_hint || '');
        setModel((data as any).model || 'gpt-4o');
        setIsEnabled((data as any).is_enabled ?? false);
        setHasExistingKey(!!((data as any).api_key_hint));
      }
    } catch (err) {
      console.error('Failed to load AI settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!projectId) {
      toast.error('프로젝트를 찾을 수 없습니다.');
      return;
    }

    setSaving(true);
    try {
      const hint = apiKey
        ? `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`
        : apiKeyHint;

      const payload: any = {
        project_id: projectId,
        model,
        is_enabled: isEnabled,
        api_key_hint: hint,
        updated_by: user?.id,
      };

      if (apiKey) {
        payload.api_key_encrypted = apiKey;
      }

      const { data: existing } = await supabase
        .from('ai_settings')
        .select('id')
        .eq('project_id', projectId)
        .maybeSingle();

      if (existing) {
        const updatePayload = { ...payload };
        delete updatePayload.project_id;
        if (!apiKey) delete updatePayload.api_key_encrypted;
        
        const { error } = await supabase
          .from('ai_settings')
          .update(updatePayload)
          .eq('project_id', projectId);
        if (error) throw error;
      } else {
        if (!apiKey && isEnabled) {
          toast.error('AI를 활성화하려면 API Key를 입력해야 합니다.');
          setSaving(false);
          return;
        }
        const { error } = await supabase
          .from('ai_settings')
          .insert(payload);
        if (error) throw error;
      }

      setApiKey('');
      setApiKeyHint(hint);
      setHasExistingKey(!!hint);
      toast.success('AI 설정이 저장되었습니다.');
    } catch (err: any) {
      toast.error('저장 실패: ' + (err.message || '알 수 없는 오류'));
    } finally {
      setSaving(false);
    }
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

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span><span>/</span><span>AI 설정</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5" /> AI 설정
          </h1>
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
          {/* AI Toggle */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">AI 사용 설정</CardTitle>
              <CardDescription className="text-xs">
                AI 자동생성 기능의 활성화/비활성화를 설정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">AI 자동생성 활성화</p>
                  <p className="text-xs text-muted-foreground">
                    비활성화 시 라이브러리 기반 생성으로 대체됩니다.
                  </p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>
            </CardContent>
          </Card>

          {/* API Key */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">OpenAI API Key</CardTitle>
              <CardDescription className="text-xs">
                API Key는 서버에 암호화 저장되며 클라이언트에 노출되지 않습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasExistingKey && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    등록됨: {apiKeyHint}
                  </Badge>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {hasExistingKey ? '새 API Key (변경 시에만 입력)' : 'API Key'}
                </Label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Model Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">AI 모델 선택</CardTitle>
              <CardDescription className="text-xs">
                위험성평가 및 작업계획서 AI 자동생성에 사용할 모델을 선택합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="border-border/50 bg-muted/30">
            <CardContent className="py-4 text-xs text-muted-foreground space-y-1">
              <p>• API Key가 없어도 기본 AI 엔진(Lovable AI)으로 동작합니다.</p>
              <p>• OpenAI API Key를 입력하면 해당 모델로 우선 호출합니다.</p>
              <p>• AI 호출 실패 시 자동으로 라이브러리 데이터로 대체됩니다.</p>
              <p>• API Key는 서버 측에서만 사용되며 브라우저에 전송되지 않습니다.</p>
            </CardContent>
          </Card>

          {/* Save Button */}
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
