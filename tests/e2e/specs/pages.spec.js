/* ============================================================
   E2E spec: every page loads cleanly in Microsoft Edge

   For each page (protected pages are loaded with a seeded preview
   session so their real UI renders):
     - HTTP 200
     - no uncaught JS errors
     - no console.error output
     - no failed same-origin scripts / styles / images
   Files that other workstreams are still adding are reported as
   PENDING, everything else fails the suite.
   ============================================================ */
"use strict";

const {
  newContext,
  pageUrl,
  pageModes,
  attachDiagnostics,
  diagnosticsSummary,
  pendingReferenceReason,
} = require("../lib/harness");

module.exports = {
  name: "pages",
  requiresBrowser: true,
  run: async (ctx) => {
    for (const pageName of ctx.pages) {
      for (const pageMode of pageModes(pageName)) {
        const label = pageName + " [" + pageMode.mode + "]";
        const context = await newContext(ctx.browser, { signedIn: pageMode.signedIn });
        const page = await context.newPage();
        const diagnostics = attachDiagnostics(page);
        try {
          const response = await page.goto(pageUrl(ctx.baseURL, pageName), { waitUntil: "load" });
          await page.waitForTimeout(300); // let async scripts finish

          const problems = [];
          const pendingNotes = new Set();
          if (!response) problems.push("no document response");
          else if (response.status() !== 200) problems.push("HTTP " + response.status());

          for (const message of diagnostics.pageErrors) problems.push("pageerror: " + message);
          for (const error of diagnostics.consoleErrors) {
            const reason = error.url ? pendingReferenceReason(error.url) : null;
            if (reason) pendingNotes.add("/" + error.url + " 404s (" + reason + ")");
            else problems.push("console.error: " + error.text + (error.url ? " @/" + error.url : ""));
          }
          for (const failed of diagnostics.failedResources) {
            const reason = pendingReferenceReason(failed.path);
            if (reason) pendingNotes.add("/" + failed.path + " HTTP " + failed.status + " (" + reason + ")");
            else problems.push("failed resource /" + failed.path + " (HTTP " + failed.status + ", " + failed.resourceType + ")");
          }

          if (problems.length) {
            const html = await page.content().catch(() => "");
            const title = await page.title().catch(() => "");
            ctx.fail(label, problems.join("; "), { finalUrl: page.url(), title, htmlLength: html.length });
          } else if (pendingNotes.size) {
            ctx.pending(label, "loads cleanly except: " + Array.from(pendingNotes).join(", "));
          } else {
            const noise = diagnostics.browserNoise.length ? " (browser transition noise ignored)" : "";
            ctx.pass(label + noise);
          }
        } catch (err) {
          const snapshot = await (async () => {
            try {
              return await page.evaluate(() => ({ url: location.href, title: document.title }));
            } catch (e) {
              return {};
            }
          })();
          ctx.fail(label, "navigation failed: " + (err.message || err) + " " + JSON.stringify(snapshot));
        } finally {
          await context.close();
        }
      }
    }
  },
};
