/**
 * 공종 라이브러리 가져오기 전에 건수와 후보를 계산한다.
 * 화면은 이 결과를 보여주고, 사용자가 고르기 전에는 회차에 넣지 않는다.
 */

export type LibraryNameRow = {
  process_key: string;
  process_label: string;
};

export type TradeCandidate = {
  processKey: string;
  processLabel: string;
  count: number;
};

export type TradePreview = {
  typed: string;
  exactCount: number;
  candidates: TradeCandidate[];
};

export function libraryInsertCap(detail: "core" | "comprehensive"): number {
  return detail === "comprehensive" ? 20 : 12;
}

/** ilike 토큰. 공백을 없애 철근배근과 철근 배근이 같은 검색에 걸리게 한다. */
export function likeToken(raw: string): string {
  return raw.replace(/\s/g, "").replace(/[%_,.()'"\\]/g, "").slice(0, 24);
}

export function groupLibraryNames(rows: LibraryNameRow[]): TradeCandidate[] {
  const map = new Map<string, TradeCandidate>();
  for (const row of rows) {
    const processKey = String(row.process_key || "").trim();
    if (!processKey) continue;
    const prev = map.get(processKey);
    if (prev) {
      prev.count += 1;
      continue;
    }
    map.set(processKey, {
      processKey,
      processLabel: String(row.process_label || processKey).trim() || processKey,
      count: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.processLabel.localeCompare(b.processLabel, "ko"));
}

export function buildTradePreview(
  typed: string,
  exactRows: LibraryNameRow[],
  fuzzyRows: LibraryNameRow[],
): TradePreview {
  const exactCount = groupLibraryNames(exactRows).reduce((n, c) => n + c.count, 0);
  if (exactCount > 0) return { typed, exactCount, candidates: [] };
  return { typed, exactCount: 0, candidates: groupLibraryNames(fuzzyRows) };
}

export function tradePreviewLine(preview: TradePreview): string {
  if (preview.exactCount > 0) return `${preview.typed} ${preview.exactCount}건을 가져옵니다.`;
  if (preview.candidates.length === 0) {
    return `${preview.typed}: 이 공종으로 라이브러리 항목이 없습니다. 공종 이름을 확인하거나 AI 초안을 켜세요.`;
  }
  if (preview.candidates.length === 1) {
    const c = preview.candidates[0];
    return `${preview.typed} → ${c.processLabel} ${c.count}건. 이 공종으로 찾을까요.`;
  }
  return `${preview.typed}과 가까운 공종이 ${preview.candidates.length}개입니다. 하나를 고르세요.`;
}

export function chosenProcessKey(preview: TradePreview, pick?: string): string | null {
  if (preview.exactCount > 0) return preview.typed;
  if (pick && preview.candidates.some((c) => c.processKey === pick)) return pick;
  return null;
}

export function tradeFillBlockReason(
  previews: TradePreview[],
  picks: Record<string, string>,
  useAI: boolean,
): string | null {
  for (const preview of previews) {
    if (chosenProcessKey(preview, picks[preview.typed])) continue;
    if (preview.candidates.length > 0) return `${preview.typed}의 표준 공종을 고르세요.`;
    if (!useAI) {
      return `${preview.typed}: 이 공종으로 라이브러리 항목이 없습니다. 공종 이름을 확인하거나 AI 초안을 켜세요.`;
    }
  }
  return null;
}

export const LIBRARY_EMPTY_MESSAGE =
  "이 공종으로 라이브러리 항목이 없습니다. 공종 이름을 확인하거나 AI 초안을 켜세요.";
