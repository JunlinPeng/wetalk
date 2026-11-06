/* ============================================================
   Wetalk QA - end-to-end harness helpers

   Shared utilities for the e2e specs: page discovery, seeded
   browser contexts, console/error capture, UI snapshots and
   screenshot paths. Browser: installed Microsoft Edge via
   playwright-core (no browser downloads).
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_RESULTS_DIR = path.join(REPO_ROOT, "test-results");
const SCREENSHOT_DIR = path.join(TEST_RESULTS_DIR, "screenshots");

const EDGE_PATH =
  process.env.WETALK_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const EDGE_CANDIDATES = [
  EDGE_PATH,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
];

// Files that other workstreams are known to be adding/removing during the
// parallel build. A missing reference to one of these is reported as
// PENDING instead of FAIL so the suite is usable while work is in flight.
// QA removes entries here once the file lands (or the page stops linking it).
const PENDING_FILES = {
  // Empty: the shared modules/assets references previously listed here have
  // landed. Add entries only while a workstream is actively landing a file.
};

// Requests that are known to 404 during in-flight work. Unlike a missing
// file these are reported as PENDING until the owning workstream lands the
// production behaviour (e.g. the static site should not probe a desktop API).
const PENDING_REQUESTS = {
  "api/config": "data workstream - legacy desktop config probe; the static site should not call /api/config",
};

const SESSION_SEED = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "QA Reviewer",
  email: "qa.reviewer@example.com",
  provider: "wetalk",
  avatar: null,
  identifier: "qa.reviewer@example.com",
};

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

function findEdgePath() {
  for (const candidate of EDGE_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureTestResults() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return { testResultsDir: TEST_RESULTS_DIR, screenshotDir: SCREENSHOT_DIR };
}

function discoverPages() {
  return fs
    .readdirSync(REPO_ROOT)
    .filter((name) => name.toLowerCase().endsWith(".html"))
    .sort();
}

function siteSource(relPath) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  } catch (err) {
    return "";
  }
}

function siteFileExists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

/** Pages that call requireAuth() should be rendered signed-in for QA. */
function isProtectedPage(pageName) {
  return /requireAuth\s*\(/.test(siteSource(pageName));
}

/** How a page should be loaded for QA: protected pages get a seeded session. */
function pageModes(pageName) {
  if (isProtectedPage(pageName)) return [{ mode: "signedin", signedIn: true }];
  return [{ mode: "signedout", signedIn: false }];
}

function pageSafeName(pageName) {
  return pageName.replace(/\.html$/i, "").replace(/[^a-z0-9_-]+/gi, "-");
}

function pendingReason(relPath) {
  return PENDING_FILES[relPath.replace(/^\/+/, "")] || null;
}

/** Pending reason for a file OR request path; null when it should pass. */
function pendingReferenceReason(relPath) {
  const clean = String(relPath || "").split("#")[0].split("?")[0].replace(/^\/+/, "");
  return PENDING_FILES[clean] || PENDING_REQUESTS[clean] || null;
}

// Browser-generated noise that is not a site bug (e.g. Edge aborting the
// cross-document @view-transition animation in headless mode).
const BROWSER_NOISE = [/ViewTransition/i, /Transition was aborted/i];
function isBrowserNoise(message) {
  return BROWSER_NOISE.some((re) => re.test(String(message || "")));
}

function hasPendingReference(list) {
  return list.filter((item) => pendingReason(item));
}

function pageUrl(baseURL, pageName) {
  return new URL(pageName, baseURL).toString();
}

/** Launch-ready context. seeded sessions let protected pages render. */
async function newContext(browser, options) {
  options = options || {};
  const context = await browser.newContext({
    viewport: options.viewport || DESKTOP_VIEWPORT,
    locale: "en-US",
    deviceScaleFactor: 1,
    // Deterministic screenshots/measurements: no reveal-fade or transition
    // timing involved. Also the accessible "reduce motion" path of the CSS.
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(options.timeout || 15000);
  context.setDefaultNavigationTimeout(options.timeout || 20000);
  if (options.signedIn) {
    const session = options.session || SESSION_SEED;
    await context.addInitScript((seed) => {
      try {
        localStorage.setItem("wetalk.session", JSON.stringify(seed));
      } catch (err) {
        /* storage may be blocked; pages still render signed-out */
      }
    }, session);
  }
  return context;
}

/**
 * Attach console / pageerror / failed-resource capture to a page.
 * Returns a diagnostics object that specs can assert against.
 */
function localPathOf(url) {
  try {
    return new URL(url).pathname.replace(/^\/+/, "");
  } catch (err) {
    return String(url || "");
  }
}

function attachDiagnostics(page, options) {
  options = options || {};
  const diagnostics = {
    consoleErrors: [], // { text, url }
    consoleWarnings: [],
    pageErrors: [],
    browserNoise: [],
    failedResources: [],
  };
  page.on("console", (message) => {
    const type = message.type();
    const text = message.text();
    if (type === "error") {
      const location = (typeof message.location === "function" && message.location()) || {};
      const url = localPathOf(location.url || "");
      if (/^favicon\.ico/.test(url)) return; // browsers probe /favicon.ico automatically
      diagnostics.consoleErrors.push({ text, url });
    } else if (type === "warning") {
      diagnostics.consoleWarnings.push(text);
    }
  });
  page.on("pageerror", (error) => {
    const message = String((error && error.message) || error);
    if (isBrowserNoise(message)) diagnostics.browserNoise.push(message);
    else diagnostics.pageErrors.push(message);
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    const type = request.resourceType();
    const url = response.url();
    if (!/^https?:\/\/127\.0\.0\.1|^https?:\/\/localhost/.test(url)) return;
    if (/favicon\.ico($|\?)/.test(url)) return;
    if (options.ignoreUrls && options.ignoreUrls.some((re) => re.test(url))) return;
    diagnostics.failedResources.push({ url, status, resourceType: type, path: localPathOf(url) });
  });
  return diagnostics;
}

function diagnosticsSummary(diagnostics) {
  const parts = [];
  if (diagnostics.pageErrors.length) parts.push("pageerror: " + diagnostics.pageErrors.join(" | "));
  if (diagnostics.consoleErrors.length) {
    parts.push(
      "console.error: " +
        diagnostics.consoleErrors
          .map((err) => err.text + (err.url ? " @" + err.url : ""))
          .join(" | ")
    );
  }
  if (diagnostics.failedResources.length) {
    parts.push(
      "failed resources: " +
        diagnostics.failedResources.map((r) => "/" + r.path + " (" + r.status + ", " + r.resourceType + ")").join(", ")
    );
  }
  return parts.join("; ");
}

/** Debug snapshot of whatever the page is showing (for failure messages). */
async function snapshotUi(page) {
  try {
    return await page.evaluate(() => {
      function text(el) {
        return String((el && el.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 60);
      }
      const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
        .filter((el) => el.offsetParent !== null || el.type === "hidden")
        .map((el) => ({
          id: el.id,
          name: el.name,
          type: el.type,
          placeholder: el.placeholder || "",
          value: el.type === "password" ? "***" : el.value,
        }));
      const buttons = Array.from(document.querySelectorAll("button, a.btn, [role=button]"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ tag: el.tagName.toLowerCase(), text: text(el), id: el.id }));
      return {
        url: location.href,
        title: document.title,
        headings: Array.from(document.querySelectorAll("h1, h2"))
          .slice(0, 5)
          .map(text),
        inputs,
        buttons,
        bodySnippet: text(document.body).slice(0, 300),
      };
    });
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

async function screenshot(page, name) {
  ensureTestResults();
  const file = path.join(SCREENSHOT_DIR, name + ".png");
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Wait until the page URL matches one of the regexes. */
async function waitForUrl(page, patterns, timeout) {
  const deadline = Date.now() + (timeout || 20000);
  while (Date.now() < deadline) {
    const current = page.url();
    if (patterns.some((re) => re.test(current))) return current;
    await page.waitForTimeout(150);
  }
  throw new Error(
    "timed out waiting for URL " + patterns.map(String).join(" or ") + " - still at " + page.url()
  );
}

/** Find the first visible element matching one of the selectors. */
async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible()) return locator;
    } catch (err) {
      /* selector not present - try the next one */
    }
  }
  return null;
}

/** Find a visible button/link by accessible name regex. */
async function findAction(page, nameRegex, tags) {
  const selectors = (tags || ["button", "a"]).map((tag) => tag + ":visible");
  const candidates = [];
  for (const selector of selectors) {
    const all = await page.locator(selector).all();
    for (const handle of all) {
      let text = "";
      try {
        text = (await handle.innerText()).replace(/\s+/g, " ").trim();
      } catch (err) {
        text = "";
      }
      if (nameRegex.test(text)) candidates.push({ handle, text });
    }
  }
  for (const candidate of candidates) {
    if (await candidate.handle.isVisible().catch(() => false)) return candidate.handle;
  }
  return null;
}

module.exports = {
  REPO_ROOT,
  TEST_RESULTS_DIR,
  SCREENSHOT_DIR,
  EDGE_PATH,
  EDGE_CANDIDATES,
  PENDING_FILES,
  SESSION_SEED,
  MOBILE_VIEWPORT,
  DESKTOP_VIEWPORT,
  findEdgePath,
  ensureTestResults,
  discoverPages,
  siteSource,
  siteFileExists,
  isProtectedPage,
  pageModes,
  pageSafeName,
  pendingReason,
  pendingReferenceReason,
  isBrowserNoise,
  localPathOf,
  pageUrl,
  newContext,
  attachDiagnostics,
  diagnosticsSummary,
  snapshotUi,
  screenshot,
  waitForUrl,
  firstVisible,
  findAction,
};
