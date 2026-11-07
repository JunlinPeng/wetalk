#!/usr/bin/env node
/* ============================================================
   Wetalk QA - end-to-end test runner

   Starts the dependency-free static server on the QA port (8104
   by default), drives the installed Microsoft Edge through
   playwright-core, runs every spec and writes a JSON report plus
   screenshots under test-results/.

   Usage (from the repo root):
     node tests/e2e/run.js
     node tests/e2e/run.js --screenshots-only
     node tests/e2e/run.js --only auth
     node tests/e2e/run.js --port 8104
   ============================================================ */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const harness = require("./lib/harness");
const { startServer } = require("../helpers/static-server");

const SPECS = [
  require("./specs/http.spec"),
  require("./specs/v2.spec"),
  require("./specs/pages.spec"),
  require("./specs/links.spec"),
  require("./specs/a11y.spec"),
  require("./specs/auth.spec"),
  require("./specs/flow.spec"),
  require("./specs/responsive.spec"),
  require("./specs/screenshots.spec"),
];

const STATUS_LABEL = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  pending: "PENDING",
  skip: "SKIP",
};

function parseArgs(argv) {
  const args = { port: 8104, only: null, screenshotsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg === "--only") args.only = argv[++i];
    else if (arg === "--screenshots-only") args.screenshotsOnly = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tests/e2e/run.js [--port 8104] [--only spec] [--screenshots-only]");
      process.exit(0);
    }
  }
  return args;
}

async function loadPlaywright() {
  try {
    return require("playwright-core");
  } catch (err) {
    return null;
  }
}

function printReport(results, summary) {
  console.log("");
  for (const item of results) {
    const label = STATUS_LABEL[item.status] || item.status.toUpperCase();
    const name = item.spec + " / " + item.name;
    console.log("  " + label.padEnd(7) + " " + name + (item.message ? "  - " + item.message : ""));
  }
  console.log("");
  console.log(
    "E2E summary: " +
      summary.pass +
      " passed, " +
      summary.fail +
      " failed, " +
      summary.warn +
      " warnings, " +
      summary.pending +
      " pending, " +
      summary.skip +
      " skipped (" +
      summary.total +
      " checks)"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const { testResultsDir, screenshotDir } = harness.ensureTestResults();
  const pages = harness.discoverPages();

  console.log("Wetalk e2e harness");
  console.log("  repo:     " + harness.REPO_ROOT);
  console.log("  pages:    " + pages.join(", "));
  console.log("  artifacts:" + testResultsDir);

  const results = [];
  let currentSpec = "(setup)";
  function record(status, name, message, extra) {
    results.push({ spec: currentSpec, name, status, message: message || "", extra: extra || null });
    return status;
  }
  const recorder = {
    pass: (name, message, extra) => record("pass", name, message, extra),
    fail: (name, message, extra) => record("fail", name, message, extra),
    warn: (name, message, extra) => record("warn", name, message, extra),
    pending: (name, message, extra) => record("pending", name, message, extra),
    skip: (name, message, extra) => record("skip", name, message, extra),
  };

  // ---------- static server ----------
  let server;
  try {
    server = await startServer({ port: args.port, root: harness.REPO_ROOT });
  } catch (err) {
    if (args.port !== 0) {
      console.log("  port " + args.port + " unavailable (" + err.code + "), retrying on a free port");
      server = await startServer({ port: 0, root: harness.REPO_ROOT });
    } else {
      throw err;
    }
  }
  console.log("  server:   " + server.baseURL);
  // The signed-in specs use the live Supabase QA account; tell the harness
  // where the site is served so it can sign in through the real UI.
  harness.configure({ baseURL: server.baseURL });

  // ---------- browser ----------
  const edgePath = harness.findEdgePath();
  const playwright = await loadPlaywright();
  let browser = null;
  let browserSkipReason = null;

  if (!playwright) {
    browserSkipReason =
      "playwright-core is not installed - run: pnpm install (bundled pnpm) or npm install in the repo root";
  } else if (!edgePath) {
    browserSkipReason =
      "Microsoft Edge was not found - set WETALK_EDGE_PATH to msedge.exe to run browser checks";
  } else {
    try {
      browser = await playwright.chromium.launch({
        executablePath: edgePath,
        headless: !process.env.WETALK_E2E_HEADED,
        args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
      });
      console.log("  browser:  Microsoft Edge (" + edgePath + ")");
    } catch (err) {
      browserSkipReason = "could not launch Microsoft Edge: " + (err.message || err);
    }
  }
  if (browserSkipReason) console.log("  browser:  SKIPPED - " + browserSkipReason);

  // One real sign-in for the whole run; protected pages reuse its storage
  // state. When it fails the signed-in checks SKIP with the reason instead of
  // silently loading the sign-in page.
  if (browser) {
    const auth = await harness.ensureAuth(browser);
    if (auth.ok) {
      console.log("  auth:     signed in as " + harness.TEST_ACCOUNT.email);
    } else {
      console.log("  auth:     SKIPPED signed-in checks - " + auth.error);
    }
  }

  const context = {
    ...recorder,
    baseURL: server.baseURL,
    pages,
    screenshotDir,
    testResultsDir,
    browser,
    http: (relativePath) => fetch(new URL(relativePath, server.baseURL)),
  };

  // ---------- specs ----------
  let specs = SPECS;
  if (args.screenshotsOnly) specs = SPECS.filter((spec) => spec.name === "screenshots");
  else if (args.only) specs = SPECS.filter((spec) => spec.name === args.only);

  const specSummary = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    currentSpec = spec.name;
    const before = results.length;
    const specStarted = Date.now();
    try {
      if (spec.requiresBrowser && !browser) {
        recorder.skip("(all checks)", browserSkipReason);
      } else {
        await spec.run(context);
      }
    } catch (err) {
      recorder.fail("(spec crashed)", (err && err.stack) || String(err));
    }
    const added = results.slice(before);
    const counts = { pass: 0, fail: 0, warn: 0, pending: 0, skip: 0 };
    for (const item of added) counts[item.status] = (counts[item.status] || 0) + 1;
    specSummary.push({ spec: spec.name, durationMs: Date.now() - specStarted, counts });
    console.log(
      "  [" +
        (i + 1) +
        "/" +
        specs.length +
        "] " +
        spec.name +
        ": " +
        counts.pass +
        " pass, " +
        counts.fail +
        " fail, " +
        counts.warn +
        " warn, " +
        counts.pending +
        " pending, " +
        counts.skip +
        " skip"
    );
  }

  // ---------- report ----------
  const summary = { pass: 0, fail: 0, warn: 0, pending: 0, skip: 0, total: results.length };
  for (const item of results) summary[item.status] = (summary[item.status] || 0) + 1;
  summary.durationMs = Date.now() - startedAt;

  printReport(results, summary);

  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: summary.durationMs,
    baseURL: server.baseURL,
    browser: browser ? { engine: "msedge", executablePath: edgePath, headless: !process.env.WETALK_E2E_HEADED } : { skipped: browserSkipReason },
    auth: harness.authStatus(),
    pages,
    screenshots: screenshotDir,
    specSummary,
    summary,
    results,
  };
  const reportPath = path.join(testResultsDir, "e2e-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("Report:    " + reportPath);
  if (fs.existsSync(screenshotDir)) console.log("Screenshots: " + screenshotDir);

  if (browser) await browser.close();
  await server.close();
  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("E2E harness failed:", (err && err.stack) || err);
  process.exit(1);
});
