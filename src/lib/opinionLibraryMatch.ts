export type OpinionRiskSuggestion = {
  process?: string | null;
  sub_task?: string | null;
  hazard?: string | null;
  hazard_situation?: string | null;
  existing_measure?: string | null;
  improvement_measure?: string | null;
  ppe?: string[] | null;
  likelihood_grade?: string | null;
  severity_grade?: string | null;
  fromLibrary?: boolean;
};

export type LibraryOpinionRow = {
  process?: string | null;
  sub_task?: string | null;
  hazard?: string | null;
  hazard_situation?: string | null;
  existing_measure?: string | null;
  improvement_measure?: string | null;
  ppe?: string[] | null;
  likelihood_grade?: string | null;
  severity_grade?: string | null;
};

function norm(v?: string | null): string {
  return String(v || "").trim().toLowerCase();
}

/** 의견에서 나온 위험은 라이브러리 행이 있으면 그 문장을 쓴다. 등급은 제안하지 않고 라이브러리 값을 남긴다. */
export function matchOpinionRiskToLibrary<T extends OpinionRiskSuggestion>(
  suggestion: T,
  library: LibraryOpinionRow[],
): T & { fromLibrary: boolean } {
  const hazard = norm(suggestion.hazard);
  const sub = norm(suggestion.sub_task);
  const hit = library.find((row) => {
    const rowHazard = norm(row.hazard);
    const rowSub = norm(row.sub_task);
    if (!hazard || !rowHazard) return false;
    if (hazard === rowHazard) return true;
    if (sub && rowSub && sub === rowSub && (rowHazard.includes(hazard) || hazard.includes(rowHazard))) return true;
    return false;
  });
  if (!hit) return { ...suggestion, fromLibrary: false };
  return {
    ...suggestion,
    fromLibrary: true,
    process: hit.process || suggestion.process,
    sub_task: hit.sub_task || suggestion.sub_task,
    hazard: hit.hazard || suggestion.hazard,
    hazard_situation: hit.hazard_situation || "",
    existing_measure: hit.existing_measure || "",
    improvement_measure: hit.improvement_measure || "",
    ppe: hit.ppe || [],
    likelihood_grade: hit.likelihood_grade || suggestion.likelihood_grade,
    severity_grade: hit.severity_grade || suggestion.severity_grade,
  };
}
