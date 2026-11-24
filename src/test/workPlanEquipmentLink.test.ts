import { describe, it, expect } from 'vitest';
import {
  mergeEquipmentIntoSection,
  matchEquipmentDocsToAttachments,
  type EquipmentMasterItem,
  type EquipmentAttachmentSlotLike,
} from '@/lib/workPlanEquipmentLink';

const BASE_EQ: EquipmentMasterItem = {
  id: 'eq-1',
  project_id: 'proj-1',
  company_id: 'comp-1',
  name: '50톤 이동식 크레인',
  rated_capacity: 50,
  manufacturer: '두산',
  model_name: 'KATO-50',
  is_default: false,
  reg_cert_url: 'https://x/reg.pdf',
  inspection_cert_url: 'https://x/insp.pdf',
  inspection_expiry_date: '2027-06-30',
  insurance_url: 'https://x/ins.pdf',
  insurance_expiry_date: '2026-11-20', // expired relative to 2026-11-24
  spec_sheet_url: 'https://x/spec.pdf',
};

describe('Equipment Master -> Work Plan 1-Click Linking', () => {
  it('replaces empty placeholder row and appends distinct equipment without duplicates', () => {
    const emptyJson = JSON.stringify([{ name: '', model: '', capacity: '', manufacturer: '', inspection_date: '' }]);
    const first = JSON.parse(mergeEquipmentIntoSection(emptyJson, BASE_EQ));
    expect(first).toHaveLength(1);
    expect(first[0].name).toBe('50톤 이동식 크레인');
    expect(first[0].capacity).toBe('50');

    // Re-applying same equipment updates in place (no duplicate)
    const same = JSON.parse(mergeEquipmentIntoSection(JSON.stringify(first), BASE_EQ));
    expect(same).toHaveLength(1);

    // Adding a second equipment appends cleanly
    const second = JSON.parse(
      mergeEquipmentIntoSection(JSON.stringify(same), {
        ...BASE_EQ,
        name: '25톤 크레인',
        model_name: 'TADANO-25',
        rated_capacity: 25,
      }),
    );
    expect(second).toHaveLength(2);
  });

  it('links non-expired equipment docs to unlocked matching slots and skips expired docs', () => {
    const rows: EquipmentAttachmentSlotLike[] = [
      { id: 'r1', attachment_key: 'vehicle_reg', name: '건설기계 등록증', file_url: null, locked: false },
      { id: 'r2', attachment_key: 'safety_inspection', name: '정기검사 합격증', file_url: null, locked: false },
      { id: 'r3', attachment_key: 'equip_insurance', name: '건설기계 보험증권', file_url: null, locked: false },
      { id: 'r4', attachment_key: 'crane_spec', name: '크레인 제원표', file_url: null, locked: false },
      { id: 'r5', attachment_key: 'locked_doc', name: '잠금 서류', file_url: null, locked: true },
    ];

    const res = matchEquipmentDocsToAttachments(BASE_EQ, rows, '2026-11-24');
    expect(res.matches.map((m) => m.rowId)).toEqual(['r1', 'r2', 'r4']);
    expect(res.expiredSkipped).toEqual([{ docLabel: '장비 보험증권', expiryDate: '2026-11-20' }]);
  });
});
