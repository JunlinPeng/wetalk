#!/usr/bin/env node
/* ============================================================
   Wetalk QA - one command for the whole suite

     node tests/run-all.js                 # unit + e2e
     node tests/run-all.js --unit-only     # fast logic tests
     node tests/run-all.js --e2e-only      # browser suite
     node tests/run-all.js --screenshots-only

   Exit code is non-zero when any unit or e2e check FAILS
   (PENDING/WARN checks from in-flight work do not fail the run;
   they are listed in the report).
   ============================================================ */
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const unitOnly = args.includes("--unit-only");
const e2eOnly = args.includes("--e2e-only");
const e2eArgs = args.filter((arg) => arg !== "--unit-only" && arg !== "--e2e-only");

function run(label, commandArgs) {
  console.log("");
  console.log("=== " + label + " ===");
  const result = spawnSync(process.execPath, commandArgs, { cwd: REPO_ROOT, stdio: "inherit" });
  return result.status === 0;
}

let ok = true;
if (!e2eOnly) ok = run("Unit tests (node --test)", ["--test", "tests/unit/*.test.js"]) && ok;
if (!unitOnly) ok = run("End-to-end tests (Microsoft Edge + static server)", ["tests/e2e/run.js"].concat(e2eArgs)) && ok;

console.log("");
console.log(ok ? "SUITE PASSED" : "SUITE FAILED - see the output above and test-results/e2e-report.json");
process.exit(ok ? 0 : 1);
