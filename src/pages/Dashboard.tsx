import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRiskLevel, getRiskClassName } from "@/types";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Dashboard = () => {
  const [projects, setProjects] = useState<{ id: string; name: string; site_name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('projects').select('id, name, site_name').then(({ data }) => {
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    supabase.from('risk_items').select('*').eq('project_id', selectedProject).then(({ data }) => setItems(data || []));
  }, [selectedProject]);

  const currentProject = projects.find(p => p.id === selectedProject);
  const highRiskCount = items.filter(i => (i.risk || 0) >= 16).length;
  const inProgressCount = items.filter(i => i.status === '진행').length;
  const completedCount = items.filter(i => i.status === '완료').length;
  const notStartedCount = items.filter(i => i.status === '미착수').length;
  const avgRisk = items.length > 0 ? (items.reduce((s, i) => s + (i.risk || 0), 0) / items.length).toFixed(1) : '0';

  const processData = Object.entries(
    items.reduce((acc, item) => {
      if (!acc[item.process]) acc[item.process] = { total: 0, count: 0 };
      acc[item.process].total += (item.risk || 0);
      acc[item.process].count += 1;
      return acc;
    }, {} as Record<string, { total: number; count: number }>)
  ).map(([name, d]) => {
    const data = d as { total: number; count: number };
    return {
    name,
    avg: Math.round(data.total / data.count * 10) / 10,
    level: getRiskLevel(Math.round(data.total / data.count)),
  };}).sort((a, b) => b.avg - a.avg);

  const statusData = [
    { name: '미착수', value: notStartedCount, color: 'hsl(0, 72%, 51%)' },
    { name: '진행', value: inProgressCount, color: 'hsl(45, 93%, 47%)' },
    { name: '완료', value: completedCount, color: 'hsl(145, 63%, 42%)' },
  ];

  const topRisks = [...items].sort((a, b) => (b.risk || 0) - (a.risk || 0)).slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">대시보드</h1>
          <p className="text-sm text-muted-foreground mt-1">{currentProject?.site_name || '프로젝트를 선택하세요'}</p>
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-60 text-xs"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-muted-foreground font-medium">총 평가항목</p><p className="text-3xl font-bold mt-1">{items.length}</p></div>
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><ShieldAlert className="h-5 w-5 text-primary" /></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-muted-foreground font-medium">고위험 항목</p><p className="text-3xl font-bold mt-1 text-destructive">{highRiskCount}</p></div>
            <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-muted-foreground font-medium">개선 완료율</p><p className="text-3xl font-bold mt-1 text-success">{items.length > 0 ? Math.round(completedCount / items.length * 100) : 0}%</p></div>
            <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'hsl(145 63% 42% / 0.1)' }}><CheckCircle2 className="h-5 w-5 text-success" /></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div><p className="text-xs text-muted-foreground font-medium">평균 위험도</p><p className="text-3xl font-bold mt-1">{avgRisk}</p></div>
            <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center"><BarChart3 className="h-5 w-5 text-accent" /></div>
          </div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">공정별 평균 위험도</CardTitle></CardHeader>
          <CardContent>
            {processData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={processData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" domain={[0, 25]} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Bar dataKey="avg" radius={[0, 4, 4, 0]} barSize={20}>
                    {processData.map((entry, i) => (
                      <Cell key={i} fill={entry.level === 'high' ? 'hsl(0, 72%, 51%)' : entry.level === 'medium' ? 'hsl(45, 93%, 47%)' : 'hsl(145, 63%, 42%)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground py-16">데이터가 없습니다</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">이행상태 현황</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center">
            {items.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="hsl(var(--card))" strokeWidth={3}>
                      {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 text-xs mt-2">
                  {statusData.map(s => (
                    <div key={s.name} className="flex items-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-muted-foreground">{s.name}</span>
                      <span className="font-semibold">{s.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-center text-muted-foreground py-16">데이터가 없습니다</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> 고위험 항목 Top 5
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topRisks.length > 0 ? (
            <table className="w-full data-table">
              <thead><tr><th>공정</th><th>세부작업</th><th>위험요인</th><th className="text-center">위험도(R)</th><th className="text-center">개선후(R')</th><th className="text-center">이행상태</th><th>책임부서</th></tr></thead>
              <tbody>
                {topRisks.map(item => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.process}</td>
                    <td>{item.sub_task}</td>
                    <td>{item.hazard}</td>
                    <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold ${getRiskClassName(item.risk || 0)}`}>{item.risk || 0}</span></td>
                    <td className="text-center"><span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold ${getRiskClassName(item.improved_risk || 0)}`}>{item.improved_risk || 0}</span></td>
                    <td className="text-center"><Badge variant={item.status === '완료' ? 'default' : 'outline'} className={`text-[10px] ${item.status === '완료' ? 'bg-success text-success-foreground' : ''}`}>{item.status}</Badge></td>
                    <td>{item.department}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-center text-muted-foreground py-8">데이터가 없습니다</p>}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
