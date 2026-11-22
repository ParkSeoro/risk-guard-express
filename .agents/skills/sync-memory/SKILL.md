---
name: sync-memory
description: >-
  Sync SafeNex session context, decisions, completed work, and operating rules
  into GEMINI.md and .cursor/HANDOFF.md and merge to main so Antigravity on any
  other PC continues seamlessly after git pull. Trigger when the user says
  "기억 저장해줘", "기억 업데이트", "다른 PC에서 이어할게", or wraps up a major session.
---

# Sync SafeNex Memory Across PCs

## Goal
Keep `GEMINI.md` (always-on rules & current infrastructure state) and `.cursor/HANDOFF.md` (chronological decisions & recent merges) up to date in `origin/main` so that opening `ParkSeoro/risk-guard-express` on any PC gives Antigravity full continuity from turn 1.

## Procedure
1. **Sync `main` first**:
   - Ensure working tree has no unintended changes; `git fetch origin` and branch off `origin/main` (e.g., `docs/memory-sync-YYYY-MM-DD`).
2. **Update `.cursor/HANDOFF.md`**:
   - Append a concise bullet block for the current date covering:
     - Merged PRs / deployed Edge Functions / applied Supabase migrations.
     - New product or policy decisions (e.g., RBAC exceptions, cron schedules, UI rules).
     - Any explicit "do not touch / deferred" items.
3. **Update `GEMINI.md` (only if standing rules or live automation changed)**:
   - Keep `GEMINI.md` compact (< 200 lines, well under the 24 KB rule limit).
   - Never include raw secrets, API keys, bot tokens, passwords, or JWTs.
4. **Ship to `main`**:
   - Commit, push branch, open PR with `gh pr create`, squash-merge with `gh pr merge --squash --delete-branch`, and `git checkout main && git pull --ff-only origin main`.
5. **Confirm to 박서로님**:
   - Report the merged commit SHA and confirm that running `git pull` on any other PC immediately brings over the updated memory.
