import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY: number };
  }
}

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

// ========== XLSX Export ==========
export function exportToXLSX(items: RiskRow[], project: ProjectInfo, masterData?: any, participants?: Participant[], runInfo?: RunInfo) {
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

  const title = runInfo ? `위험성평가표 [${runInfo.type}] ${runInfo.period_label}` : `위험성평가표 - ${project.name}`;

  const wsData = [
    [title],
    [`현장명: ${project.site_name}`, '', '', `발주사: ${project.client}`, '', '', `시공사: ${project.contractor}`],
    [`기간: ${project.period_start || ''} ~ ${project.period_end || ''}`],
    [],
    headers,
    ...rows,
    [],
    [],
  ];

  // Add signature section
  const sigRows = buildSignatureRows(participants || []);
  wsData.push(['서명란']);
  sigRows.forEach(r => wsData.push(r));

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 4 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 25 },
    { wch: 25 }, { wch: 25 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 20 },
    { wch: 25 }, { wch: 10 }, { wch: 8 }, { wch: 15 },
  ];

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

// ========== PDF Export ==========
export function exportToPDF(
  items: RiskRow[],
  project: ProjectInfo,
  approvalInfo?: any,
  participants?: Participant[],
  runInfo?: RunInfo,
  validationReport?: any
) {
  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const title = runInfo
      ? `Risk Assessment [${runInfo.type}] ${runInfo.period_label}`
      : `Risk Assessment - ${project.name}`;

    // Cover page info
    doc.setFontSize(16);
    doc.text(title, 14, 15);
    doc.setFontSize(10);
    doc.text(`Project: ${project.name}`, 14, 23);
    doc.text(`Site: ${project.site_name}`, 14, 28);
    doc.text(`Client: ${project.client} / Contractor: ${project.contractor}`, 14, 33);
    doc.text(`Period: ${project.period_start || ''} ~ ${project.period_end || ''}`, 14, 38);
    doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`, 14, 43);

    // Signature boxes at top-right
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

    const tableData = items.map((item, i) => [
      i + 1, item.process, item.sub_task, item.hazard,
      item.likelihood_grade || '중', item.severity_grade || '중', item.risk_grade || '중',
      item.improved_likelihood_grade || '하', item.improved_severity_grade || '하', item.improved_risk_grade || '하',
      item.status, item.department, item.assignee,
    ]);

    doc.autoTable({
      startY: 48,
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

    // Signature section at bottom
    const finalY = doc.lastAutoTable?.finalY || 180;
    if (sigParticipants.length > 0 && finalY < 170) {
      doc.setFontSize(9);
      doc.text('Signatures', 14, finalY + 8);
      doc.autoTable({
        startY: finalY + 12,
        head: [['Role', 'Name', 'Company', 'Date']],
        body: sigParticipants.map(p => [p.role, p.user_name, p.company || '', p.signed_at ? new Date(p.signed_at).toLocaleDateString() : '']),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [100, 116, 139] },
      });
    }

    // Validation report page (if provided)
    if (validationReport) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text('Validation Report', 14, 15);
      doc.setFontSize(10);
      doc.text(`Score: ${validationReport.score} / 100`, 14, 23);
      doc.text(`Verdict: ${validationReport.verdict}`, 14, 28);
      doc.text(`Issues: ${validationReport.totalIssues} (Errors: ${validationReport.errors}, Warnings: ${validationReport.warnings})`, 14, 33);

      if (validationReport.issues && validationReport.issues.length > 0) {
        doc.autoTable({
          startY: 40,
          head: [['#', 'Severity', 'Rule', 'Message']],
          body: validationReport.issues.slice(0, 50).map((issue: any, i: number) => [
            i + 1, issue.severity, issue.ruleId || '', issue.message,
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [220, 38, 38] },
        });
      }
    }

    // Force download as file
    const fileName = runInfo
      ? `위험성평가_${runInfo.type}_${runInfo.period_label}_${new Date().toISOString().slice(0, 10)}.pdf`
      : `RiskAssessment_${project.name}_${new Date().toISOString().slice(0, 10)}.pdf`;

    doc.save(fileName);
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert(`PDF 생성에 실패했습니다.\n원인: ${err instanceof Error ? err.message : String(err)}\n\n다시 시도해주세요.`);
  }
}

// ========== Print ==========
export function printRiskAssessment() {
  window.print();
}
