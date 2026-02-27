import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, Save } from 'lucide-react';

const Profile = () => {
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
        company: profile.company || '',
        phone: profile.phone || '',
        position: profile.position || '',
      });
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      display_name: form.display_name,
      company: form.company,
      phone: form.phone,
      position: form.position,
    }).eq('user_id', user.id);

    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '프로필이 저장되었습니다.' });
      log('프로필수정', 'profile', user.id, undefined, { fields: Object.keys(form) });
      await refreshProfile();
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-lg">
      <h1 className="text-2xl font-bold flex items-center gap-2"><User className="h-6 w-6" /> 내 프로필</h1>
      <Card>
        <CardHeader><CardTitle className="text-sm">프로필 정보</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>이름</Label>
            <Input value={form.display_name} onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>회사/소속</Label>
            <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>직위</Label>
            <Input value={form.position} onChange={e => setForm(p => ({ ...p, position: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>연락처</Label>
            <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>이메일</Label>
            <Input value={user?.email || ''} disabled className="bg-muted" />
            <p className="text-[10px] text-muted-foreground">이메일은 변경할 수 없습니다.</p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '프로필 저장'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
