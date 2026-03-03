import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Save, AlertTriangle } from 'lucide-react';

interface Props {
  projectId: string;
}

const DepartmentAssigneeMapping = ({ projectId }: Props) => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [mappings, setMappings] = useState<Record<string, { id?: string; default_user_id: string; backup_user_id: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetchData();
  }, [projectId]);

  const fetchData = async () => {
    const [deptRes, memberRes, profileRes, mappingRes] = await Promise.all([
      supabase.from('master_departments').select('*').order('name'),
      supabase.from('project_members').select('user_id, role').eq('project_id', projectId),
      supabase.from('profiles').select('user_id, display_name, company, position'),
      supabase.from('department_assignees').select('*').eq('project_id', projectId),
    ]);
    setDepartments(deptRes.data || []);
    setMembers(memberRes.data || []);
    setProfiles(profileRes.data || []);

    // Build mappings
    const map: typeof mappings = {};
    (mappingRes.data || []).forEach((m: any) => {
      map[m.department_id] = {
        id: m.id,
        default_user_id: m.default_user_id || '',
        backup_user_id: m.backup_user_id || '',
      };
    });
    setMappings(map);
  };

  const memberProfiles = members.map(m => {
    const p = profiles.find(pr => pr.user_id === m.user_id);
    return { user_id: m.user_id, display_name: p?.display_name || m.user_id.slice(0, 8), company: p?.company, position: p?.position };
  });

  const handleChange = (deptId: string, field: 'default_user_id' | 'backup_user_id', value: string) => {
    setMappings(prev => ({
      ...prev,
      [deptId]: {
        ...prev[deptId],
        [field]: value === '_none' ? '' : value,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const dept of departments) {
        const mapping = mappings[dept.id];
        if (!mapping) continue;

        if (mapping.id) {
          // Update existing
          await supabase.from('department_assignees').update({
            default_user_id: mapping.default_user_id || null,
            backup_user_id: mapping.backup_user_id || null,
          }).eq('id', mapping.id);
        } else if (mapping.default_user_id || mapping.backup_user_id) {
          // Insert new
          const { data } = await supabase.from('department_assignees').insert([{
            project_id: projectId,
            department_id: dept.id,
            default_user_id: mapping.default_user_id || null,
            backup_user_id: mapping.backup_user_id || null,
          }]).select().single();
          if (data) {
            setMappings(prev => ({
              ...prev,
              [dept.id]: { ...prev[dept.id], id: data.id },
            }));
          }
        }
      }
      toast({ title: '담당자 매핑이 저장되었습니다.' });
    } finally {
      setSaving(false);
    }
  };

  if (departments.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          <AlertTriangle className="h-5 w-5 mx-auto mb-2" />
          부서가 등록되지 않았습니다. 기준정보에서 부서를 먼저 추가해주세요.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">부서별 담당자 매핑</CardTitle>
        {isAdmin() && (
          <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          부서별로 기본 담당자를 지정하면 위험성평가 작성 시 책임부서 선택에 따라 담당자가 자동으로 채워집니다.
        </p>
        <table className="w-full data-table text-sm">
          <thead>
            <tr>
              <th className="w-1/4">부서</th>
              <th className="w-1/3">기본 담당자</th>
              <th className="w-1/3">백업 담당자</th>
            </tr>
          </thead>
          <tbody>
            {departments.map(dept => {
              const mapping = mappings[dept.id] || { default_user_id: '', backup_user_id: '' };
              return (
                <tr key={dept.id}>
                  <td className="font-medium">{dept.name}</td>
                  <td>
                    <Select
                      value={mapping.default_user_id || '_none'}
                      onValueChange={v => handleChange(dept.id, 'default_user_id', v)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— 미지정 —</SelectItem>
                        {memberProfiles.map(mp => (
                          <SelectItem key={mp.user_id} value={mp.user_id}>
                            {mp.display_name} {mp.position ? `(${mp.position})` : ''} {mp.company ? `· ${mp.company}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td>
                    <Select
                      value={mapping.backup_user_id || '_none'}
                      onValueChange={v => handleChange(dept.id, 'backup_user_id', v)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— 미지정 —</SelectItem>
                        {memberProfiles.map(mp => (
                          <SelectItem key={mp.user_id} value={mp.user_id}>
                            {mp.display_name} {mp.position ? `(${mp.position})` : ''} {mp.company ? `· ${mp.company}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
};

export default DepartmentAssigneeMapping;
