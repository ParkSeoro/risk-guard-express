import {
  formatVoidedAtKst,
  type WorkDocVoidInfo,
} from '@/lib/workDocVoid';

export function WorkDocVoidStamp({ info }: { info: WorkDocVoidInfo | null | undefined }) {
  if (!info) return null;
  return (
    <div className="work-doc-void-stamp" aria-label="작업 취소">
      <div className="work-doc-void-stamp-box">
        <div className="work-doc-void-stamp-title">작업 취소</div>
        <div className="work-doc-void-stamp-line">사유 · {info.reason}</div>
        <div className="work-doc-void-stamp-line">취소자 · {info.byName}</div>
        <div className="work-doc-void-stamp-line">시각 · {formatVoidedAtKst(info.at)}</div>
      </div>
      <style>{`
        .work-doc-void-stamp {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 30;
          pointer-events: none;
        }
        .work-doc-void-stamp-box {
          border: 4px solid #dc2626;
          color: #dc2626;
          background: rgba(255,255,255,0.88);
          padding: 10px 18px;
          text-align: center;
          min-width: 220px;
          max-width: 86%;
          transform: rotate(-8deg);
          box-shadow: 0 0 0 1px rgba(220,38,38,0.25);
        }
        .work-doc-void-stamp-title {
          font-size: 26px;
          font-weight: 900;
          letter-spacing: 0.28em;
          line-height: 1.2;
          margin-bottom: 6px;
        }
        .work-doc-void-stamp-line {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1.35;
          word-break: break-word;
        }
        @media print {
          .work-doc-void-stamp {
            position: absolute !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .work-doc-void-stamp-box {
            background: rgba(255,255,255,0.82) !important;
            border-color: #dc2626 !important;
            color: #dc2626 !important;
          }
        }
      `}</style>
    </div>
  );
}

export function WorkDocVoidBanner({ info }: { info: WorkDocVoidInfo | null | undefined }) {
  if (!info) return null;
  return (
    <div
      className="print:hidden rounded-md border-2 border-red-600 bg-red-50 text-red-800 px-3 py-2 text-sm"
      data-testid="work-doc-void-banner"
    >
      <div className="font-bold tracking-widest">작업 취소</div>
      <div className="text-xs mt-1 space-y-0.5">
        <div>사유 · {info.reason}</div>
        <div>취소자 · {info.byName}</div>
        <div>시각 · {formatVoidedAtKst(info.at)}</div>
      </div>
    </div>
  );
}
