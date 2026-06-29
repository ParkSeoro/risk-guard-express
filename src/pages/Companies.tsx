import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Users, ChevronRight, Search, Network, HardHat, AlertCircle } from 'lucide-react';

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  scope: string;
  manager_count: number;
  department_count: number;
  worker_count: number;
  has_construction_info: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  client: '발주처',
  gc: '원도급',
  contractor: '시공사',
  vendor: '협력사',
};

const TYPE_COLOR: Record<string, string> = {
  client: 'bg-primary/10 text-primary border-primary/30',
  gc: 'bg-warning/10 text-warning border-warning/30',
  contractor: 'bg-success/10 text-success border-success/30',
  vendor: 'bg-muted text-muted-foreground',
};

export default function Companies() {
  const { selectedProject } = useProjectAccess();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');

  const fetchAll = async () => {
    if (!selectedProject) return;
    setLoading(true);
    const { data } = await supabase
      .from('companies')
      .select('id, name, type, scope')
      .eq('project_id', selectedProject)
      .eq('is_deleted', false)
      .order('type')
      .order('name');
    const list = data || [];
    const ids = list.map(c => c.id);
    const counts: Record<string, { m: number; d: number; w: number }> = {};
    const ciSet = new Set<string>();
    if (ids.length > 0) {
      const mgrsP: any = (supabase.from('company_managers' as any) as any).select('company_id').in('company_id', ids).eq('is_deleted', false);
      const depsP: any = supabase.from('company_departments' as any).select('company_id').in('company_id', ids).eq('is_deleted', false);
      const wksP: any = supabase.from('workers').select('company_id').in('company_id', ids).eq('is_deleted', false);
      const cisP: any = supabase.from('company_construction_info' as any).select('company_id').in('company_id', ids);
      const [mgrsR, depsR, wksR, cisR]: any[] = await Promise.all([mgrsP, depsP, wksP, cisP]);
      const mgrs = mgrsR?.data; const deps = depsR?.data; const wks = wksR?.data; const cis = cisR?.data;
      ids.forEach(id => { counts[id] = { m: 0, d: 0, w: 0 }; });
      (mgrs as any[] | null)?.forEach(m => { if (counts[m.company_id]) counts[m.company_id].m++; });
      (deps as any[] | null)?.forEach(d => { if (counts[d.company_id]) counts[d.company_id].d++; });
      (wks as any[] | null)?.forEach(w => { if (counts[w.company_id]) counts[w.company_id].w++; });
      (cis as any[] | null)?.forEach(c => ciSet.add(c.company_id));
    }
    setCompanies(list.map(c => ({
      ...c,
      manager_count: counts[c.id]?.m || 0,
      department_count: counts[c.id]?.d || 0,
      worker_count: counts[c.id]?.w || 0,
      has_construction_info: ciSet.has(c.id),
    })));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [selectedProject]);

  // Realtime: companies / managers / departments
  useEffect(() => {
    if (!selectedProject) return;
    const ch = supabase
      .channel(`companies-rt-${selectedProject}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies', filter: `project_id=eq.${selectedProject}` }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_managers' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_departments' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [selectedProject]);

  const kpis = useMemo(() => ({
    total: companies.length,
    contractor: companies.filter(c => c.type === 'contractor').length,
    vendor: companies.filter(c => c.type === 'vendor').length,
    missingInfo: companies.filter(c => !c.has_construction_info && (c.type === 'contractor' || c.type === 'vendor')).length,
  }), [companies]);

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = { all: companies.length, client: 0, gc: 0, contractor: 0, vendor: 0 };
    companies.forEach(c => { m[c.type] = (m[c.type] || 0) + 1; });
    return m;
  }, [companies]);

  const filtered = useMemo(() => companies.filter(c => {
    if (filterType !== 'all' && c.type !== filterType) return false;
    if (search) {
      const t = search.toLowerCase();
      return c.name?.toLowerCase().includes(t) || c.scope?.toLowerCase().includes(t);
    }
    return true;
  }), [companies, search, filterType]);

  if (!selectedProject) {
    return <div className="p-6 text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요.</div>;
  }

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="h-6 w-6" /> 회사 관리
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          시공사·협력사별 공사 개요, 조직도, 관리자 정보를 등록·관리합니다. 등록된 관리자는 위험성평가·TBM 등 모든 메뉴의 담당자 후보로 자동 노출됩니다.
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '전체 회사', value: kpis.total, icon: Building2, color: 'text-foreground' },
          { label: '시공사', value: kpis.contractor, icon: HardHat, color: 'text-success' },
          { label: '협력사', value: kpis.vendor, icon: Network, color: 'text-muted-foreground' },
          { label: '공사정보 미등록', value: kpis.missingInfo, icon: AlertCircle, color: 'text-destructive' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="py-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">{k.label}</div>
                <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              </div>
              <k.icon className={`h-6 w-6 ${k.color} opacity-60`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Type tabs */}
      <Tabs value={filterType} onValueChange={setFilterType}>
        <TabsList>
          <TabsTrigger value="all" className="text-xs">전체 ({typeCounts.all})</TabsTrigger>
          <TabsTrigger value="client" className="text-xs">발주처 ({typeCounts.client || 0})</TabsTrigger>
          <TabsTrigger value="gc" className="text-xs">원도급 ({typeCounts.gc || 0})</TabsTrigger>
          <TabsTrigger value="contractor" className="text-xs">시공사 ({typeCounts.contractor || 0})</TabsTrigger>
          <TabsTrigger value="vendor" className="text-xs">협력사 ({typeCounts.vendor || 0})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search */}
      <Card>
        <CardContent className="py-3 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="회사명, 공사범위 검색..." className="h-8 pl-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{filtered.length} / {companies.length}곳</span>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="py-6 space-y-2">
              <Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" />
            </CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          {companies.length === 0 ? '등록된 회사가 없습니다. 기준정보에서 회사를 먼저 등록해주세요.' : '검색/필터 조건에 맞는 회사가 없습니다.'}
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(c => {
            const needsInfo = !c.has_construction_info && (c.type === 'contractor' || c.type === 'vendor');
            return (
              <Link key={c.id} to={`/companies/${c.id}`} className="block">
                <Card className={`hover:border-primary/50 transition-colors h-full ${needsInfo ? 'border-destructive/40' : ''}`}>
                  <CardHeader className="pb-2 flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base">{c.name}</CardTitle>
                      <Badge variant="outline" className={`mt-1 text-[10px] ${TYPE_COLOR[c.type] || ''}`}>{TYPE_LABEL[c.type] || c.type}</Badge>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1.5">
                    {c.scope && <div className="line-clamp-2">{c.scope}</div>}
                    <div className="flex items-center gap-3 pt-1 flex-wrap">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />관리자 {c.manager_count}</span>
                      <span className="flex items-center gap-1"><Network className="h-3 w-3" />부서 {c.department_count}</span>
                      <span className="flex items-center gap-1"><HardHat className="h-3 w-3" />근로자 {c.worker_count}</span>
                    </div>
                    {needsInfo && (
                      <div className="flex items-center gap-1 text-[10px] text-destructive pt-1">
                        <AlertCircle className="h-3 w-3" /> 공사정보 미등록 — 클릭하여 등록
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
