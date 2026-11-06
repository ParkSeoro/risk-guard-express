import React, { useState } from 'react';
import { useGlobalProjectAccess } from '@/components/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { AirLiquideLogo } from '@/components/owner-safety/AirLiquideLogo';
import { OfficialLetterRegistry } from '@/components/owner-safety/OfficialLetterRegistry';
import { TeamPeriodicTasks } from '@/components/owner-safety/TeamPeriodicTasks';
import { TeamSharedSheet } from '@/components/owner-safety/TeamSharedSheet';
import { WeeklyWorkReports } from '@/components/owner-safety/WeeklyWorkReports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileText,
  CalendarCheck,
  Table as TableIcon,
  LayoutDashboard,
  ShieldCheck,
  Send,
  Building2,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export default function OwnerSafetyWorkspace() {
  const { selectedProject, projects } = useGlobalProjectAccess();
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'letters' | 'tasks' | 'sheet' | 'dashboard'>('letters');

  const currentProjectName =
    projects.find((p) => p.id === selectedProject)?.name || 'GSC 여수 H2/LCO2 PJT';

  return (
    <div className="space-y-4">
      {/* Workspace Header */}
      <div className="bg-gradient-to-r from-card via-card to-primary/5 p-4 sm:p-5 rounded-xl border shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-white rounded-lg border shadow-xs shrink-0">
              <AirLiquideLogo className="h-8" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                  건설안전팀 워크스페이스
                </h1>
                <Badge className="bg-[#004B97] hover:bg-[#004B97] text-white text-[11px] font-semibold gap-1">
                  <ShieldCheck className="h-3 w-3" /> 건설안전팀 전용
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  {currentProjectName}
                </Badge>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                에어리퀴드코리아 기술본부 건설안전팀 공식 공문 넘버링, 수발신 대장 및 주기별 업무 협업 허브
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 bg-background/80 p-2 rounded-lg border text-xs">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-muted-foreground">담당자:</span>
            <span className="font-bold text-slate-900 dark:text-slate-100">
              {profile?.display_name || '박서로 차장'}
            </span>
            <span className="text-muted-foreground">(기술본부 건설안전팀)</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mt-5 pt-3 border-t">
          <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
            <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full sm:w-[620px] h-9">
              <TabsTrigger value="letters" className="text-xs gap-1.5 font-medium">
                <FileText className="h-3.5 w-3.5" /> 공문 수발신 관리
              </TabsTrigger>
              <TabsTrigger value="tasks" className="text-xs gap-1.5 font-medium">
                <CalendarCheck className="h-3.5 w-3.5" /> 주기별 업무 관리
              </TabsTrigger>
              <TabsTrigger value="sheet" className="text-xs gap-1.5 font-medium">
                <TableIcon className="h-3.5 w-3.5" /> 안전팀 공유 시트
              </TabsTrigger>
              <TabsTrigger value="dashboard" className="text-xs gap-1.5 font-medium">
                <LayoutDashboard className="h-3.5 w-3.5" /> 대시보드 요약
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <WeeklyWorkReports projectId={selectedProject} />

      {/* Tab 1: Official Letter Registry & Generator */}
      {activeTab === 'letters' && <OfficialLetterRegistry projectId={selectedProject} />}

      {/* Tab 2: Periodic Tasks */}
      {activeTab === 'tasks' && <TeamPeriodicTasks />}

      {/* Tab 3: Shared Sheet Grid */}
      {activeTab === 'sheet' && <TeamSharedSheet />}

      {/* Tab 4: Overview Dashboard */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> 공식 공문 관리 현황
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-1 space-y-2">
                <div className="flex items-center justify-between text-xs py-1 border-b">
                  <span className="text-muted-foreground">공문 채번 기준</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    ALK Technology - Construction Safety - YY-NN호
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs py-1 border-b">
                  <span className="text-muted-foreground">당해년도(2026) 발송 공문</span>
                  <span className="font-bold text-emerald-600">2건 완료</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1">
                  <span className="text-muted-foreground">최근 발송 건</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    하절기 온열질환 3대 기본수칙 이행의 件
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('letters')}
                  className="w-full mt-2 text-xs"
                >
                  공문 대장 바로가기
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-indigo-600" /> 금일 & 금주 핵심 안전 업무
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-1 space-y-2">
                <div className="flex items-center justify-between text-xs py-1 border-b">
                  <span className="text-muted-foreground">오늘 필수 점검</span>
                  <span className="font-bold text-blue-600">고위험 PTW 현장 대조</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1 border-b">
                  <span className="text-muted-foreground">주간 안전공정회의</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">매주 목요일 14:00</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1">
                  <span className="text-muted-foreground">스마트안전장비 점검</span>
                  <span className="text-emerald-600 font-bold">점검 완료</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('tasks')}
                  className="w-full mt-2 text-xs"
                >
                  주기별 업무 체크리스트 확인
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TableIcon className="h-4 w-4 text-emerald-600" /> 공유 시트 협업 현황
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-1 space-y-2">
                <div className="flex items-center justify-between text-xs py-1 border-b">
                  <span className="text-muted-foreground">동시 관리 항목</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">5개 주요 테마</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1 border-b">
                  <span className="text-muted-foreground">산업안전보건관리비</span>
                  <span className="text-amber-600 font-bold">집행율 67.8% (정상)</span>
                </div>
                <div className="flex items-center justify-between text-xs py-1">
                  <span className="text-muted-foreground">특별안전교육 이수증</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">28명 수합 완료</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('sheet')}
                  className="w-full mt-2 text-xs"
                >
                  공유 시트 열기
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Quick Notice Card */}
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4 flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <h4 className="font-bold text-slate-900 dark:text-slate-100">
                  건설안전팀 공문 및 업무 자동화 가이드
                </h4>
                <p className="text-muted-foreground leading-relaxed">
                  팀원분들께 공문 발송 시 본 시스템의 <strong>[새 공문 작성]</strong> 버튼을 통해 넘버링을 자동 채번받아
                  작성하시기 바랍니다. 작성된 공문은 A4 실제 양식으로 즉시 인쇄하거나 PDF로 저장할 수 있으며, 수발신 대장에 자동
                  기록되어 이력이 안전하게 보관됩니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
