// 위험성평가 AI 결과 품질 점수 계산
// - 반복율, 다양성, 분포 엔트로피 → 종합 점수(0~100)

export interface QualityMetrics {
  total: number;
  uniqueHazards: number;
  uniqueSubTasks: number;
  duplicateRate: number; // 0~1
  diversityScore: number; // 0~1
  distributionEntropy: number; // 0~log(n)
  qualityScore: number; // 0~100
}

export function computeQualityMetrics(items: Array<{ sub_task?: string; hazard?: string; likelihood_grade?: string; severity_grade?: string }>): QualityMetrics {
  const total = items.length;
  if (total === 0) {
    return {
      total: 0,
      uniqueHazards: 0,
      uniqueSubTasks: 0,
      duplicateRate: 0,
      diversityScore: 0,
      distributionEntropy: 0,
      qualityScore: 0,
    };
  }

  const hazardSet = new Set<string>();
  const subTaskSet = new Set<string>();
  const gradeCounts: Record<string, number> = { 상: 0, 중: 0, 하: 0 };

  for (const it of items) {
    if (it.hazard) hazardSet.add(it.hazard.trim());
    if (it.sub_task) subTaskSet.add(it.sub_task.trim());
    const g = it.likelihood_grade || "중";
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  }

  const uniqueHazards = hazardSet.size;
  const uniqueSubTasks = subTaskSet.size;
  const duplicateRate = 1 - uniqueHazards / total;
  const diversityScore = uniqueSubTasks / total;

  // entropy of grade distribution
  let entropy = 0;
  for (const k of Object.keys(gradeCounts)) {
    const p = gradeCounts[k] / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(3);
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  // composite score: diversity 50% + (1 - dup) 30% + entropy 20%
  const qualityScore = Math.round(
    (diversityScore * 50 + (1 - duplicateRate) * 30 + normalizedEntropy * 20)
  );

  return {
    total,
    uniqueHazards,
    uniqueSubTasks,
    duplicateRate: Math.round(duplicateRate * 1000) / 1000,
    diversityScore: Math.round(diversityScore * 1000) / 1000,
    distributionEntropy: Math.round(entropy * 1000) / 1000,
    qualityScore,
  };
}
