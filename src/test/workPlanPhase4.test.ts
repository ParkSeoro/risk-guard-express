import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WORK_PLAN_TOUR_STEPS,
  WORK_PLAN_TOUR_STORAGE_KEY,
  findSectionLegalHint,
} from '@/lib/workPlanGuides';

describe('Phase 4: Adoption Guides (Tour Coach + Legal Term Popovers + KOSHA Examples)', () => {
  it('defines a 4-step 30-second tour with valid target tabs', () => {
    expect(WORK_PLAN_TOUR_STEPS).toHaveLength(4);
    expect(WORK_PLAN_TOUR_STORAGE_KEY).toBeTruthy();
    const validTabs = new Set(['basic', 'sections', 'attachments', 'preview']);
    for (const [idx, step] of WORK_PLAN_TOUR_STEPS.entries()) {
      expect(step.stepNumber).toBe(idx + 1);
      expect(step.title.length).toBeGreaterThan(4);
      expect(step.body.length).toBeGreaterThan(10);
      expect(step.tip.length).toBeGreaterThan(5);
      if (step.targetTab) expect(validTabs.has(step.targetTab)).toBe(true);
    }
  });

  it('provides plain-Korean legal explanations and KOSHA examples for key Article 38 sections', () => {
    const keys = [
      'risk',
      'commander',
      'route',
      'loto',
      'isolation',
      'bench_slope',
      'support_water',
      'sequence_protect',
      'traffic_control',
      'supervisor',
      'signal',
    ];
    for (const k of keys) {
      const hint = findSectionLegalHint(k);
      expect(hint, k).toBeTruthy();
      expect(hint!.legalBasis).toContain('산업안전보건기준에 관한 규칙');
      expect(hint!.plainExplanation.length).toBeGreaterThan(15);
      expect(hint!.koshaExample.length).toBeGreaterThan(15);
    }
    expect(findSectionLegalHint('non_existent_key')).toBeNull();
  });

  it('wires WorkPlanTourCoach and LegalTermTooltip into WorkPlanDetail without breaking tabs', () => {
    const src = readFileSync(resolve(__dirname, '../pages/WorkPlanDetail.tsx'), 'utf-8');
    expect(src).toContain('WorkPlanTourCoach');
    expect(src).toContain('LegalTermTooltip');
    expect(src).toContain('화면 안내');
    expect(src).toContain('findSectionLegalHint');
  });
});
