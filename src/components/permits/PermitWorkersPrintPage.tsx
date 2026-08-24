/**
 * Permit print appendix — 작업 인원 명단 (을지) + optional TBM signatures.
 *
 * Print-only. Never mutates DigPermitForm / 허가서 양식.
 * One continuous table per block: the browser fills A4, rows never clip
 * mid-cell (`page-break-inside: avoid`), overflow continues on the next sheet.
 */
import type { ReactNode } from "react";
import {
  formatWorkerPhone,
  type PermitWorkerRow,
} from "@/lib/permitWorkers";

export type TbmParticipantPrint = {
  id: string;
  worker_name?: string | null;
  company_name?: string | null;
  worker_phone?: string | null;
  participated_at?: string | null;
  signature_data?: string | null;
};

type Props = {
  workTitle?: string;
  permitDate?: string;
  projectName?: string;
  workers: PermitWorkerRow[];
  tbmTitle?: string | null;
  tbmParticipants?: TbmParticipantPrint[];
};

export default function PermitWorkersPrintPage({
  workTitle,
  permitDate,
  projectName,
  workers,
  tbmTitle,
  tbmParticipants = [],
}: Props) {
  return (
    <div
      className="hidden print:block text-foreground permit-crew-print-root"
      data-testid="permit-workers-print-page"
    >
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .permit-crew-print-root {
            display: block !important;
            width: 100%;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            break-before: page !important;
            page-break-before: always !important;
          }
          .permit-crew-sheet {
            width: 190mm;
            margin: 0 auto;
            padding: 0;
            box-sizing: border-box;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            break-after: auto !important;
            page-break-after: auto !important;
            break-inside: auto !important;
            page-break-inside: auto !important;
          }
          /* TBM 블록만 새 장 — 을지 테이블은 장 안에서 자연스럽게 이어짐 */
          .permit-crew-sheet + .permit-crew-sheet {
            break-before: page !important;
            page-break-before: always !important;
          }
          .permit-crew-sheet table,
          .permit-crew-sheet tbody {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }
          .permit-crew-sheet tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .permit-crew-sheet thead {
            display: table-header-group;
          }
          .permit-crew-sheet td,
          .permit-crew-sheet th {
            overflow: visible !important;
          }
          .permit-crew-sheet .permit-crew-name,
          .permit-crew-sheet .permit-crew-company {
            overflow: visible !important;
            word-break: keep-all;
          }
          /* 화면 h-10(~print rem 축소)보다 조금만 키움. 고정 N명/장이 아님. */
          .permit-crew-sheet .permit-crew-sign {
            height: 10.5mm !important;
            min-height: 10.5mm !important;
          }
        }
      `}</style>

      <CrewSheet>
        <h2 className="text-base font-bold border-b-2 border-foreground pb-1 mb-3">
          작업 인원 명단 (을지)
        </h2>
        <div className="text-xs mb-3 space-y-0.5">
          {projectName && (
            <div>
              <span className="font-semibold">현장: </span>
              {projectName}
            </div>
          )}
          {workTitle && (
            <div>
              <span className="font-semibold">작업: </span>
              {workTitle}
            </div>
          )}
          {permitDate && (
            <div>
              <span className="font-semibold">일자: </span>
              {permitDate}
            </div>
          )}
          <div>
            <span className="font-semibold">인원: </span>
            {workers.length}명
          </div>
        </div>

        {workers.length === 0 ? (
          <p className="text-xs text-muted-foreground">배정된 근로자가 없습니다.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted">
                <th className="border p-1 w-8">#</th>
                <th className="border p-1">성명</th>
                <th className="border p-1">소속</th>
                <th className="border p-1">연락처</th>
                <th className="border p-1 w-28">확인/서명</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w, i) => (
                <tr key={w.id}>
                  <td className="border p-1 text-center">{i + 1}</td>
                  <td className="border p-1 permit-crew-name">
                    {w.name}
                    {w.isManager ? " (관리)" : ""}
                  </td>
                  <td className="border p-1 permit-crew-company">{w.company_name || "-"}</td>
                  <td className="border p-1">{formatWorkerPhone(w.phone)}</td>
                  <td className="border p-1 h-11 permit-crew-sign" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CrewSheet>

      {tbmParticipants.length > 0 ? (
        <CrewSheet>
          <h3 className="text-sm font-bold border-b border-foreground pb-1 mb-2">
            TBM 참여·서명{tbmTitle ? ` — ${tbmTitle}` : ""}
          </h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted">
                <th className="border p-1 w-8">#</th>
                <th className="border p-1">성명</th>
                <th className="border p-1">소속</th>
                <th className="border p-1">참여시각</th>
                <th className="border p-1 w-28">서명</th>
              </tr>
            </thead>
            <tbody>
              {tbmParticipants.map((p, i) => (
                <tr key={p.id}>
                  <td className="border p-1 text-center">{i + 1}</td>
                  <td className="border p-1 permit-crew-name">{p.worker_name || "-"}</td>
                  <td className="border p-1 permit-crew-company">{p.company_name || "-"}</td>
                  <td className="border p-1">
                    {p.participated_at
                      ? new Date(p.participated_at).toLocaleString("ko-KR")
                      : "-"}
                  </td>
                  <td className="border p-1 text-center permit-crew-sign">
                    {p.signature_data ? (
                      <img
                        src={p.signature_data}
                        alt="서명"
                        className="inline-block h-8 max-w-full object-contain"
                      />
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrewSheet>
      ) : null}
    </div>
  );
}

function CrewSheet({ children }: { children: ReactNode }) {
  return <div className="permit-crew-sheet">{children}</div>;
}
