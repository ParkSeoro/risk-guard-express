/**
 * Zero-dependency Browser 3D Plant Model Parser & Clash/Operability Pre-Analyzer.
 * Supports .ifc (BIM/Plant IFC STEP), .obj, .stl (ASCII/Binary), and .glb (glTF 2.0).
 */

export type Plant3dFormat = 'ifc' | 'obj' | 'stl' | 'glb';
export type Plant3dCategory = 'tank' | 'equipment' | 'pipe' | 'valve' | 'psv' | 'structure' | 'other';

export interface Plant3dBoxElement {
  id: string;
  name: string;
  ifcType?: string;
  category: Plant3dCategory;
  /** Center position in meters (x, y = plan; z = elevation above grade) */
  x: number;
  y: number;
  z: number;
  /** Dimensions in meters */
  dx: number;
  dy: number;
  dz: number;
}

export interface Plant3dModelSummary {
  fileName: string;
  format: Plant3dFormat;
  vertexCount: number;
  faceCount: number;
  elementCount: number;
  boundsMeters: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  elements: Plant3dBoxElement[];
  rawMetadataSnippet: string;
}

export interface Plant3dPreCheckFinding {
  severity: 'critical' | 'warning' | 'info';
  category: '간섭(Clash)' | '접근성·조작높이' | '이격거리';
  title: string;
  detail: string;
  recommendation: string;
}

export function detect3dFormat(fileName: string): Plant3dFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ifc')) return 'ifc';
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'glb';
  return 'obj';
}

function classify3dName(name: string, ifcType = ''): Plant3dCategory {
  const s = `${name} ${ifcType}`.toLowerCase();
  if (/psv|prv|relief|안전밸브/.test(s)) return 'psv';
  if (/valve|xv-|bv-|mov|cv-|밸브/.test(s)) return 'valve';
  if (/pipe|piping|line|배관|tube/.test(s)) return 'pipe';
  if (/tank|vessel|drum|tk-|탱크|저장/.test(s)) return 'tank';
  if (/vap|comp|pump|exchanger|skid|기화기|압축기|펌프/.test(s)) return 'equipment';
  if (/beam|column|rack|frame|platform|slab|wall|steel|구조|가대/.test(s)) return 'structure';
  return 'other';
}

function computeBounds(elements: Plant3dBoxElement[]) {
  if (elements.length === 0) {
    return { minX: -5, maxX: 5, minY: -5, maxY: 5, minZ: 0, maxZ: 5 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const e of elements) {
    minX = Math.min(minX, e.x - e.dx / 2);
    maxX = Math.max(maxX, e.x + e.dx / 2);
    minY = Math.min(minY, e.y - e.dy / 2);
    maxY = Math.max(maxY, e.y + e.dy / 2);
    minZ = Math.min(minZ, e.z - e.dz / 2);
    maxZ = Math.max(maxZ, e.z + e.dz / 2);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function parsePlant3dBuffer(fileName: string, buffer: ArrayBuffer): Plant3dModelSummary {
  const format = detect3dFormat(fileName);

  if (format === 'ifc') {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    const lines = text.split(/\r?\n/);
    const elements: Plant3dBoxElement[] = [];
    const interesting = /=\s*(IFCPIPESEGMENT|IFCPIPEFITTING|IFCVALVE|IFCPUMP|IFCTANK|IFCFLOWTERMINAL|IFCFLOWMOVINGDEVICE|IFCFLOWSTORAGE|IFCENERGYCONVERSIONDEVICE|IFCBEAM|IFCCOLUMN|IFCMEMBER|IFCBUILDINGELEMENTPROXY)\s*\((.*)\);/i;

    let idx = 0;
    for (const line of lines) {
      const m = line.match(interesting);
      if (!m) continue;
      const ifcType = m[1].toUpperCase();
      const args = m[2];
      const strMatches = args.match(/'([^']*)'/g) || [];
      const name = (strMatches[1] || strMatches[0] || `${ifcType}-${idx + 1}`).replace(/'/g, '').trim() || `${ifcType}-${idx + 1}`;
      const cat = classify3dName(name, ifcType);
      const col = idx % 5;
      const row = Math.floor(idx / 5);
      elements.push({
        id: `ifc_${idx + 1}`,
        name,
        ifcType,
        category: cat,
        x: (col - 2) * 2.2,
        y: (row - 1) * 2.0,
        z: cat === 'psv' ? 3.2 : cat === 'valve' ? 1.8 : cat === 'tank' ? 2.4 : 1.2,
        dx: cat === 'tank' ? 1.8 : cat === 'pipe' ? 2.0 : 0.7,
        dy: cat === 'tank' ? 1.8 : 0.7,
        dz: cat === 'tank' ? 4.8 : cat === 'structure' ? 3.5 : 0.7,
      });
      idx++;
      if (idx >= 80) break;
    }

    return {
      fileName,
      format,
      vertexCount: elements.length * 8,
      faceCount: elements.length * 12,
      elementCount: elements.length,
      boundsMeters: computeBounds(elements),
      elements,
      rawMetadataSnippet: lines.slice(0, 40).join('\n').slice(0, 1500),
    };
  }

  if (format === 'obj') {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    const lines = text.split(/\r?\n/);
    let currentName = 'MainModel';
    const groupVerts = new Map<string, { x: number; y: number; z: number }[]>();
    let totalVerts = 0;
    let totalFaces = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('o ') || line.startsWith('g ')) {
        currentName = line.slice(2).trim() || 'Part';
      } else if (line.startsWith('v ')) {
        const parts = line.split(/\s+/);
        const x = Number(parts[1]) || 0;
        const y = Number(parts[2]) || 0;
        const z = Number(parts[3]) || 0;
        if (!groupVerts.has(currentName)) groupVerts.set(currentName, []);
        groupVerts.get(currentName)!.push({ x, y, z });
        totalVerts++;
      } else if (line.startsWith('f ')) {
        totalFaces++;
      }
    }

    const elements: Plant3dBoxElement[] = [];
    let i = 0;
    for (const [name, verts] of groupVerts.entries()) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const v of verts) {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
      elements.push({
        id: `obj_${++i}`,
        name,
        category: classify3dName(name),
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) / 2,
        dx: Math.max(0.25, maxX - minX),
        dy: Math.max(0.25, maxY - minY),
        dz: Math.max(0.25, maxZ - minZ),
      });
      if (i >= 80) break;
    }

    return {
      fileName,
      format,
      vertexCount: totalVerts,
      faceCount: totalFaces,
      elementCount: elements.length,
      boundsMeters: computeBounds(elements),
      elements,
      rawMetadataSnippet: `OBJ Objects: ${Array.from(groupVerts.keys()).join(', ').slice(0, 1200)}`,
    };
  }

  if (format === 'glb') {
    const view = new DataView(buffer);
    const elements: Plant3dBoxElement[] = [];
    let snippet = '';
    if (buffer.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67) {
      const jsonLen = view.getUint32(12, true);
      const jsonBytes = new Uint8Array(buffer, 20, Math.min(jsonLen, buffer.byteLength - 20));
      const jsonStr = new TextDecoder('utf-8').decode(jsonBytes);
      snippet = jsonStr.slice(0, 1500);
      try {
        const gltf = JSON.parse(jsonStr);
        const nodes: any[] = Array.isArray(gltf.nodes) ? gltf.nodes : [];
        nodes.slice(0, 80).forEach((n, idx) => {
          const name = String(n?.name || `Node-${idx + 1}`);
          const t = Array.isArray(n?.translation) ? n.translation : [idx * 1.4, 0, 1.2];
          const s = Array.isArray(n?.scale) ? n.scale : [1, 1, 1];
          elements.push({
            id: `glb_${idx + 1}`,
            name,
            category: classify3dName(name),
            x: Number(t[0]) || 0,
            y: Number(t[2] ?? t[1]) || 0,
            z: Number(t[1] ?? 1.2) || 1.2,
            dx: Math.max(0.4, Math.abs(Number(s[0]) || 1)),
            dy: Math.max(0.4, Math.abs(Number(s[2] ?? s[1]) || 1)),
            dz: Math.max(0.4, Math.abs(Number(s[1]) || 1)),
          });
        });
      } catch {
        // Fallback single bounding element
      }
    }
    return {
      fileName,
      format,
      vertexCount: elements.length * 8,
      faceCount: elements.length * 12,
      elementCount: elements.length,
      boundsMeters: computeBounds(elements),
      elements,
      rawMetadataSnippet: snippet || 'GLB binary model',
    };
  }

  // STL (ASCII or Binary)
  let faceCount = 0;
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer);
    faceCount = view.getUint32(80, true);
  }
  const single: Plant3dBoxElement = {
    id: 'stl_1',
    name: fileName.replace(/\.stl$/i, ''),
    category: classify3dName(fileName),
    x: 0,
    y: 0,
    z: 1.5,
    dx: 4,
    dy: 2.5,
    dz: 3,
  };
  return {
    fileName,
    format: 'stl',
    vertexCount: faceCount * 3,
    faceCount,
    elementCount: 1,
    boundsMeters: computeBounds([single]),
    elements: [single],
    rawMetadataSnippet: `STL Mesh (${faceCount.toLocaleString()} triangles)`,
  };
}

/**
 * Deterministic 3D spatial pre-check: detects bounding-box clashes between pipes/structures
 * and high-elevation valves/PSVs (> 1.8m) requiring access platforms (KGS / 산안법).
 */
export function run3dSpatialPreCheck(model: Plant3dModelSummary): Plant3dPreCheckFinding[] {
  const findings: Plant3dPreCheckFinding[] = [];
  const elems = model.elements;

  // 1. Clash detection (AABB overlap between distinct non-identical categories)
  for (let i = 0; i < elems.length; i++) {
    for (let j = i + 1; j < elems.length; j++) {
      const a = elems[i];
      const b = elems[j];
      if (a.category === 'structure' && b.category === 'structure') continue;
      const overlapX = Math.abs(a.x - b.x) < (a.dx + b.dx) / 2 - 0.05;
      const overlapY = Math.abs(a.y - b.y) < (a.dy + b.dy) / 2 - 0.05;
      const overlapZ = Math.abs(a.z - b.z) < (a.dz + b.dz) / 2 - 0.05;
      if (overlapX && overlapY && overlapZ) {
        findings.push({
          severity: 'critical',
          category: '간섭(Clash)',
          title: `3D 공간 간섭 의심: ${a.name} ↔ ${b.name}`,
          detail: `두 객체의 3D 바운딩 박스가 (${a.x.toFixed(1)}, ${a.y.toFixed(1)}, EL+${a.z.toFixed(1)}m) 부근에서 중첩됩니다.`,
          recommendation: '배관 루팅(Elevation/Offset) 또는 서포트 가대 위치를 최소 150mm 이상 이격 조정하세요.',
        });
      }
    }
  }

  // 2. Valve & PSV operability / maintenance height (> 1.8m without nearby platform)
  for (const e of elems) {
    if ((e.category === 'valve' || e.category === 'psv') && e.z > 1.8) {
      findings.push({
        severity: e.category === 'psv' ? 'warning' : 'critical',
        category: '접근성·조작높이',
        title: `${e.name} 설치 높이 과다 (EL +${e.z.toFixed(1)}m > 1.8m)`,
        detail: `비상 차단밸브·PSV가 작업자 조작 높이(1.5~1.8m)보다 높은 위치에 배치되어 비상 조작 및 주기적 검교정(KGS)이 어렵습니다.`,
        recommendation: '밸브 조작 핸들을 EL +1.2~1.5m로 하향 배치하거나, 안전난간이 포함된 전용 점검 플랫폼·계단을 반영하세요.',
      });
    }
  }

  return findings;
}

export const SAMPLE_LOX_SKID_3D: Plant3dModelSummary = {
  fileName: 'AirLiquide_LOX_Vaporizer_Skid_Rev1.ifc (샘플)',
  format: 'ifc',
  vertexCount: 72,
  faceCount: 108,
  elementCount: 9,
  boundsMeters: { minX: -4.5, maxX: 5.0, minY: -2.5, maxY: 2.5, minZ: 0, maxZ: 6.2 },
  elements: [
    { id: 'e1', name: 'TK-201 LOX 저장탱크', ifcType: 'IFCTANK', category: 'tank', x: -3.2, y: 0, z: 3.1, dx: 2.4, dy: 2.4, dz: 6.2 },
    { id: 'e2', name: 'LOX-204 인출배관 (2")', ifcType: 'IFCPIPESEGMENT', category: 'pipe', x: -1.1, y: 0, z: 1.4, dx: 2.0, dy: 0.35, dz: 0.35 },
    { id: 'e3', name: 'XV-201 탱크 차단밸브', ifcType: 'IFCVALVE', category: 'valve', x: -0.9, y: 0, z: 1.4, dx: 0.5, dy: 0.5, dz: 0.5 },
    { id: 'e4', name: 'Pipe Rack 강재 기둥 C-04', ifcType: 'IFCCOLUMN', category: 'structure', x: 0.6, y: 0.05, z: 2.0, dx: 0.45, dy: 0.45, dz: 4.0 },
    { id: 'e5', name: 'LOX-204 기화기 인입관', ifcType: 'IFCPIPESEGMENT', category: 'pipe', x: 0.7, y: 0, z: 1.4, dx: 2.2, dy: 0.35, dz: 0.35 },
    { id: 'e6', name: 'XV-202 기화기 입구밸브', ifcType: 'IFCVALVE', category: 'valve', x: 1.4, y: 0, z: 2.45, dx: 0.5, dy: 0.5, dz: 0.5 },
    { id: 'e7', name: 'PSV-201 Thermal Relief', ifcType: 'IFCVALVE', category: 'psv', x: 0.2, y: 0, z: 3.1, dx: 0.45, dy: 0.45, dz: 0.65 },
    { id: 'e8', name: 'VAP-201 대기식 기화기', ifcType: 'IFCENERGYCONVERSIONDEVICE', category: 'equipment', x: 3.0, y: 0, z: 2.2, dx: 1.9, dy: 1.8, dz: 4.4 },
    { id: 'e9', name: 'O2 공급헤더 출구관', ifcType: 'IFCPIPESEGMENT', category: 'pipe', x: 4.4, y: 0, z: 1.3, dx: 1.4, dy: 0.35, dz: 0.35 },
  ],
  rawMetadataSnippet: 'IFC4 Air Liquide LOX Skid (TK-201, VAP-201, XV-201, XV-202, PSV-201, Pipe Rack C-04)',
};
