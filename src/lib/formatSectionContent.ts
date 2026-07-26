// Renders a section's stored content (which may be raw JSON) as human-readable
// Korean text. Handles the "raw {\"workPlan\":...}" leak by walking the object
// and mapping known English keys to Korean labels.

const KO_LABELS: Record<string, string> = {
  work_name: '작업명', work_date: '작업일시', work_location: '작업위치',
  work_content: '작업내용', supervisor: '현장감독자', workers_count: '투입인원',
  name: '장비명', model: '모델명', capacity: '정격하중', manufacturer: '제조사',
  inspection_date: '검사일', order: '순서', description: '작업단계',
  safety_measure: '안전조치', hazard: '위험요인', situation: '발생상황',
  measure: '안전대책', severity: '위험도', signal_person: '신호수',
  signal_method: '신호방식', radio_channel: '무전 채널', hand_signals: '수신호',
  emergency_signal: '비상정지 신호', emergency_contact: '비상연락처',
  hospital: '인근병원', evacuation_route: '대피경로', assembly_point: '집결장소',
  first_aid: '응급처치', reporting_procedure: '보고체계', notes: '비고',
  workPlan: '작업계획', workAreaName: '작업장소', workPathName: '운행경로',
};

function render(val: any): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    return val
      .map((item, i) => {
        if (typeof item === 'object' && item !== null) {
          const parts = Object.entries(item)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${KO_LABELS[k] || k}: ${render(v)}`);
          return `${i + 1}. ${parts.join(' / ')}`;
        }
        return `${i + 1}. ${render(item)}`;
      })
      .join('\n');
  }
  if (typeof val === 'object') {
    return Object.entries(val)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `• ${KO_LABELS[k] || k}: ${render(v)}`)
      .join('\n');
  }
  return '';
}

export function formatSectionContent(content: string | null | undefined): string {
  if (!content) return '';
  const trimmed = content.trim();
  if (!trimmed) return '';
  // If not JSON-shaped, return as-is (already Korean text).
  if (!/^[[{]/.test(trimmed)) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    const rendered = render(parsed);
    return rendered || trimmed;
  } catch {
    return trimmed;
  }
}
