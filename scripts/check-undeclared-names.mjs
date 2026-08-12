#!/usr/bin/env node
/**
 * Fail CI on TypeScript "Cannot find name" errors (TS2304 / TS2552).
 * These become runtime ReferenceErrors (e.g. missing validateApprovalLinesSSOT import).
 * Intentionally ignores the rest of the (currently noisy) tsc surface.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");

const result = spawnSync(
  process.execPath,
  [tsc, "-p", "tsconfig.app.json", "--noEmit", "--pretty", "false"],
  { encoding: "utf8" },
);

const out = `${result.stdout || ""}${result.stderr || ""}`;
const lines = out.split(/\r?\n/).filter(Boolean);
const undeclared = lines.filter(
  (l) =>
    /\berror TS2304:\b/.test(l) || // Cannot find name 'X'
    /\berror TS2552:\b/.test(l), // Cannot find name 'X'. Did you mean 'Y'?
);

if (undeclared.length === 0) {
  console.log("check-undeclared-names: OK (no TS2304/TS2552)");
  process.exit(0);
}

console.error("check-undeclared-names: FAIL — undeclared identifiers (runtime ReferenceError risk):\n");
for (const l of undeclared) console.error(l);
console.error(
  `\n${undeclared.length} undeclared-name error(s). Add the missing import/binding before merge.`,
);
process.exit(1);
