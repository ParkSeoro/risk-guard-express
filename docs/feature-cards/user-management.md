# Feature Card #21 — User & Membership Management

**Source**: `src/pages/UserManagement.tsx`
**Tables**: `profiles`, `user_roles`, `project_members`, `companies`, `projects`

## 8-Dimension Quality Checklist

1. **Permissions** — Master + project_admin gate via `useAuth().hasRole`. Only Master can change global roles (`master`/none). Last-master guard prevents lockout.
2. **Data SSOT** — `profiles` for identity, `user_roles` for global roles, `project_members` for per-project scope. Mirror legacy `role` via `projectRoleToLegacy`.
3. **Realtime** — Subscribes to `profiles`, `project_members`, `user_roles` postgres_changes and refreshes the list automatically.
4. **Validation** — `accountStatusSchema` + `roleChangeSchema` (Zod). Worker/현장소장/감리 require `company_id`.
5. **UX** — KPI cards (Total / Pending / Active / Master), status tabs, project filter, expanded search (name/company/phone), Skeleton loader, separated empty-state messages (none vs. filtered).
6. **Membership Editing** — Inline role + position selects, company badge, per-row Trash2 button removes a single membership (with confirm + audit).
7. **Audit** — All mutations call `useAuditLog().log` (`사용자상태변경`, `역할변경`, `프로젝트소속부여`, `멤버십수정`, `멤버십삭제`).
8. **Notifications** — Toasts on success/error; never silent.

## Notes
- `project_members` is hard-delete (no `is_deleted`) by design — soft-delete would require schema change; current removal is auditable.
- Master count guard runs client-side and is enforced again by the `user_roles` last-master DB trigger.
