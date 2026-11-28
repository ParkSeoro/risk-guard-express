import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  SAMPLE_SPEC_REV0,
  SAMPLE_SPEC_REV1,
  compareDocumentTexts,
  parsePlantDocumentBuffer,
} from '@/lib/plantDocAnalyzer';

/** Builds a minimal valid uncompressed (method 0) ZIP ArrayBuffer for testing .docx/.pptx parsing. */
function makeStoredZip(files: { name: string; content: string }[]): ArrayBuffer {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);

    const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    localParts.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 0, true); // stored
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);

    offset += local.length;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const p of localParts) {
    total.set(p, pos);
    pos += p.length;
  }
  for (const p of cdParts) {
    total.set(p, pos);
    pos += p.length;
  }
  total.set(eocd, pos);
  return total.buffer;
}

describe('Universal Plant Document Parser & Diff Engine', () => {
  it('extracts text from Excel (.xlsx) workbooks', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['품명', '규격', '수량'],
      ['SUS304L Pipe', '2"', 42],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '물량표');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const parsed = await parsePlantDocumentBuffer('boq.xlsx', out);
    expect(parsed.kind).toBe('excel');
    expect(parsed.sectionCount).toBe(1);
    expect(parsed.fullText).toContain('SUS304L Pipe | 2" | 42');
  });

  it('extracts paragraphs from Word (.docx) and slides from PowerPoint (.pptx)', async () => {
    const docxBuf = makeStoredZip([
      {
        name: 'word/document.xml',
        content: '<w:document><w:body><w:p><w:r><w:t>에어리퀴드 산소탈지 필수</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const docx = await parsePlantDocumentBuffer('spec.docx', docxBuf);
    expect(docx.kind).toBe('word');
    expect(docx.fullText).toContain('에어리퀴드 산소탈지 필수');

    const pptxBuf = makeStoredZip([
      {
        name: 'ppt/slides/slide1.xml',
        content: '<p:sld><a:p><a:r><a:t>H2 플랜트 공정 개요</a:t></a:r></a:p></p:sld>',
      },
    ]);
    const pptx = await parsePlantDocumentBuffer('briefing.pptx', pptxBuf);
    expect(pptx.kind).toBe('ppt');
    expect(pptx.fullText).toContain('H2 플랜트 공정 개요');
  });

  it('detects modified specs, numeric downgrades, and cost increases between Rev.0 and Rev.1', () => {
    const diff = compareDocumentTexts(SAMPLE_SPEC_REV0.fullText, SAMPLE_SPEC_REV1.fullText);
    expect(diff.modifiedCount + diff.addedCount + diff.removedCount).toBeGreaterThanOrEqual(4);
    expect(diff.numericChangeCount).toBeGreaterThanOrEqual(3);
  });
});
