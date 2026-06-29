import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

interface RiskRow {
  process: string;
  sub_task: string;
  hazard: string;
  hazard_situation: string;
  existing_measure: string;
  improvement_measure: string;
  likelihood_grade: string;
  severity_grade: string;
  risk_grade: string;
  improved_likelihood_grade: string;
  improved_severity_grade: string;
  improved_risk_grade: string;
  status: string;
  ppe: string[];
  legal_basis: string[];
  department: string;
  assignee: string;
  note: string;
}

interface ProjectInfo {
  name: string;
  site_name: string;
  client: string;
  contractor: string;
  period_start: string;
  period_end: string;
}

interface Participant {
  role: string;
  user_name: string;
  company: string;
  signed_at?: string;
}

interface RunInfo {
  type: string;
  period_label: string;
}

// ========== Signature Row Builder ==========
function buildSignatureRows(participants: Participant[]): string[][] {
  const roles = ['작성자', '검토자', '승인자', '협력사 담당자', '안전관리자'];
  const grouped: Record<string, Participant[]> = {};
  roles.forEach(r => { grouped[r] = []; });
  (participants || []).forEach(p => {
    if (!grouped[p.role]) grouped[p.role] = [];
    grouped[p.role].push(p);
  });
  const rows: string[][] = [['구분', '성명', '소속', '서명/일자']];
  roles.forEach(role => {
    const people = grouped[role] || [];
    if (people.length === 0) {
      rows.push([role, '', '', '']);
    } else {
      people.forEach(p => {
        rows.push([role, p.user_name, p.company || '', p.signed_at ? new Date(p.signed_at).toLocaleDateString() : '']);
      });
    }
  });
  return rows;
}

// ========== Server-based PDF: mode = 'print' | 'download' ==========
// IMPORTANT: For mode='print', the caller SHOULD pass `preOpenedWindow` opened
// synchronously inside the click handler (window.open()) to avoid popup blockers.
// If omitted we still try to open here as a best-effort fallback.
export async function exportToPDFServer(
  runId: string,
  type: 'assessment' | 'validation' = 'assessment',
  mode: 'print' | 'download' = 'print',
  preOpenedWindow?: Window | null,
) {
  const loadingHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>인쇄 준비 중…</title>
    <style>body{font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#334155;background:#f8fafc}
    .box{text-align:center}.spinner{width:36px;height:36px;border:4px solid #e2e8f0;border-top-color:#0f172a;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 12px}
    @keyframes s{to{transform:rotate(360deg)}}</style></head>
    <body><div class="box"><div class="spinner"></div><div>인쇄용 문서를 생성하고 있습니다…</div></div></body></html>`;
  if (preOpenedWindow) {
    try { preOpenedWindow.document.open(); preOpenedWindow.document.write(loadingHtml); preOpenedWindow.document.close(); } catch {}
  }

  const downloadHtmlFallback = (html: string, fileName?: string) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `위험성평가_인쇄용_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  };

  let data: any;
  try {
    const resp = await supabase.functions.invoke('generate-pdf', { body: { runId, type } });
    if (resp.error) {
      const errMsg = typeof resp.error === 'object' && resp.error.message ? resp.error.message : String(resp.error);
      throw new Error(`PDF 생성 서버 오류: ${errMsg}`);
    }
    data = resp.data;
  } catch (e) {
    if (preOpenedWindow) { try { preOpenedWindow.close(); } catch {} }
    throw e;
  }
  if (!data?.html || data.html.length < 100) {
    if (preOpenedWindow) { try { preOpenedWindow.close(); } catch {} }
    throw new Error('PDF 생성 실패: 유효한 HTML이 반환되지 않았습니다.');
  }

  const fileName = (data.fileName as string | undefined) || `위험성평가_인쇄용_${new Date().toISOString().slice(0, 10)}.html`;

  if (mode === 'download') {
    if (preOpenedWindow) { try { preOpenedWindow.close(); } catch {} }
    downloadHtmlFallback(data.html, fileName);
    return;
  }

  // mode === 'print'
  const printWindow = preOpenedWindow ?? window.open('', '_blank', 'width=1100,height=800');
  if (!printWindow) {
    downloadHtmlFallback(data.html, fileName);
    throw new Error('팝업이 차단되어 HTML 파일을 다운로드했습니다. 다운로드한 파일을 열어 인쇄해 주세요.');
  }

  printWindow.document.open();
  printWindow.document.write(data.html);
  printWindow.document.close();

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try { printWindow.focus(); printWindow.print(); } catch {}
  };

  printWindow.onload = () => {
    const images = printWindow.document.querySelectorAll('img');
    const imagePromises = Array.from(images).map(img => {
      if ((img as HTMLImageElement).complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve());
        img.addEventListener('error', () => resolve());
      });
    });
    Promise.all(imagePromises).then(() => setTimeout(doPrint, 300));
  };
  setTimeout(doPrint, 4000);
}

// ========== Client-side PDF (fallback, uses jsPDF) ==========
export async function exportToPDF(
  items: RiskRow[],
  project: ProjectInfo,
  approvalInfo?: any,
  participants?: Participant[],
  runInfo?: RunInfo,
  validationReport?: any
) {
  try {
    // Dynamic import to avoid bundle issues
    const jsPDFModule = await import('jspdf');
    const autoTableModule = await import('jspdf-autotable');
    const jsPDF = jsPDFModule.default;
    const autoTable = autoTableModule.default;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const title = runInfo
      ? `위험성평가 [${runInfo.type}] ${runInfo.period_label}`
      : `위험성평가 - ${project.name}`;

    // Cover page
    doc.setFontSize(18);
    doc.text('안전관리시스템 위험성평가', 14, 15);
    doc.setFontSize(12);
    doc.text(title, 14, 24);
    doc.setFontSize(10);
    doc.text(`Project: ${project.name}`, 14, 32);
    doc.text(`Site: ${project.site_name}`, 14, 37);
    doc.text(`Client: ${project.client} / Contractor: ${project.contractor}`, 14, 42);
    doc.text(`Period: ${project.period_start || ''} ~ ${project.period_end || ''}`, 14, 47);
    doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`, 14, 52);

    // Signature boxes
    const sigParticipants = participants || [];
    if (sigParticipants.length > 0) {
      const startX = 180;
      doc.setFontSize(7);
      sigParticipants.slice(0, 5).forEach((p, i) => {
        const x = startX + i * 22;
        doc.rect(x, 15, 21, 24);
        doc.text(p.role, x + 1, 19);
        doc.line(x, 21, x + 21, 21);
        doc.text(p.user_name || '', x + 1, 26);
        doc.line(x, 28, x + 21, 28);
        doc.text(p.company || '', x + 1, 33);
        doc.line(x, 35, x + 21, 35);
        doc.text(p.signed_at ? new Date(p.signed_at).toLocaleDateString() : '', x + 1, 38);
      });
    }

    const gradeColorMap: Record<string, number[]> = {
      '상': [254, 202, 202],
      '중': [254, 240, 138],
      '하': [187, 247, 208],
    };

    if (items.length > 0) {
      const tableData = items.map((item, i) => [
        i + 1, item.process, item.sub_task, item.hazard,
        item.likelihood_grade || '중', item.severity_grade || '중', item.risk_grade || '중',
        item.improved_likelihood_grade || '하', item.improved_severity_grade || '하', item.improved_risk_grade || '하',
        item.status, item.department, item.assignee,
      ]);

      autoTable(doc, {
        startY: 56,
        head: [['No', 'Process', 'Sub Task', 'Hazard', 'L', 'S', 'R', "L'", "S'", "R'", 'Status', 'Dept', 'Assignee']],
        body: tableData,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: {
          0: { cellWidth: 8 },
          4: { cellWidth: 10 }, 5: { cellWidth: 10 }, 6: { cellWidth: 10 },
          7: { cellWidth: 10 }, 8: { cellWidth: 10 }, 9: { cellWidth: 10 },
        },
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            const colIdx = data.column.index;
            if (colIdx === 6 || colIdx === 9) {
              const grade = String(data.cell.raw);
              if (gradeColorMap[grade]) {
                data.cell.styles.fillColor = gradeColorMap[grade];
              }
            }
          }
        },
      });

      const finalY = (doc as any).lastAutoTable?.finalY || 180;
      if (sigParticipants.length > 0 && finalY < 170) {
        doc.setFontSize(9);
        doc.text('Signatures', 14, finalY + 8);
        autoTable(doc, {
          startY: finalY + 12,
          head: [['Role', 'Name', 'Company', 'Date']],
          body: sigParticipants.map(p => [p.role, p.user_name, p.company || '', p.signed_at ? new Date(p.signed_at).toLocaleDateString() : '']),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [100, 116, 139] },
        });
      }
    }

    // Validation report page
    if (validationReport) {
      doc.addPage('a4', 'landscape');
      doc.setFontSize(14);
      doc.text('Validation Report', 14, 15);
      doc.setFontSize(10);
      doc.text(`Score: ${validationReport.score} / 100`, 14, 23);
      doc.text(`Verdict: ${validationReport.verdict}`, 14, 28);
      doc.text(`Issues: ${validationReport.totalIssues} (Errors: ${validationReport.errors}, Warnings: ${validationReport.warnings})`, 14, 33);

      if (validationReport.issues && validationReport.issues.length > 0) {
        autoTable(doc, {
          startY: 40,
          head: [['#', 'Severity', 'Rule', 'Message', 'Recommendation']],
          body: validationReport.issues.slice(0, 50).map((issue: any, i: number) => [
            i + 1, issue.severity, issue.ruleType || '', issue.message, issue.recommendation || '',
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [220, 38, 38] },
        });
      }

      if (validationReport.coverageGaps && validationReport.coverageGaps.length > 0) {
        const gapY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 100;
        if (gapY > 170) doc.addPage('a4', 'landscape');
        doc.setFontSize(10);
        doc.text('Coverage Gaps', 14, gapY > 170 ? 15 : gapY);
        autoTable(doc, {
          startY: (gapY > 170 ? 20 : gapY + 5),
          head: [['Process', 'Sub Task', 'Hazard', 'Severity', 'Level', 'Note']],
          body: validationReport.coverageGaps.slice(0, 30).map((g: any) => [
            g.process, g.subTask, g.hazard, g.severity, g.recommendLevel || '-', g.message,
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [234, 88, 12] },
        });
      }
    }

    // Download
    const fileName = runInfo
      ? `위험성평가_${runInfo.type}_${runInfo.period_label}_${new Date().toISOString().slice(0, 10)}.pdf`
      : `RiskAssessment_${project.name}_${new Date().toISOString().slice(0, 10)}.pdf`;

    safePDFDownload(doc, fileName);
  } catch (err) {
    if (import.meta.env.DEV) console.error('PDF generation failed:', err);
    alert('PDF 생성에 실패했습니다. 재시도해주세요.');
  }
}

function safePDFDownload(doc: any, fileName: string) {
  try {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (primaryErr) {
    if (import.meta.env.DEV) console.warn('Primary PDF download failed:', primaryErr);
    try {
      doc.save(fileName);
    } catch (fallbackErr) {
      if (import.meta.env.DEV) console.error('All PDF download methods failed:', fallbackErr);
      alert('PDF 다운로드에 실패했습니다.');
    }
  }
}

// ========== XLSX Export (matches PDF content) ==========
export async function exportToXLSX(items: RiskRow[], project: ProjectInfo, masterData?: any, participants?: Participant[], runInfo?: RunInfo, approvals?: ApprovalRow[]) {
  const wb = XLSX.utils.book_new();

  const headers = ['No', '공정', '세부작업', '위험요인', '위험발생상황', '기존대책', '개선대책',
    '가능성', '중대성', '위험도', '개선후 가능성', '개선후 중대성', '개선후 위험도',
    '이행상태', 'PPE', '법적근거', '책임부서', '담당자', '비고'];

  const rows = items.map((item, i) => [
    i + 1, item.process, item.sub_task, item.hazard, item.hazard_situation,
    item.existing_measure, item.improvement_measure,
    item.likelihood_grade || '중', item.severity_grade || '중', item.risk_grade || '중',
    item.improved_likelihood_grade || '하', item.improved_severity_grade || '하', item.improved_risk_grade || '하',
    item.status, (item.ppe || []).join(', '), (item.legal_basis || []).join(', '),
    item.department, item.assignee, item.note || '',
  ]);

  const title = runInfo ? `위험성평가 [${runInfo.type}] ${runInfo.period_label}` : `위험성평가 - ${project.name}`;

  const wsData: any[][] = [
    [title],
    [`현장명: ${project.site_name}`, '', '', `발주사: ${project.client}`, '', '', `시공사: ${project.contractor}`],
    [`기간: ${project.period_start || ''} ~ ${project.period_end || ''}`],
    [],
  ];

  // Signature block from approvals (SSOT) — matches PDF
  if (approvals && approvals.length > 0) {
    wsData.push(['서명란']);
    wsData.push(['구분', '성명', '소속', '직책', '서명/일자']);
    approvals.forEach(a => {
      const dateStr = a.status === '승인' && a.approved_at
        ? formatKSTExcel(a.approved_at)
        : (a.status === '반려' ? '반려' : '대기');
      wsData.push([a.step, a.approver_name || '', a.company_name || '', a.position_label || '', dateStr]);
    });
    wsData.push([]);
  } else if (participants && participants.length > 0) {
    // Fallback to participants
    const sigRows = buildSignatureRows(participants);
    wsData.push(['서명란']);
    sigRows.forEach(r => wsData.push(r));
    wsData.push([]);
  }

  // Risk items
  wsData.push(headers);
  rows.forEach(r => wsData.push(r));
  wsData.push([], []);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    { wch: 4 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 25 },
    { wch: 25 }, { wch: 25 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 20 },
    { wch: 25 }, { wch: 10 }, { wch: 8 }, { wch: 15 },
  ];
  ws['!pageSetup'] = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  ws['!margins'] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

  XLSX.utils.book_append_sheet(wb, ws, '위험성평가');

  if (masterData) {
    const masterWs = XLSX.utils.aoa_to_sheet([
      ['기준정보'], [],
      ['PPE 목록'],
      ...(masterData.ppe || []).map((p: any) => [p.name]),
      [], ['법적근거'], ['법령명', '조문', '설명'],
      ...(masterData.legalRefs || []).map((l: any) => [l.law_name, l.article, l.description]),
    ]);
    XLSX.utils.book_append_sheet(wb, masterWs, '기준정보');
  }

  const fileName = runInfo
    ? `위험성평가_${runInfo.type}_${runInfo.period_label}_${new Date().toISOString().slice(0, 10)}.xlsx`
    : `위험성평가_${project.name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

interface ApprovalRow {
  step: string;
  approver_name: string;
  company_name: string;
  position_label: string;
  status: string;
  approved_at: string | null;
}

function formatKSTExcel(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ========== Print (deprecated — use exportToPDFServer + print) ==========
export function printRiskAssessment() {
  // Never call window.print() directly — always go through PDF generation
  console.warn('printRiskAssessment is deprecated. Use exportToPDFServer instead.');
}
