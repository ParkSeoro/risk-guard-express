import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { profileSchema } from '@/lib/inputValidation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, User } from 'lucide-react';

const SettingsAccount = () => {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const { log } = useAuditLog();
  const { toast } = useToast();
  const [form, setForm] = useState({
    display_name: '',
    company: '',
    phone: '',
    position: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name || '',
        company: (profile as any).company || '',
        phone: (profile as any).phone || '',
        position: (profile as any).position || '',
      });
    }
  }, [profile]);

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

  return (
    <div className="space-y-4 animate-fade-in max-w-lg">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span><span>/</span><span>계정 정보</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <User className="h-5 w-5" /> 계정 정보
          </h1>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">프로필 정보</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">이름</Label>
            <Input value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">이메일</Label>
            <Input value={user?.email || ''} disabled className="bg-muted" />
            <p className="text-[10px] text-muted-foreground">이메일은 변경할 수 없습니다.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">회사/소속</Label>
            <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">직위</Label>
            <Input value={form.position} onChange={e => setForm(p => ({ ...p, position: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">연락처</Label>
            <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="010-0000-0000" />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsAccount;
