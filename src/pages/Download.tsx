import { Monitor, Smartphone, Download, ShieldCheck, RefreshCw, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { openPlayStore } from '@/lib/playStore';

const GITHUB_REPO = 'ParkSeoro/risk-guard-express';
const PC_DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/SafeNex_PC_Setup_1.1.6.exe`;

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/30 to-background text-foreground py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground hover:text-foreground">
            <Link to="/auth">
              <ArrowLeft className="h-4 w-4" /> 로그인 화면으로
            </Link>
          </Button>
          <Badge variant="outline" className="text-xs px-3 py-1 font-mono">
            SafeNex Enterprise Platform
          </Badge>
        </div>

        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 text-primary mb-1">
            <ShieldCheck className="h-10 w-10" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">SafeNex 앱 다운로드 센터</h1>
          <p className="text-muted-foreground text-sm sm:text-base max-w-xl mx-auto">
            스마트 안전관리 시스템 SafeNex를 현장과 사무실의 모든 기기에서 최적의 환경으로 이용하세요.
          </p>
        </div>

        {/* Download Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Windows PC Installer */}
          <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all shadow-sm hover:shadow-md flex flex-col justify-between">
            <CardHeader className="space-y-2 pb-4">
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Monitor className="h-7 w-7" />
                </div>
                <Badge className="bg-primary/90 hover:bg-primary font-medium">공식 정식 버전 v1.1.6</Badge>
              </div>
              <CardTitle className="text-xl">SafeNex PC (Windows)</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                사무실·현장 관리자 전용 데스크톱 클라이언트 (Windows 10/11, 64-bit)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul className="text-xs sm:text-sm text-muted-foreground space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span><strong>듀얼 모니터 완벽 지원</strong> (화면 튕김 없음)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span><strong>실시간 안전 메신저 & 1클릭 즉시 결재</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span><strong>무설치 자동 업데이트(OTA)</strong> 지원</span>
                </li>
              </ul>

              <div className="pt-2">
                <Button asChild size="lg" className="w-full gap-2 text-base font-semibold shadow-sm">
                  <a href={PC_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                    <Download className="h-5 w-5" /> Windows용 다운로드 (.exe)
                  </a>
                </Button>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  최초 1회만 설치하시면 이후 모든 업데이트는 자동으로 적용됩니다.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Android Mobile */}
          <Card className="hover:border-border/80 transition-all shadow-sm flex flex-col justify-between">
            <CardHeader className="space-y-2 pb-4">
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Smartphone className="h-7 w-7" />
                </div>
                <Badge variant="secondary">모바일 현장용</Badge>
              </div>
              <CardTitle className="text-xl">SafeNex 모바일 (Android)</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                현장 근로자·안전점검원용 모바일 앱
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul className="text-xs sm:text-sm text-muted-foreground space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span><strong>TBM QR 스캔 & 즉시 서명</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span><strong>위험구역 진입 시 비상 경보(SOS) 알림</strong></span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span><strong>현장 순찰 및 작업중지 요청</strong></span>
                </li>
              </ul>

              <div className="pt-2">
                <Button size="lg" variant="outline" className="w-full gap-2 text-base font-semibold" onClick={() => openPlayStore()}>
                  <Download className="h-5 w-5" /> Google Play 스토어 열기
                </Button>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  Android 스마트폰에서 즉시 설치하여 사용하실 수 있습니다.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Windows SmartScreen Guide */}
        <Card className="border bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <CardTitle className="text-base sm:text-lg font-semibold">
                Windows 설치 시 "Windows의 PC 보호" 창이 나타나는 경우
              </CardTitle>
            </div>
            <CardDescription className="text-xs sm:text-sm">
              처음 배포된 기업용 프로그램 설치 시 Windows SmartScreen 보안 필터가 작동할 수 있습니다. 정상적인 안내이며 아래 2단계를 진행해 주시면 됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
              <div className="p-3.5 rounded-lg border bg-muted/40 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-primary">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs">1</span>
                  [추가 정보] 클릭
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  파란색 보호 창 본문에 작게 표시된 밑줄 친 <strong>"추가 정보"</strong>를 클릭합니다.
                </p>
              </div>
              <div className="p-3.5 rounded-lg border bg-muted/40 space-y-1.5">
                <div className="font-semibold flex items-center gap-1.5 text-primary">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs">2</span>
                  우측 하단 [실행] 클릭
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  창 우측 하단에 새롭게 나타나는 <strong>"실행"</strong> 버튼을 누르면 정상적으로 설치가 완료됩니다.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center pt-1">
              ※ 이 과정은 최초 설치 시 1회만 필요하며, 설치 완료 후에는 모든 기능이 자동 무설치 업데이트됩니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
