/* ============================================================
   E2E spec: static HTTP checks (no browser needed)

   - every HTML page is served with HTTP 200
   - every local asset referenced by a page resolves (200)
   - basic HTML document hygiene (doctype, charset, lang, title)
   - deployment prerequisites (.nojekyll)
   - no service-role secrets in shipped scripts (heuristic)

   This spec also acts as the dependency-free fallback: it runs
   even when Edge/playwright cannot be launched.
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, pendingReason } = require("../lib/harness");

const REF_RE = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const LOCAL_PREFIX_RE = /^(?:https?:|\/\/|mailto:|tel:|javascript:|data:|#)/i;

function localReferences(html) {
  const refs = new Set();
  let match;
  REF_RE.lastIndex = 0;
  while ((match = REF_RE.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw || LOCAL_PREFIX_RE.test(raw)) continue;
    const clean = raw.split("#")[0].split("?")[0].trim();
    if (!clean) continue;
    refs.add(clean);
  }
  return Array.from(refs);
}

function resolveReference(pageName, ref) {
  try {
    const url = new URL(ref, "http://wetalk.local/" + pageName);
    return decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch (err) {
    return null;
  }
}

module.exports = {
  name: "http",
  requiresBrowser: false,
  run: async (ctx) => {
    // ---- every page returns 200 ----
    for (const pageName of ctx.pages) {
      let response;
      try {
        response = await ctx.http(pageName);
      } catch (err) {
        ctx.fail(pageName + " responds", "request failed: " + err.message);
        continue;
      }
      if (response.status === 200) ctx.pass(pageName + " responds 200");
      else ctx.fail(pageName + " responds", "expected 200, got " + response.status);
    }

    // ---- root document is served too ----
    const rootResponse = await ctx.http("");
    if (rootResponse.status === 200) ctx.pass("site root serves index.html");
    else ctx.fail("site root serves index.html", "expected 200, got " + rootResponse.status);

    // ---- references resolve ----
    const checked = new Map();
    for (const pageName of ctx.pages) {
      const html = await (await ctx.http(pageName)).text();
      for (const ref of localReferences(html)) {
        const resolved = resolveReference(pageName, ref);
        if (!resolved || checked.has(resolved)) continue;
        checked.set(resolved, pageName);
        try {
          const response = await ctx.http(resolved);
          if (response.status === 200) continue;
          const pending = pendingReason(resolved);
          if (pending) {
            ctx.pending(
              "reference " + resolved,
              "missing while the " + pending + " is in progress (linked from " + pageName + ")"
            );
          } else {
            ctx.fail("reference " + resolved, "HTTP " + response.status + " (linked from " + pageName + ")");
          }
        } catch (err) {
          ctx.fail("reference " + resolved, "request failed: " + err.message);
        }
      }
    }
    if (checked.size) ctx.pass("local references resolve", checked.size + " unique files checked");

    // ---- document hygiene ----
    for (const pageName of ctx.pages) {
      const html = await (await ctx.http(pageName)).text();
      const problems = [];
      if (!/^<!doctype html>/i.test(html.trim())) problems.push("missing <!doctype html>");
      if (!/<html[^>]*\blang=/i.test(html)) problems.push("missing <html lang>");
      if (!/<meta[^>]*charset=/i.test(html)) problems.push("missing charset meta");
      if (!/<title>[^<]+<\/title>/i.test(html)) problems.push("missing <title>");
      if (!/<meta[^>]*name=["']viewport["']/i.test(html)) problems.push("missing viewport meta");
      if (problems.length) ctx.fail(pageName + " document shell", problems.join("; "));
      else ctx.pass(pageName + " document shell");
    }

    // ---- deploy prerequisites ----
    if (fs.existsSync(path.join(REPO_ROOT, ".nojekyll"))) ctx.pass(".nojekyll present (GitHub Pages serves files verbatim)");
    else ctx.fail(".nojekyll present", "GitHub Pages will run Jekyll without .nojekyll");

    // ---- secret hygiene (heuristic) ----
    const scriptDir = path.join(REPO_ROOT, "js");
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "vendor") continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".js")) continue;
        const source = fs.readFileSync(full, "utf8");
        if (/service_role/i.test(source)) offenders.push(path.relative(REPO_ROOT, full) + " mentions service_role");
        if (/\bsk-[A-Za-z0-9]{20,}/.test(source)) offenders.push(path.relative(REPO_ROOT, full) + " contains an API-looking key");
      }
    };
    walk(scriptDir);
    if (offenders.length) ctx.fail("shipped js contains no secrets", offenders.join("; "));
    else ctx.pass("shipped js contains no secrets (heuristic)");
  },
};
