import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, CloudSun, Eye, EyeOff, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

const SECRET_KEYS = [
  {
    key: 'KMA_API_KEY',
    label: '기상청(KMA) API Key',
    help: 'data.go.kr 공공데이터포털 VilageFcst 서비스 키',
  },
  {
    key: 'OPENWEATHER_API_KEY',
    label: 'OpenWeather API Key',
    help: '지오코딩·보조 날씨·기압/일출일몰 보강용',
  },
] as const;

type SecretKey = (typeof SECRET_KEYS)[number]['key'];

function maskHint(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

const SettingsWeather = () => {
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const isMaster = hasRole('master');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hints, setHints] = useState<Record<SecretKey, string>>({
    KMA_API_KEY: '',
    OPENWEATHER_API_KEY: '',
  });
  const [drafts, setDrafts] = useState<Record<SecretKey, string>>({
    KMA_API_KEY: '',
    OPENWEATHER_API_KEY: '',
  });
  const [show, setShow] = useState<Record<SecretKey, boolean>>({
    KMA_API_KEY: false,
    OPENWEATHER_API_KEY: false,
  });

  useEffect(() => {
    if (!isMaster) {
      setLoading(false);
      return;
    }
    void loadHints();
  }, [isMaster]);

  const loadHints = async () => {
    try {
      const { data, error } = await supabase
        .from('integration_secrets' as any)
        .select('key, hint')
        .in('key', ['KMA_API_KEY', 'OPENWEATHER_API_KEY']);
      if (error) throw error;
      const next = { ...hints };
      for (const row of (data as any[]) || []) {
        if (row?.key === 'KMA_API_KEY' || row?.key === 'OPENWEATHER_API_KEY') {
          next[row.key as SecretKey] = row.hint || '';
        }
      }
      setHints(next);
    } catch (err: any) {
      console.error('Failed to load weather secrets:', err);
      toast.error(err?.message || '날씨 API 키 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!isMaster || !user) return;
    const updates = SECRET_KEYS.filter(({ key }) => drafts[key].trim().length > 0);
    if (updates.length === 0) {
      toast.message('변경할 키가 없습니다', { description: '새 키를 입력한 뒤 저장하세요.' });
      return;
    }

    setSaving(true);
    try {
      const rows = updates.map(({ key }) => {
        const value = drafts[key].trim();
        return {
          key,
          value,
          hint: maskHint(value),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        };
      });

      const { error } = await supabase
        .from('integration_secrets' as any)
        .upsert(rows as any, { onConflict: 'key' });
      if (error) throw error;

      setHints((prev) => {
        const next = { ...prev };
        for (const row of rows) next[row.key as SecretKey] = row.hint;
        return next;
      });
      setDrafts({ KMA_API_KEY: '', OPENWEATHER_API_KEY: '' });
      toast.success('날씨 API 키가 저장되었습니다.');
    } catch (err: any) {
      console.error('Failed to save weather secrets:', err);
      toast.error(err?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!isMaster) {
    return (
      <div className="max-w-2xl space-y-4 animate-fade-in">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> 설정
        </Button>
        <p className="text-sm text-muted-foreground">마스터 권한이 필요합니다.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> 설정
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CloudSun className="h-6 w-6" /> 현장 날씨 API
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          기상청·OpenWeather 키를 저장하면 Lovable 프록시 없이 직접 조회합니다. 키가 없으면 레거시 연동 또는 Open-Meteo를 사용합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API 키</CardTitle>
          <CardDescription>
            값은 DB에만 저장되며 화면에 다시 표시되지 않습니다. 힌트만 확인됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : (
            SECRET_KEYS.map(({ key, label, help }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>
                <p className="text-xs text-muted-foreground">{help}</p>
                {hints[key] ? (
                  <p className="text-xs">등록됨: <span className="font-mono">{hints[key]}</span></p>
                ) : (
                  <p className="text-xs text-muted-foreground">미등록</p>
                )}
                <div className="flex gap-2">
                  <Input
                    id={key}
                    type={show[key] ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder={hints[key] ? '새 키로 교체하려면 입력' : 'API 키 입력'}
                    value={drafts[key]}
                    onChange={(e) => setDrafts((p) => ({ ...p, [key]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShow((p) => ({ ...p, [key]: !p[key] }))}
                    aria-label={show[key] ? '숨기기' : '보기'}
                  >
                    {show[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))
          )}

          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            저장
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsWeather;
