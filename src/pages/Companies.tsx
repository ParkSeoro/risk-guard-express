import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Users, ChevronRight } from 'lucide-react';

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  scope: string;
  manager_count: number;
}

const TYPE_LABEL: Record<string, string> = {
  client: '발주처',
  gc: '원도급',
  contractor: '시공사',
  vendor: '협력사',
};

export default function Companies() {
  const { selectedProject } = useProjectAccess();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('companies')
        .select('id, name, type, scope')
        .eq('project_id', selectedProject)
        .eq('is_deleted', false)
        .order('type')
        .order('name');
      if (cancelled) return;
      const list = data || [];
      // Fetch manager counts in one round-trip
      const ids = list.map(c => c.id);
      let counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: mgrs } = await supabase
          .from('company_managers' as any)
          .select('company_id')
          .in('company_id', ids)
          .eq('is_deleted', false);
        (mgrs as any[] | null)?.forEach(m => {
          counts[m.company_id] = (counts[m.company_id] || 0) + 1;
        });
      }
      if (cancelled) return;
      setCompanies(list.map(c => ({ ...c, manager_count: counts[c.id] || 0 })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedProject]);

  if (!selectedProject) {
    return <div className="p-6 text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="h-6 w-6" /> 회사 관리
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          시공사·협력사별 공사 개요, 조직도, 관리자 정보를 등록·관리합니다. 등록된 관리자는 위험성평가·TBM 등 모든 메뉴의 담당자 후보로 자동 노출됩니다.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">로딩 중...</div>
      ) : companies.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">등록된 회사가 없습니다. 기준정보에서 회사를 먼저 등록해주세요.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {companies.map(c => (
            <Link key={c.id} to={`/companies/${c.id}`} className="block">
              <Card className="hover:border-primary/50 transition-colors h-full">
                <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <Badge variant="secondary" className="mt-1">{TYPE_LABEL[c.type] || c.type}</Badge>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1">
                  {c.scope && <div className="line-clamp-2">{c.scope}</div>}
                  <div className="flex items-center gap-1 pt-1">
                    <Users className="h-3 w-3" /> 등록 관리자 {c.manager_count}명
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
