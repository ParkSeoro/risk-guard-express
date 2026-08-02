/**
 * Permit print appendix (뒷장) — assigned crew + optional linked TBM signatures.
 * Hidden on screen; sibling of DigPermitForm print pages (outer page-break).
 */
import type { ReactNode } from "react";
import { formatWorkerPhone, type PermitWorkerRow } from "@/lib/permitWorkers";

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
    <div className="hidden print:block text-foreground" data-testid="permit-workers-print-page">
      <StandardA4>
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
          <table className="w-full text-xs border-collapse mb-6">
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
                  <td className="border p-1">{w.name}</td>
                  <td className="border p-1">{w.company_name || "-"}</td>
                  <td className="border p-1">{formatWorkerPhone(w.phone)}</td>
                  <td className="border p-1 h-10" />
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tbmParticipants.length > 0 && (
          <>
            <h3 className="text-sm font-bold border-b border-foreground pb-1 mb-2 mt-4">
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
          </>
        )}
      </StandardA4>
    </div>
  );
}

function StandardA4({ children }: { children: ReactNode }) {
  return (
    <div
      className="bg-white text-black mx-auto"
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
