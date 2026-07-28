import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useProjectAssigneePool } from '@/hooks/useProjectAssigneePool';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, AlertTriangle } from 'lucide-react';

interface Props {
  projectId: string;
}

interface DeptRow {
  id: string;
  name: string;
  company_id: string;
  company_name: string;
}

const DepartmentAssigneeMapping = ({ projectId }: Props) => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [mappings, setMappings] = useState<Record<string, { id?: string; default_user_id: string; backup_user_id: string }>>({});
  const [saving, setSaving] = useState(false);
  const { options: pool } = useProjectAssigneePool({ projectId, requireUser: true });

  useEffect(() => {
    if (!projectId) return;
    fetchData();
  }, [projectId]);

  const fetchData = async () => {
    // 1. Companies for this project (SSOT: project_companies)
    const { fetchProjectCompanies } = await import('@/lib/projectCompanies');
    const companies = await fetchProjectCompanies(projectId);

    const companyIds = companies.map((c) => c.id);
    const companyName = new Map(companies.map((c) => [c.id, c.name as string]));

    // 2. company_departments for those companies
    let deptList: DeptRow[] = [];
    if (companyIds.length > 0) {
      const { data: cd } = await supabase
        .from('company_departments' as any)
        .select('id, name, company_id, sort_order')
        .in('company_id', companyIds)
        .eq('is_deleted', false)
        .order('sort_order', { ascending: true });
      deptList = ((cd || []) as any[]).map((d) => ({
        id: d.id,
        name: d.name,
        company_id: d.company_id,
        company_name: companyName.get(d.company_id) || '',
      }));
    }
    setDepartments(deptList);

    // 3. Existing mappings
    const { data: mappingRes } = await supabase
      .from('department_assignees')
      .select('*')
      .eq('project_id', projectId);
    const map: typeof mappings = {};
    (mappingRes || []).forEach((m: any) => {
      map[m.department_id] = {
        id: m.id,
        default_user_id: m.default_user_id || '',
        backup_user_id: m.backup_user_id || '',
      };
    });
    setMappings(map);
  };

  const memberProfiles = pool.map((o) => ({
    user_id: o.user_id as string,
    display_name: o.display_name,
    company: o.company_name,
    position: o.position,
  }));

  const handleChange = (deptId: string, field: 'default_user_id' | 'backup_user_id', value: string) => {
    setMappings((prev) => ({
      ...prev,
      [deptId]: {
        ...prev[deptId],
        default_user_id: prev[deptId]?.default_user_id || '',
        backup_user_id: prev[deptId]?.backup_user_id || '',
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
          await supabase.from('department_assignees').update({
            default_user_id: mapping.default_user_id || null,
            backup_user_id: mapping.backup_user_id || null,
          }).eq('id', mapping.id);
        } else if (mapping.default_user_id || mapping.backup_user_id) {
          const { data } = await supabase.from('department_assignees').insert([{
            project_id: projectId,
            department_id: dept.id,
            default_user_id: mapping.default_user_id || null,
            backup_user_id: mapping.backup_user_id || null,
          }]).select().single();
          if (data) {
            setMappings((prev) => ({
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
          등록된 부서가 없습니다. <strong>회사 관리 → 조직도</strong> 에서 부서를 먼저 추가해 주세요.
        </CardContent>
      </Card>
    );
  }

  // Group departments by company
  const grouped = departments.reduce<Record<string, { company_name: string; rows: DeptRow[] }>>((acc, d) => {
    if (!acc[d.company_id]) acc[d.company_id] = { company_name: d.company_name, rows: [] };
    acc[d.company_id].rows.push(d);
    return acc;
  }, {});

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
          기본적으로 <strong>회사 관리 → 조직도</strong>에 등록한 부서 담당자(우선: 대표 담당자)가 자동으로 사용됩니다.
          이 화면은 예외적으로 다른 사람을 기본 담당자로 강제 지정하고 싶을 때만 사용하세요.
        </p>
        {Object.entries(grouped).map(([cid, g]) => (
          <div key={cid} className="mb-6">
            <h4 className="text-sm font-semibold mb-2">{g.company_name}</h4>
            <table className="w-full data-table text-sm">
              <thead>
                <tr>
                  <th className="w-1/4">부서</th>
                  <th className="w-1/3">기본 담당자</th>
                  <th className="w-1/3">백업 담당자</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((dept) => {
                  const mapping = mappings[dept.id] || { default_user_id: '', backup_user_id: '' };
                  return (
                    <tr key={dept.id}>
                      <td className="font-medium">{dept.name}</td>
                      <td>
                        <Select
                          value={mapping.default_user_id || '_none'}
                          onValueChange={(v) => handleChange(dept.id, 'default_user_id', v)}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— 미지정 —</SelectItem>
                            {memberProfiles.map((mp) => (
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
                          onValueChange={(v) => handleChange(dept.id, 'backup_user_id', v)}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="선택" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— 미지정 —</SelectItem>
                            {memberProfiles.map((mp) => (
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default DepartmentAssigneeMapping;
