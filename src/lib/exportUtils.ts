import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// Extend jsPDF type
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
  frequency: number;
  severity: number;
  risk: number;
  improved_frequency: number;
  improved_severity: number;
  improved_risk: number;
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

// ========== XLSX Export ==========
export function exportToXLSX(items: RiskRow[], project: ProjectInfo, masterData?: any) {
  const wb = XLSX.utils.book_new();

  // Main sheet
  const headers = ['No', '공정', '세부작업', '위험요인', '위험발생상황', '기존대책', '개선대책',
    'F', 'S', 'R', "F'", "S'", "R'", '이행상태', 'PPE', '법적근거', '책임부서', '담당자', '비고'];

  const rows = items.map((item, i) => [
    i + 1, item.process, item.sub_task, item.hazard, item.hazard_situation,
    item.existing_measure, item.improvement_measure,
    item.frequency, item.severity, item.risk,
    item.improved_frequency, item.improved_severity, item.improved_risk,
    item.status, (item.ppe || []).join(', '), (item.legal_basis || []).join(', '),
    item.department, item.assignee, item.note || '',
  ]);

  const wsData = [
    [`위험성평가표 - ${project.name}`],
    [`현장명: ${project.site_name}`, '', '', `발주사: ${project.client}`, '', '', `시공사: ${project.contractor}`],
    [`기간: ${project.period_start || ''} ~ ${project.period_end || ''}`],
    [],
    headers,
    ...rows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws['!cols'] = [
    { wch: 4 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 25 },
    { wch: 25 }, { wch: 25 }, { wch: 4 }, { wch: 4 }, { wch: 5 },
    { wch: 4 }, { wch: 4 }, { wch: 5 }, { wch: 8 }, { wch: 20 },
    { wch: 25 }, { wch: 10 }, { wch: 8 }, { wch: 15 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, '위험성평가');

  // Master data sheet
  if (masterData) {
    const masterWs = XLSX.utils.aoa_to_sheet([
      ['기준정보'],
      [],
      ['PPE 목록'],
      ...(masterData.ppe || []).map((p: any) => [p.name]),
      [],
      ['법적근거'],
      ['법령명', '조문', '설명'],
      ...(masterData.legalRefs || []).map((l: any) => [l.law_name, l.article, l.description]),
    ]);
    XLSX.utils.book_append_sheet(wb, masterWs, '기준정보');
  }

  XLSX.writeFile(wb, `위험성평가_${project.name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ========== PDF Export ==========
export function exportToPDF(items: RiskRow[], project: ProjectInfo, approvalInfo?: any) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Use default font (no Korean font embedding - relies on browser rendering)
  doc.setFontSize(16);
  doc.text('Risk Assessment Report', 14, 15);
  doc.setFontSize(10);
  doc.text(`Project: ${project.name}`, 14, 23);
  doc.text(`Site: ${project.site_name}`, 14, 28);
  doc.text(`Client: ${project.client} / Contractor: ${project.contractor}`, 14, 33);
  doc.text(`Period: ${project.period_start || ''} ~ ${project.period_end || ''}`, 14, 38);
  doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`, 14, 43);

  // Approval signatures
  if (approvalInfo && approvalInfo.length > 0) {
    const startX = 200;
    doc.setFontSize(8);
    approvalInfo.forEach((ap: any, i: number) => {
      const x = startX + i * 25;
      doc.rect(x, 15, 24, 20);
      doc.text(ap.step, x + 2, 20);
      doc.text(ap.approver_name || '', x + 2, 26);
      doc.text(ap.status, x + 2, 32);
    });
  }

  // Table
  const tableData = items.map((item, i) => [
    i + 1, item.process, item.sub_task, item.hazard,
    item.frequency, item.severity, item.risk,
    item.improved_frequency, item.improved_severity, item.improved_risk,
    item.status, item.department, item.assignee,
  ]);

  doc.autoTable({
    startY: 48,
    head: [['No', 'Process', 'Sub Task', 'Hazard', 'F', 'S', 'R', "F'", "S'", "R'", 'Status', 'Dept', 'Assignee']],
    body: tableData,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 8 },
      4: { cellWidth: 8 }, 5: { cellWidth: 8 }, 6: { cellWidth: 10 },
      7: { cellWidth: 8 }, 8: { cellWidth: 8 }, 9: { cellWidth: 10 },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const colIdx = data.column.index;
        if (colIdx === 6 || colIdx === 9) {
          const val = Number(data.cell.raw);
          if (val >= 16) data.cell.styles.fillColor = [254, 202, 202];
          else if (val >= 9) data.cell.styles.fillColor = [254, 240, 138];
          else data.cell.styles.fillColor = [187, 247, 208];
        }
      }
    },
  });

  doc.save(`RiskAssessment_${project.name}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ========== Print ==========
export function printRiskAssessment() {
  window.print();
}
