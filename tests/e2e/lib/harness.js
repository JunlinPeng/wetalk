/* ============================================================
   Wetalk QA - end-to-end harness helpers

   Shared utilities for the e2e specs: page discovery, live QA
   sign-in (one real UI sign-in per run, reused through storageState),
   console/error capture, UI snapshots and screenshot paths.
   Browser: installed Microsoft Edge via playwright-core (no browser
   downloads).
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

// The live site is connected to a real Supabase project (js/config.js), so a
// seeded localStorage "wetalk.session" is no longer a valid sign-in: auth.js
// clears it on load when Supabase has no matching session. Signed-in pages are
// therefore exercised with a real UI sign-in that runs once per suite run and
// is reused through Playwright's storageState (see ensureAuth below).
//
// The account is NEVER hardcoded (this is a public repository): provide a
// disposable Supabase test account through the environment. When the variables
// are absent every signed-in check is SKIPPED with AUTH_SKIP_REASON and the
// signed-out checks still run.
const TEST_ACCOUNT = {
  email: process.env.WETALK_TEST_EMAIL || "",
  password: process.env.WETALK_TEST_PASSWORD || "",
};

const AUTH_SKIP_REASON = "set WETALK_TEST_EMAIL / WETALK_TEST_PASSWORD to run signed-in browser tests";

function signedInAvailable() {
  return !!(TEST_ACCOUNT.email && TEST_ACCOUNT.password);
}

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// Per-run runtime state: the base URL is supplied by run.js after the static
// server starts; the signed-in storage state is captured lazily on the first
// signed-in context and reused for the rest of the run.
const runtime = {
  baseURL: "",
  signedInState: null,
  authPromise: null,
  authResult: null,
};

function configure(options) {
  options = options || {};
  if (options.baseURL) runtime.baseURL = String(options.baseURL).replace(/\/+$/, "") + "/";
  if (options.resetAuth) {
    runtime.signedInState = null;
    runtime.authPromise = null;
    runtime.authResult = null;
  }
}

function signedInState() {
  return runtime.signedInState;
}

/** Let a spec share a signed-in state it captured itself (v2 spec does this). */
function rememberSignedInState(state) {
  if (state) runtime.signedInState = state;
}

function authStatus() {
  if (runtime.authResult) return { attempted: true, ok: runtime.authResult.ok, error: runtime.authResult.error || "" };
  return { attempted: false, ok: false, error: "" };
}

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

/** How a page should be loaded for QA: protected pages get the real signed-in state. */
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

/**
 * Sign in through the real signin.html UI with the shared QA account.
 * Resolves with { finalUrl, session } once app.html is reached; throws with the
 * form error hint when the site refuses the credentials.
 */
async function signInThroughUi(page, baseURL, options) {
  options = options || {};
  const account = options.account || TEST_ACCOUNT;
  const target = baseURL || runtime.baseURL;
  if (!account.email || !account.password) throw new Error(AUTH_SKIP_REASON);
  if (!target) throw new Error("harness.configure({ baseURL }) must run before signing in");
  await page.goto(pageUrl(target, "signin.html?next=app.html"), { waitUntil: "load" });
  await page.waitForSelector("#email", { state: "visible", timeout: 20000 });
  await page.fill("#email", account.email);
  await page.fill("#password", account.password);
  await page.click("#signinBtn");
  try {
    await page.waitForURL(/\/app\.html(\?|$)/, { timeout: options.timeout || 30000 });
  } catch (err) {
    const hint = await page.locator("#formHint").textContent().catch(() => "");
    throw new Error(
      "UI sign-in did not reach app.html (still at " + page.url() + ")" +
        (hint && hint.trim() ? " - form hint: " + hint.trim() : "")
    );
  }
  await page
    .waitForFunction(() => { try { return !!localStorage.getItem("wetalk.session"); } catch (e) { return false; } }, null, {
      timeout: 15000,
    })
    .catch(() => {});
  const session = await page
    .evaluate(() => { try { return JSON.parse(localStorage.getItem("wetalk.session") || "null"); } catch (e) { return null; } })
    .catch(() => null);
  return { finalUrl: page.url(), session };
}

/**
 * Perform the one real sign-in for this run and capture the browser storage
 * state (Supabase auth token + cached profile) so every later signed-in context
 * starts already signed in - without re-submitting the form or repeating the
 * network round trip.
 */
async function captureSignedInState(browser) {
  if (runtime.signedInState) return runtime.signedInState;
  if (!runtime.baseURL) throw new Error("harness.configure({ baseURL }) must run before signing in");
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    locale: "en-US",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(30000);
  const page = await context.newPage();
  try {
    await signInThroughUi(page, runtime.baseURL);
    // Let auth.js cache the profile and swap the URL hash away before capture.
    await page.waitForTimeout(600);
    runtime.signedInState = await context.storageState();
    return runtime.signedInState;
  } finally {
    await context.close();
  }
}

/**
 * Ensure the shared signed-in storage state exists. Never throws: returns
 * { ok, state?, error? } so specs can SKIP signed-in checks when the live QA
 * account (or the network) is unavailable instead of testing the sign-in page.
 */
async function ensureAuth(browser) {
  if (runtime.signedInState) return { ok: true, state: runtime.signedInState };
  if (!signedInAvailable()) return { ok: false, error: AUTH_SKIP_REASON };
  if (process.env.WETALK_E2E_SKIP_AUTH === "1") {
    return { ok: false, error: "live QA sign-in disabled (WETALK_E2E_SKIP_AUTH=1)" };
  }
  if (!browser) return { ok: false, error: "no browser available for the live QA sign-in" };
  if (!runtime.authResult) {
    runtime.authPromise = captureSignedInState(browser)
      .then((state) => { runtime.authResult = { ok: true, state: state }; })
      .catch((err) => {
        runtime.authResult = { ok: false, error: String((err && err.message) || err) };
      });
  }
  await runtime.authPromise;
  return runtime.authResult;
}

/**
 * Launch-ready context. Pass { signedIn: true } for protected pages: it reuses
 * the run's real signed-in storage state (and throws AUTH_UNAVAILABLE when the
 * live sign-in failed, which specs report as SKIP).
 */
async function newContext(browser, options) {
  options = options || {};
  const contextOptions = {
    viewport: options.viewport || DESKTOP_VIEWPORT,
    locale: "en-US",
    deviceScaleFactor: 1,
    // Deterministic screenshots/measurements: no reveal-fade or transition
    // timing involved. Also the accessible "reduce motion" path of the CSS.
    reducedMotion: "reduce",
  };
  if (options.signedIn) {
    const auth = await ensureAuth(browser);
    if (!auth.ok) {
      const err = new Error("signed-in QA context unavailable: " + auth.error);
      err.code = "AUTH_UNAVAILABLE";
      throw err;
    }
    contextOptions.storageState = auth.state;
  }
  const context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(options.timeout || 15000);
  context.setDefaultNavigationTimeout(options.timeout || 20000);
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
  TEST_ACCOUNT,
  AUTH_SKIP_REASON,
  signedInAvailable,
  MOBILE_VIEWPORT,
  DESKTOP_VIEWPORT,
  configure,
  signedInState,
  rememberSignedInState,
  authStatus,
  signInThroughUi,
  captureSignedInState,
  ensureAuth,
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
