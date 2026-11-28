import { describe, expect, it } from 'vitest';
import {
  SAMPLE_LOX_SKID_3D,
  parsePlant3dBuffer,
  run3dSpatialPreCheck,
} from '@/lib/plant3dAnalyzer';

describe('Plant 3D Model Parser (IFC/OBJ/GLB) & Spatial Pre-Check', () => {
  it('parses IFC STEP entities for tanks, pipes, and valves', () => {
    const ifcText = [
      'ISO-10303-21;',
      "DATA;",
      "#10=IFCTANK('g1',$,'TK-101 LOX Tank',$,$,$,$,$);",
      "#11=IFCPIPESEGMENT('g2',$,'LOX-101 Line',$,$,$,$,$);",
      "#12=IFCVALVE('g3',$,'PSV-101 Relief Valve',$,$,$,$,$);",
      'ENDSEC;',
    ].join('\n');
    const buf = new TextEncoder().encode(ifcText).buffer;
    const model = parsePlant3dBuffer('plant.ifc', buf);

    expect(model.format).toBe('ifc');
    expect(model.elementCount).toBe(3);
    expect(model.elements.map((e) => e.category)).toEqual(['tank', 'pipe', 'psv']);
  });

  it('parses OBJ geometry groups and computes bounding boxes', () => {
    const objText = [
      'o Tank_A',
      'v 0 0 0',
      'v 2 2 4',
      'f 1 2 1',
      'o Valve_XV1',
      'v 3 0 2.2',
      'v 3.5 0.5 2.7',
    ].join('\n');
    const buf = new TextEncoder().encode(objText).buffer;
    const model = parsePlant3dBuffer('skid.obj', buf);

    expect(model.format).toBe('obj');
    expect(model.elementCount).toBe(2);
    expect(model.vertexCount).toBe(4);
  });

  it('detects pipe-to-column clashes and elevated valve accessibility hazards on LOX skid sample', () => {
    const findings = run3dSpatialPreCheck(SAMPLE_LOX_SKID_3D);
    expect(findings.some((f) => f.category === '간섭(Clash)')).toBe(true);
    expect(findings.some((f) => f.category === '접근성·조작높이')).toBe(true);
  });
});
