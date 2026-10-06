import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/components/AppSidebar.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

describe('sidebar grouping and chrome', () => {
  it('keeps daily work first and folds the rest', () => {
    const today = src.indexOf('label: "오늘"');
    const site = src.indexOf('label: "현장"');
    const docs = src.indexOf('label: "서류"');
    const more = src.indexOf('label: "더보기"');
    expect(today).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(today);
    expect(docs).toBeGreaterThan(site);
    expect(more).toBeGreaterThan(docs);
    expect(src).not.toMatch(/label: "핵심"/);
    expect(src).not.toMatch(/label: "위험\/검증"/);
    const todayChunk = src.slice(today, site);
    expect(todayChunk).toMatch(/알림[\s\S]*대시보드/);
    expect(todayChunk).toMatch(/TBM 일지[\s\S]*AI 어시스턴트/);
    const moreChunk = src.slice(more);
    expect(moreChunk).toMatch(/label: "사고·비상"/);
    expect(moreChunk).toMatch(/label: "위치"/);
    expect(moreChunk).toMatch(/label: "보건"/);
    expect(moreChunk).toMatch(/label: "운영"/);
    expect(moreChunk.indexOf('label: "사고·비상"')).toBeLessThan(moreChunk.indexOf('label: "위치"'));
    expect(moreChunk.indexOf('label: "위치"')).toBeLessThan(moreChunk.indexOf('label: "보건"'));
    expect(moreChunk.indexOf('label: "보건"')).toBeLessThan(moreChunk.indexOf('label: "운영"'));
  });

  it('collapses to an icon rail and uses deep navy plus amber labels', () => {
    expect(src).toContain('collapsible="icon"');
    expect(src).not.toContain('collapsible="offcanvas"');
    expect(css).toContain('--sidebar-background: 217 57% 13%');
    expect(css).toContain('--sidebar-primary: 40 82% 50%');
  });
});
