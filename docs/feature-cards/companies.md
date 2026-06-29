# Feature Card #22 — Company / Department / Manager

**Source**: `src/pages/Companies.tsx`, `src/pages/CompanyDetail.tsx`
**Tables**: `companies`, `company_departments`, `company_managers`, `company_construction_info`, `workers`

## 8-Dimension Quality Checklist

1. **Permissions** — Scoped by `useProjectAccess().selectedProject`; RLS restricts visibility to project members.
2. **Data SSOT** — `companies` is SSOT for company info; `company_construction_info` holds mandatory scope/period/cost; manager list drives 담당자 후보 across modules.
3. **Realtime** — Subscribes to `companies` (project-filtered), `company_managers`, `company_departments`.
4. **UX**
   - KPI cards: 전체 회사 / 시공사 / 협력사 / 공사정보 미등록
   - Type tabs with live counts (발주처/원도급/시공사/협력사)
   - Search across name + scope
   - Skeleton card grid while loading
   - Empty state separated (none registered vs. no filter matches)
5. **Aggregations** — Per-card metrics: 관리자 / 부서 / 근로자 counts in a single batched round-trip.
6. **Compliance Warning** — Contractor/Vendor without `company_construction_info` row gets a red border + warning hint linking to the detail page (산안법 제63조 도급인 의무 정보 등록).
7. **Soft Delete** — Filters `is_deleted = false` on companies, managers, departments, workers.
8. **No Silent Errors** — Loading and empty states explicit; missing project shows guidance.

## Notes
- The four count queries use `as any` casts to bypass deep generic inference (TS2589) from Supabase v2 typed builder.
- `company_construction_info` is intentionally unique per company; presence ⇒ compliant.
