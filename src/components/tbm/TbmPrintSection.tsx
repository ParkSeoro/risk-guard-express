import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hidden on screen, visible on print.
 * Renders all TBM sessions tied to the assessment run with worker signatures.
 */
export default function TbmPrintSection({ runId }: { runId: string }) {
  const [data, setData] = useState<Array<{ session: any; participants: any[] }>>([]);

  useEffect(() => {
    (async () => {
      const { data: sessions } = await supabase
        .from('tbm_sessions' as any)
        .select('*').eq('run_id', runId).order('tbm_date');
      const list: any[] = (sessions as any) || [];
      const result = await Promise.all(list.map(async (s) => {
        const { data: parts } = await supabase
          .from('tbm_participations' as any)
          .select('*').eq('tbm_session_id', s.id).order('participated_at');
        return { session: s, participants: (parts as any) || [] };
      }));
      setData(result);
    })();
  }, [runId]);

  if (data.length === 0) return null;

  return (
    <div className="hidden print:block mt-6 page-break-before tbm-print-signatures">
      <style>{`
        @media print {
          .tbm-print-signatures {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            page-break-inside: auto !important;
          }
          .tbm-print-signatures table,
          .tbm-print-signatures tbody {
            page-break-inside: auto !important;
            break-inside: auto !important;
          }
          .tbm-print-signatures thead { display: table-header-group; }
          .tbm-print-signatures tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>
      <h2 className="text-lg font-bold mb-3 border-b-2 border-foreground pb-1">근로자 TBM 참여 및 서명</h2>
      {data.map(({ session, participants }) => (
        <div key={session.id} className="mb-6">
          <div className="flex justify-between text-sm mb-2 border-b pb-1">
            <strong>{session.title}</strong>
            <span>{session.tbm_date} · {session.location} · 주관: {session.leader_name}</span>
          </div>
          {participants.length === 0 ? (
            <p className="text-xs text-muted-foreground">참여자 없음</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border p-1 w-8">#</th>
                  <th className="border p-1">성명</th>
                  <th className="border p-1">소속</th>
                  <th className="border p-1">전화</th>
                  <th className="border p-1">참여시각</th>
                  <th className="border p-1 w-32">서명</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, i) => (
                  <tr key={p.id}>
                    <td className="border p-1 text-center">{i + 1}</td>
                    <td className="border p-1">{p.worker_name}</td>
                    <td className="border p-1">{p.company_name || '-'}</td>
                    <td className="border p-1">{p.worker_phone}</td>
                    <td className="border p-1">{new Date(p.participated_at).toLocaleString('ko-KR')}</td>
                    <td className="border p-1 text-center">
                      {p.signature_data && <img src={p.signature_data} alt="서명" className="inline-block h-8 max-w-full object-contain" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
