import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, History } from 'lucide-react';
import { format } from 'date-fns';

const AuditLogs = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('projects').select('id, name').then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    setLoading(true);
    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
    if (selectedProject !== 'all') query = query.eq('project_id', selectedProject);
    query.then(({ data }) => {
      setLogs(data || []);
      setLoading(false);
    });
  }, [selectedProject]);

  const filtered = logs.filter(log => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return log.action?.toLowerCase().includes(term) ||
      log.user_name?.toLowerCase().includes(term) ||
      log.target_type?.toLowerCase().includes(term);
  });

  const actionColor = (action: string) => {
    if (['생성', '추가', '자동생성'].includes(action)) return 'bg-success/10 text-success';
    if (['삭제', '반려'].includes(action)) return 'bg-destructive/10 text-destructive';
    if (['수정', '결재상신'].includes(action)) return 'bg-accent/10 text-accent';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><History className="h-6 w-6" /> 감사 로그</h1>
          <p className="text-sm text-muted-foreground mt-1">시스템 변경 이력 조회</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 프로젝트</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="검색..." className="h-8 pl-8 text-xs w-48" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full data-table text-sm">
            <thead>
              <tr>
                <th>시간</th><th>사용자</th><th>동작</th><th>대상</th><th>대상 ID</th><th>상세</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">로딩 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">기록이 없습니다</td></tr>
              ) : filtered.map(log => (
                <tr key={log.id}>
                  <td className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(log.created_at), 'MM/dd HH:mm')}</td>
                  <td className="font-medium">{log.user_name || '시스템'}</td>
                  <td><Badge className={`text-[10px] ${actionColor(log.action)}`}>{log.action}</Badge></td>
                  <td>{log.target_type || '—'}</td>
                  <td className="text-xs text-muted-foreground font-mono">{(log.target_id || '').slice(0, 8)}</td>
                  <td className="text-xs max-w-[200px] truncate">{log.details ? JSON.stringify(log.details) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditLogs;
