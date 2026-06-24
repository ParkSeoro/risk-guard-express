/**
 * DIG 안전작업허가서 (MD-000000-SF003 Rev.C) — 픽셀 단위 양식 매칭
 * 일반 / 밀폐공간 / 화기작업 3종 지원, 결재란 자동 입력, 인쇄 최적화.
 */
import { useEffect, useRef, useState } from 'react';
import ResponsiveSignaturePad, { ResponsiveSignaturePadHandle } from '@/components/ResponsiveSignaturePad';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type PermitType = 'general' | 'confined_space' | 'hot_work';

export interface PermitFormData {
  // common
  contractor_company?: string;
  work_name?: string;
  work_description?: string;
  work_location?: string;
  work_start?: string; // datetime-local
  work_end?: string;
  personnel_count?: number;
  // attachments
  att_risk_assessment?: boolean;
  att_safety_check?: boolean;
  att_tbm_log?: boolean;
  att_heavy_eq?: boolean;
  att_work_plan?: boolean;
  att_other?: string;
  // safety checklist (general)
  chk_education?: boolean;
  chk_ppe?: boolean;
  chk_msds?: boolean;
  chk_no_entry?: boolean;
  chk_smoking?: boolean;
  chk_refusal_edu?: boolean;
  chk_signage?: boolean;
  chk_zone?: boolean;
  chk_pressure?: boolean;
  // gas readings
  gas_o2?: string;
  gas_h2s?: string;
  gas_co?: string;
  gas_hc?: string;
  gas_co2?: string;
  gas_measurer?: string;
  gas_time?: string;
  // applicant (confined/hot)
  applicant_name?: string;
  applicant_company?: string;
  // confined-space-specific
  cs_type?: string;          // 맨홀/탱크/Cold Box/기타
  // hot-work-specific
  hw_type?: string;          // 용접/절단/기타
  // staff names + phones
  safety_manager_name?: string;
  safety_manager_phone?: string;
  supervisor_name?: string;
  supervisor_phone?: string;
  // hazard categories (위험작업허가 확인사항) — 카테고리 활성 + 세부 체크 + 자유텍스트
  hz_confined?: boolean;       hz_confined_detail?: Record<string, boolean>; hz_confined_note?: string;
  hz_hot?: boolean;            hz_hot_detail?: Record<string, boolean>;      hz_hot_note?: string;
  hz_loto?: boolean;           hz_loto_detail?: Record<string, boolean>;     hz_loto_note?: string;
  hz_excavation?: boolean;     hz_excavation_detail?: Record<string, boolean>; hz_excavation_note?: string;
  hz_radiation?: boolean;      hz_radiation_detail?: Record<string, boolean>; hz_radiation_note?: string;
  hz_height?: boolean;         hz_height_detail?: Record<string, boolean>;   hz_height_note?: string;
  hz_heavy?: boolean;          hz_heavy_detail?: Record<string, boolean>;    hz_heavy_note?: string;
  hz_heavy_equipment_name?: string;
  // measurement checkboxes for gas section
  gas_for_hot?: boolean;
  gas_for_confined?: boolean;
  // 기타 안전조치
  chk_etc?: boolean;
  chk_etc_note?: string;
}

export interface PermitSignatures {
  applicant?: { name: string; signature: string; signed_at: string };
  contractor_pic?: { name: string; signature: string; signed_at: string };  // 담당자(시공)
  cm?: { name: string; signature: string; signed_at: string };              // 담당자(CM)
  safety_pic?: { name: string; signature: string; signed_at: string };      // 담당자(안전)
  sm?: { name: string; signature: string; signed_at: string };              // 담당자(SM)
  site_director?: { name: string; signature: string; signed_at: string };   // 책임자(소장)
  site_supervisor?: { name: string; signature: string; signed_at: string }; // 현장감독자
  dig_approver?: { name: string; signature: string; signed_at: string };    // 승인자(DIG)
  reviewed_at?: string;
  approved_at?: string;
}

interface Props {
  permitType: PermitType;
  data: PermitFormData;
  signatures: PermitSignatures;
  onChange?: (data: PermitFormData) => void;
  onSign?: (key: keyof PermitSignatures, value: { name: string; signature: string; signed_at: string }) => void;
  readOnly?: boolean;
  printMode?: boolean;
  docNo?: string;
  projectName?: string;
}

const Cell = ({ children, className = '' }: any) => (
  <td className={`border border-foreground p-1 align-middle ${className}`}>{children}</td>
);
const Header = ({ children, className = '' }: any) => (
  <th className={`border border-foreground p-1 bg-[#c1e1c1] text-foreground font-semibold text-xs align-middle ${className}`}>{children}</th>
);
const Box = ({ checked }: { checked?: boolean }) => (
  <span className="inline-block w-3 h-3 border border-foreground mr-1 align-middle text-center text-[10px] leading-[10px]">
    {checked ? '✓' : ''}
  </span>
);

export default function DigPermitForm({
  permitType, data, signatures, onChange, onSign, readOnly, printMode, docNo = 'MD-000000-SF003', projectName = '',
}: Props) {
  const update = (patch: Partial<PermitFormData>) => onChange?.({ ...data, ...patch });
  const [signTarget, setSignTarget] = useState<keyof PermitSignatures | null>(null);
  const [signName, setSignName] = useState('');
  const sigRef = useRef<ResponsiveSignaturePadHandle | null>(null);

  const handleSign = () => {
    if (!signTarget) return;
    if (!signName.trim()) { alert('이름을 입력하세요.'); return; }
    if (!sigRef.current || sigRef.current.isEmpty()) { alert('서명을 입력하세요.'); return; }
    onSign?.(signTarget, {
      name: signName.trim(),
      signature: sigRef.current.toDataURL('image/png'),
      signed_at: new Date().toISOString(),
    });
    setSignTarget(null); setSignName('');
  };

  const SigCell = ({ k, label }: { k: keyof PermitSignatures; label?: string }) => {
    const s = signatures[k] as any;
    if (s?.signature) {
      return (
        <div className="text-center">
          <img src={s.signature} alt="서명" className="inline-block h-7 max-w-[80px] object-contain" />
          <div className="text-[9px] text-muted-foreground">{s.name}</div>
        </div>
      );
    }
    if (printMode || readOnly) return <span className="text-xs text-muted-foreground">(서명)</span>;
    return (
      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setSignTarget(k)}>
        {label || '서명'}
      </Button>
    );
  };

  const Inp = ({ value, onChangeText, placeholder, className = '' }: any) => (
    readOnly || printMode
      ? <span className="text-xs px-1">{value || ''}</span>
      : <input
          className={`w-full text-xs bg-transparent outline-none px-1 ${className}`}
          value={value || ''}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={placeholder}
        />
  );

  return (
    <div className={`dig-permit-form ${printMode ? 'print-mode' : ''} bg-white text-foreground text-xs`} style={{ fontFamily: '"Malgun Gothic","Apple SD Gothic Neo",sans-serif' }}>
      <style>{`
        .dig-permit-form table { border-collapse: collapse; width: 100%; }
        .dig-permit-form td, .dig-permit-form th { border: 1px solid #000; padding: 3px 4px; vertical-align: middle; }
        .dig-permit-form .hd { background: #c1e1c1; font-weight: 600; text-align: center; }
        .dig-permit-form h2.title { text-align:center; font-size: 18pt; font-weight: 800; margin: 8px 0; letter-spacing: 4px; }
        @media print {
          .dig-permit-form { font-size: 9pt; }
          .page-break { page-break-after: always; }
        }
      `}</style>

      {/* Header: project + doc */}
      {permitType === 'general' && (
        <>
          <div className="flex justify-between items-end mb-1 px-2">
            <div className="text-xs">Project : {projectName}</div>
            <div className="text-xs">Doc. No : {docNo}</div>
          </div>
          <h2 className="title">안전작업허가서</h2>

          <table>
            <tbody>
              <tr>
                <th className="hd w-[110px]">공사업체</th>
                <td className="w-[160px]"><Inp value={data.contractor_company} onChangeText={(v: string) => update({ contractor_company: v })} /></td>
                <th className="hd" colSpan={2}>승인업체 : DIG 에어가스(주)</th>
                <th className="hd w-[100px]">검토일</th>
                <th className="hd w-[100px]">승인일</th>
              </tr>
              <tr>
                <th className="hd">담당자(시공)</th>
                <td><SigCell k="contractor_pic" /></td>
                <th className="hd">담당자(CM)</th>
                <td><SigCell k="cm" /></td>
                <td rowSpan={3} className="text-center text-[10px]">{signatures.reviewed_at ? new Date(signatures.reviewed_at).toLocaleDateString('ko-KR') : ''}</td>
                <td rowSpan={3} className="text-center text-[10px]">{signatures.approved_at ? new Date(signatures.approved_at).toLocaleDateString('ko-KR') : ''}</td>
              </tr>
              <tr>
                <th className="hd">담당자(안전)</th>
                <td><SigCell k="safety_pic" /></td>
                <th className="hd">담당자(SM)</th>
                <td><SigCell k="sm" /></td>
              </tr>
              <tr>
                <th className="hd">책임자(소장)</th>
                <td><SigCell k="site_director" /></td>
                <th className="hd"></th>
                <td></td>
              </tr>
              <tr>
                <td colSpan={6} className="text-right text-[10px]">※ 전일 검토, 당일 작업 전 승인</td>
              </tr>
              <tr>
                <th className="hd">작업일시</th>
                <td colSpan={5}>
                  {readOnly || printMode ? (
                    <span>{data.work_start || ''} ~ {data.work_end || ''}</span>
                  ) : (
                    <div className="flex gap-1 items-center">
                      <input type="datetime-local" className="text-xs border-0 bg-transparent" value={data.work_start || ''} onChange={(e) => update({ work_start: e.target.value })} />
                      <span>~</span>
                      <input type="datetime-local" className="text-xs border-0 bg-transparent" value={data.work_end || ''} onChange={(e) => update({ work_end: e.target.value })} />
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <th rowSpan={3} className="hd">작업개요</th>
                <td colSpan={5}>작업명 : <Inp value={data.work_name} onChangeText={(v: string) => update({ work_name: v })} /></td>
              </tr>
              <tr><td colSpan={5}>작업내용 : <Inp value={data.work_description} onChangeText={(v: string) => update({ work_description: v })} /></td></tr>
              <tr>
                <td colSpan={2}>작업지역(장소) : <Inp value={data.work_location} onChangeText={(v: string) => update({ work_location: v })} /></td>
                <td colSpan={3}>작업인원 : {readOnly || printMode ? data.personnel_count : <input type="number" className="w-16 text-xs border-0 bg-transparent" value={data.personnel_count || ''} onChange={(e) => update({ personnel_count: Number(e.target.value) })} />} 명</td>
              </tr>
              <tr>
                <th className="hd">첨부서류</th>
                <td colSpan={5} className="text-[11px]">
                  <label className="mr-3 inline-flex items-center"><input type="checkbox" disabled={readOnly || printMode} checked={!!data.att_risk_assessment} onChange={(e) => update({ att_risk_assessment: e.target.checked })} className="mr-1" />위험성평가</label>
                  <label className="mr-3 inline-flex items-center"><input type="checkbox" disabled={readOnly || printMode} checked={!!data.att_safety_check} onChange={(e) => update({ att_safety_check: e.target.checked })} className="mr-1" />안전작업점검표</label>
                  <label className="mr-3 inline-flex items-center"><input type="checkbox" disabled={readOnly || printMode} checked={!!data.att_tbm_log} onChange={(e) => update({ att_tbm_log: e.target.checked })} className="mr-1" />TBM 일지</label>
                  <label className="mr-3 inline-flex items-center"><input type="checkbox" disabled={readOnly || printMode} checked={!!data.att_heavy_eq} onChange={(e) => update({ att_heavy_eq: e.target.checked })} className="mr-1" />중장비 서류</label>
                  <label className="mr-3 inline-flex items-center"><input type="checkbox" disabled={readOnly || printMode} checked={!!data.att_work_plan} onChange={(e) => update({ att_work_plan: e.target.checked })} className="mr-1" />작업계획서</label>
                  <label className="inline-flex items-center">기타 (<Inp value={data.att_other} onChangeText={(v: string) => update({ att_other: v })} />)</label>
                </td>
              </tr>
              <tr><th className="hd" colSpan={6}>안전조치 요구사항(필요한 부분에 대해 현장 확인 후 ☑ 표시)</th></tr>
              {[
                [['안전교육 이수 여부', 'chk_education'], ['보호구 착용 및 건강 상태 확인', 'chk_ppe'], ['MSDS 비치', 'chk_msds']],
                [['작업구역 외 출입금지 조치', 'chk_no_entry'], ['흡연장소 지정 및 정리정돈 상태', 'chk_smoking'], ['근로자 작업거부권 교육', 'chk_refusal_edu']],
                [['명판 설치 및 표지 부착', 'chk_signage'], ['작업구역 설정(차량 등 출입 제한)', 'chk_zone'], ['용기 개방 전 압력 방출', 'chk_pressure']],
              ].map((row, i) => (
                <tr key={i}>
                  {row.map(([label, key]) => (
                    <>
                      <td>{label}</td>
                      <td className="w-8 text-center">
                        {readOnly || printMode
                          ? <Box checked={!!(data as any)[key]} />
                          : <input type="checkbox" checked={!!(data as any)[key]} onChange={(e) => update({ [key]: e.target.checked } as any)} />}
                      </td>
                    </>
                  ))}
                </tr>
              ))}
              {/* Gas readings */}
              <tr>
                <td rowSpan={5} className="text-center font-semibold">
                  가스농도측정<br />
                  <label className="inline-flex items-center mt-1"><input type="checkbox" disabled={readOnly || printMode} className="mr-1" />화기작업</label><br/>
                  <label className="inline-flex items-center"><input type="checkbox" disabled={readOnly || printMode} className="mr-1" />밀폐공간</label>
                </td>
                <th className="hd">측정물질</th>
                <th className="hd">농도</th>
                <th className="hd">측정시간</th>
                <th className="hd">측정자</th>
                <th className="hd">기준농도</th>
              </tr>
              <tr><td>O₂</td><td><Inp value={data.gas_o2} onChangeText={(v: string) => update({ gas_o2: v })} /></td><td rowSpan={4}><Inp value={data.gas_time} onChangeText={(v: string) => update({ gas_time: v })} /></td><td rowSpan={4}><Inp value={data.gas_measurer} onChangeText={(v: string) => update({ gas_measurer: v })} /></td><td>산소(O₂) : 18.0% ~ 23.5 %</td></tr>
              <tr><td>CO₂</td><td><Inp value={data.gas_co2} onChangeText={(v: string) => update({ gas_co2: v })} /></td><td>이산화탄소(CO₂) : 1.5% 미만</td></tr>
              <tr><td>H₂S</td><td><Inp value={data.gas_h2s} onChangeText={(v: string) => update({ gas_h2s: v })} /></td><td>황화수소(H₂S) : 10ppm 미만</td></tr>
              <tr><td>CO</td><td><Inp value={data.gas_co} onChangeText={(v: string) => update({ gas_co: v })} /></td><td>일산화탄소(CO) : 30ppm 미만</td></tr>
            </tbody>
          </table>

          <table className="mt-1">
            <tbody>
              <tr>
                <th className="hd w-[80px]" rowSpan={2}>작업장<br/>안전조치<br/>확인</th>
                <th className="hd">작업 전 교육</th>
                <td colSpan={4}>작업 위험요소 및 안전조치에 대한 교육(TBM 외) 실시</td>
              </tr>
              <tr>
                <th className="hd">작업완료 확인<br/>(정리정돈, 서류회수)</th>
                <td>시 분</td>
                <th className="hd">현장감독자</th>
                <td className="w-[120px]"><SigCell k="site_supervisor" /></td>
                <th className="hd">승인자(DIG)</th>
              </tr>
              <tr>
                <td colSpan={6} className="text-right">
                  <SigCell k="dig_approver" label="DIG 승인 서명" />
                </td>
              </tr>
              <tr>
                <th className="hd">작업허가 연장</th>
                <td colSpan={3}>{readOnly || printMode ? '' : <input type="datetime-local" className="text-xs border-0 bg-transparent" />} 까지</td>
                <th className="hd">승인</th>
                <td><SigCell k="dig_approver" label="연장 승인" /></td>
              </tr>
            </tbody>
          </table>

          <div className="text-[10px] mt-2 px-2">
            ※ 공사업체 작업공종별 안전서류(을지) 첨부 후 현황판에 비치 바랍니다.<br />
            ① 작업계획서 ② 위험성평가 ③ 안전작업 점검표 ④ TBM 일지 ⑤ MSDS<br />
            ⑥ 중장비 서류 (작업계획서, 등록증&amp;검사증, 보험증, 면허증, 안전점검표, 특별안전교육 및 준수서약서)
          </div>
        </>
      )}

      {permitType === 'confined_space' && (
        <>
          <div className="flex justify-end mb-1 px-2"><div className="text-xs">Doc. No : {docNo}</div></div>
          <h2 className="title">밀폐공간 작업허가서</h2>
          <table>
            <tbody>
              <tr>
                <th className="hd w-[100px]">신청인</th>
                <td>소속(업체명) : <Inp value={data.applicant_company} onChangeText={(v: string) => update({ applicant_company: v })} /></td>
                <td>성명 : <Inp value={data.applicant_name} onChangeText={(v: string) => update({ applicant_name: v })} /></td>
                <td className="w-[120px]"><SigCell k="applicant" /></td>
              </tr>
              <tr><th className="hd">작업 기간</th><td colSpan={3}>{data.work_start || ''} ~ {data.work_end || ''}</td></tr>
              <tr><th className="hd">작업 장소</th><td colSpan={3}><Inp value={data.work_location} onChangeText={(v: string) => update({ work_location: v })} /></td></tr>
              <tr>
                <th className="hd">작업 구분</th>
                <td colSpan={3}>
                  {['맨홀', '저장탱크', 'Cold Box', '기타'].map(t => (
                    <label key={t} className="mr-3 inline-flex items-center">
                      <input type="radio" disabled={readOnly || printMode} checked={data.cs_type === t} onChange={() => update({ cs_type: t })} className="mr-1" />{t}
                    </label>
                  ))}
                </td>
              </tr>
              <tr><th className="hd">작업 개요<br/>(필요시 도면 첨부)</th><td colSpan={3}><Inp value={data.work_description} onChangeText={(v: string) => update({ work_description: v })} /></td></tr>
              <tr>
                <th className="hd">안전조치<br/>(해당항목)</th>
                <td colSpan={3} className="text-[11px] leading-5">
                  □ 밸브차단 및 차단표식 부착 □ 맹판 설치 및 표지 부착 □ 가스농도 측정<br />
                  □ 용기세척 후 공기 치환 및 환기 □ 산소농도 측정 □ 압력 방출<br />
                  □ 정전/잠금 표지 부착 □ 감시인 배치 □ 환기장비<br />
                  □ 조명장비 □ 소화기 □ 안전장구(구명선 등) □ 안전교육
                </td>
              </tr>
              <tr><td colSpan={4} className="text-center font-semibold bg-[#f0f0f0]">가스농도 측정결과 확인</td></tr>
              <tr><th className="hd">구분</th><th className="hd">O₂</th><th className="hd">H₂S</th><th className="hd">CO / H·C / CO₂</th></tr>
              <tr><td className="text-center">측정결과</td>
                <td><Inp value={data.gas_o2} onChangeText={(v: string) => update({ gas_o2: v })} /></td>
                <td><Inp value={data.gas_h2s} onChangeText={(v: string) => update({ gas_h2s: v })} /></td>
                <td><Inp value={data.gas_co} onChangeText={(v: string) => update({ gas_co: v })} /> / <Inp value={data.gas_hc} onChangeText={(v: string) => update({ gas_hc: v })} /> / <Inp value={data.gas_co2} onChangeText={(v: string) => update({ gas_co2: v })} /></td>
              </tr>
              <tr><td className="text-center">기준 값</td><td>18%이상~23.5%미만</td><td>10ppm미만</td><td>30ppm미만 / 0% / 1.5%미만</td></tr>
              <tr>
                <th className="hd">안전관리자</th>
                <td><SigCell k="safety_pic" /></td>
                <td colSpan={2}>연락처 : <Inp value={data.safety_manager_phone} onChangeText={(v: string) => update({ safety_manager_phone: v })} /></td>
              </tr>
              <tr>
                <th className="hd">관리감독자</th>
                <td><SigCell k="site_supervisor" /></td>
                <td colSpan={2}>연락처 : <Inp value={data.supervisor_phone} onChangeText={(v: string) => update({ supervisor_phone: v })} /></td>
              </tr>
              <tr><th className="hd">현장관리</th><td colSpan={3} className="font-bold">안전관리자, 관리감독자 작업시간 현장 이탈 금지</td></tr>
              <tr>
                <th rowSpan={2} className="hd">현장 당일 확인</th>
                <th className="hd">안전조치 확인 (공사업체)</th>
                <td>성명 : <Inp value={data.applicant_name} onChangeText={(v: string) => update({ applicant_name: v })} /></td>
                <td><SigCell k="applicant" /></td>
              </tr>
              <tr><th className="hd">승인자</th><td>{signatures.approved_at ? new Date(signatures.approved_at).toLocaleDateString('ko-KR') : '년 월 일'} 성명 : {signatures.dig_approver?.name || ''}</td><td><SigCell k="dig_approver" /></td></tr>
            </tbody>
          </table>
          <div className="text-[10px] mt-2 px-2">※ 밀폐공간 작업시간은 1일 최대 8시간을 넘지 않도록 하며 연장근무 발생 시 작업허가 연장 승인 필요</div>
        </>
      )}

      {permitType === 'hot_work' && (
        <>
          <div className="flex justify-end mb-1 px-2"><div className="text-xs">Doc. No : {docNo}</div></div>
          <h2 className="title">화기작업허가서</h2>
          <table>
            <tbody>
              <tr>
                <th className="hd w-[100px]">신청인</th>
                <td>소속 : <Inp value={data.applicant_company} onChangeText={(v: string) => update({ applicant_company: v })} /></td>
                <td>성명 : <Inp value={data.applicant_name} onChangeText={(v: string) => update({ applicant_name: v })} /></td>
                <td className="w-[120px]"><SigCell k="applicant" /></td>
              </tr>
              <tr><th className="hd">작업 기간</th><td colSpan={3}>{data.work_start || ''} ~ {data.work_end || ''}</td></tr>
              <tr><th className="hd">작업 장소</th><td colSpan={3}><Inp value={data.work_location} onChangeText={(v: string) => update({ work_location: v })} /></td></tr>
              <tr>
                <th className="hd">작업 구분</th>
                <td colSpan={3}>
                  {['용접', '절단', '기타'].map(t => (
                    <label key={t} className="mr-3 inline-flex items-center">
                      <input type="radio" disabled={readOnly || printMode} checked={data.hw_type === t} onChange={() => update({ hw_type: t })} className="mr-1" />{t}
                    </label>
                  ))}
                </td>
              </tr>
              <tr><th className="hd">작업 개요</th><td colSpan={3}><Inp value={data.work_description} onChangeText={(v: string) => update({ work_description: v })} /></td></tr>
              <tr>
                <th className="hd">안전조치<br/>(해당항목)</th>
                <td colSpan={3} className="text-[11px] leading-5">
                  □ 가연물 이동(11m 이상) 및 보호조치 □ 소화기 등 소화기구 비치<br/>
                  □ 불티비산 방지포 설치 □ 화기작업 안전교육 실시<br/>
                  □ 화재감시자 지정(타 업무 수행 불가)<br/>
                  □ 작업종료 후 최소 30분 이상 관찰 □ 가스농도 측정(필요 시)<br/>
                  □ 작업구역 통풍 및 환기 □ 역화방지기 설치 □ 용접기·호스 점검
                </td>
              </tr>
              <tr><td colSpan={4} className="text-center font-semibold bg-[#f0f0f0]">가스농도 측정결과</td></tr>
              <tr><th className="hd">구분</th><th className="hd">O₂</th><th className="hd">H₂S / CO</th><th className="hd">H·C / CO₂</th></tr>
              <tr><td className="text-center">측정결과</td>
                <td><Inp value={data.gas_o2} onChangeText={(v: string) => update({ gas_o2: v })} /></td>
                <td><Inp value={data.gas_h2s} onChangeText={(v: string) => update({ gas_h2s: v })} /> / <Inp value={data.gas_co} onChangeText={(v: string) => update({ gas_co: v })} /></td>
                <td><Inp value={data.gas_hc} onChangeText={(v: string) => update({ gas_hc: v })} /> / <Inp value={data.gas_co2} onChangeText={(v: string) => update({ gas_co2: v })} /></td>
              </tr>
              <tr><td className="text-center">기준</td><td>18%이상~23.5%미만</td><td>10ppm미만 / 30ppm미만</td><td>0% / 1.5%미만</td></tr>
              <tr><th className="hd">안전관리자</th><td><SigCell k="safety_pic" /></td><td colSpan={2}>연락처 : <Inp value={data.safety_manager_phone} onChangeText={(v: string) => update({ safety_manager_phone: v })} /></td></tr>
              <tr><th className="hd">관리감독자</th><td><SigCell k="site_supervisor" /></td><td colSpan={2}>연락처 : <Inp value={data.supervisor_phone} onChangeText={(v: string) => update({ supervisor_phone: v })} /></td></tr>
              <tr><th className="hd">승인자</th><td colSpan={2}>{signatures.approved_at ? new Date(signatures.approved_at).toLocaleDateString('ko-KR') : '년 월 일'} 성명 : {signatures.dig_approver?.name || ''}</td><td><SigCell k="dig_approver" /></td></tr>
            </tbody>
          </table>
          <div className="text-[10px] mt-2 px-2">※ 연장근무 발생 시 작업허가 연장 승인 필요</div>
        </>
      )}

      {/* Sign dialog */}
      <Dialog open={!!signTarget} onOpenChange={(v) => !v && setSignTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>전자서명</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="성명" value={signName} onChange={(e) => setSignName(e.target.value)} />
            <div className="border-2 rounded">
              <ResponsiveSignaturePad ref={sigRef} height={140} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => sigRef.current?.clear()} className="flex-1">지우기</Button>
              <Button onClick={handleSign} className="flex-1">서명 등록</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
