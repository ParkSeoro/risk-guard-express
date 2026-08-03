/**
 * Soft guardrails for residual (개선후) risk grade "상".
 * Too many → unmanageable feedback load; zero on a large/high set → possible grade gaming.
 */

export type ResidualHighEval = {
  level: "ok" | "warn_zero" | "warn_many";
  highRemain: number;
  thresholdMany: number;
  message: string;
};

export function residualHighThresholdMany(total: number): number {
  return Math.max(5, Math.ceil(Math.max(0, total) * 0.3));
}

export function evaluateResidualHigh(input: {
  total: number;
  highInitial: number;
  highRemain: number;
}): ResidualHighEval {
  const total = Math.max(0, input.total || 0);
  const highInitial = Math.max(0, input.highInitial || 0);
  const highRemain = Math.max(0, input.highRemain || 0);
  const thresholdMany = residualHighThresholdMany(total);

  if (highRemain > thresholdMany) {
    return {
      level: "warn_many",
      highRemain,
      thresholdMany,
      message:
        `개선후 위험도 「상」이 ${highRemain}건입니다 (권장 상한 약 ${thresholdMany}건). ` +
        `대책을 보강해 「중/하」로 낮추거나, 핵심만 「상」으로 남겨 피드백 관리 대상으로 두세요.`,
    };
  }

  if (highRemain === 0 && (highInitial > 0 || total >= 10)) {
    return {
      level: "warn_zero",
      highRemain,
      thresholdMany,
      message:
        `개선후 위험도 「상」이 0건입니다. ` +
        `잔여 고위험이 정말 없는지 확인하고, 필요하면 핵심 항목은 「상」으로 남겨 피드백 관리로 넘기세요.`,
    };
  }

  return {
    level: "ok",
    highRemain,
    thresholdMany,
    message:
      highRemain > 0
        ? `개선후 「상」 ${highRemain}건 → 승인 후 피드백(조치) 관리 대상입니다.`
        : "",
  };
}
