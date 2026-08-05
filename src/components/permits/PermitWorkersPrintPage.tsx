/**
 * Permit print appendix (뒷장) — assigned crew + optional linked TBM signatures.
 * Hidden on screen; sibling of DigPermitForm print pages (outer page-break).
 * Paginates crew rows so large lists are not clipped at ~10 on a single A4.
 */
import type { ReactNode } from "react";
import {
  chunkForPrintPages,
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

/** Rows that fit on one A4 with header; leave room for footer. */
const CREW_ROWS_PER_PAGE = 18;
const TBM_ROWS_PER_PAGE = 16;

export default function PermitWorkersPrintPage({
  workTitle,
  permitDate,
  projectName,
  workers,
  tbmTitle,
  tbmParticipants = [],
}: Props) {
  const crewPages = chunkForPrintPages(workers, CREW_ROWS_PER_PAGE);
  const tbmPages =
    tbmParticipants.length > 0
      ? chunkForPrintPages(tbmParticipants, TBM_ROWS_PER_PAGE)
      : [];

  let crewOffset = 0;
  let tbmOffset = 0;

  return (
    <div className="hidden print:block text-foreground" data-testid="permit-workers-print-page">
      <style>{`
        @media print {
          .permit-crew-a4 {
            page-break-after: always;
            break-after: page;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            page-break-inside: auto !important;
          }
          .permit-crew-a4:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .permit-crew-a4,
          .permit-crew-a4 * {
            page-break-inside: auto !important;
          }
          .permit-crew-a4 tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {crewPages.map((pageWorkers, pageIdx) => {
        const startNo = crewOffset;
        crewOffset += pageWorkers.length;
        return (
          <StandardA4 key={`crew-${pageIdx}`} className="permit-crew-a4">
            <h2 className="text-base font-bold border-b-2 border-foreground pb-1 mb-3">
              작업 인원 명단 (을지)
              {crewPages.length > 1 ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {pageIdx + 1}/{crewPages.length}
                </span>
              ) : null}
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
              <table className="w-full text-xs border-collapse mb-2">
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
                  {pageWorkers.map((w, i) => (
                    <tr key={w.id}>
                      <td className="border p-1 text-center">{startNo + i + 1}</td>
                      <td className="border p-1">{w.name}</td>
                      <td className="border p-1">{w.company_name || "-"}</td>
                      <td className="border p-1">{formatWorkerPhone(w.phone)}</td>
                      <td className="border p-1 h-10" />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </StandardA4>
        );
      })}

      {tbmPages.map((pageParts, pageIdx) => {
        const startNo = tbmOffset;
        tbmOffset += pageParts.length;
        return (
          <StandardA4 key={`tbm-${pageIdx}`} className="permit-crew-a4">
            <h3 className="text-sm font-bold border-b border-foreground pb-1 mb-2">
              TBM 참여·서명{tbmTitle ? ` — ${tbmTitle}` : ""}
              {tbmPages.length > 1 ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {pageIdx + 1}/{tbmPages.length}
                </span>
              ) : null}
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
                {pageParts.map((p, i) => (
                  <tr key={p.id}>
                    <td className="border p-1 text-center">{startNo + i + 1}</td>
                    <td className="border p-1">{p.worker_name || "-"}</td>
                    <td className="border p-1">{p.company_name || "-"}</td>
                    <td className="border p-1">
                      {p.participated_at
                        ? new Date(p.participated_at).toLocaleString("ko-KR")
                        : "-"}
                    </td>
                    <td className="border p-1 text-center">
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
          </StandardA4>
        );
      })}
    </div>
  );
}

function StandardA4({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white text-black mx-auto ${className}`}
      style={{
        width: "210mm",
        minHeight: "297mm",
        padding: "12mm 14mm",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}
