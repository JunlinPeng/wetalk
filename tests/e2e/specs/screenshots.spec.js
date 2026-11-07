/* ============================================================
   E2E spec: screenshots for visual review

   Captures every page (desktop 1440x900 and mobile 390x844) into
   test-results/screenshots/. Protected pages are captured with a
   seeded preview session so the real UI is visible; public pages
   are captured signed-out.

   This spec never fails on visual judgement - artefacts are for
   human review (the Lead / frontend workstream). It only fails if
   a screenshot cannot be captured.
   ============================================================ */
"use strict";

const path = require("node:path");
const {
  newContext,
  pageUrl,
  pageModes,
  pageSafeName,
  screenshot,
  ensureAuth,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} = require("../lib/harness");

module.exports = {
  name: "screenshots",
  requiresBrowser: true,
  run: async (ctx) => {
    const viewports = [
      { name: "desktop", viewport: DESKTOP_VIEWPORT },
      { name: "mobile", viewport: MOBILE_VIEWPORT },
    ];
    let captured = 0;
    const needsAuth = ctx.pages.some((pageName) => pageModes(pageName).some((pageMode) => pageMode.signedIn));
    const auth = needsAuth ? await ensureAuth(ctx.browser) : { ok: false, error: "" };

    for (const pageName of ctx.pages) {
      for (const pageMode of pageModes(pageName)) {
        for (const viewport of viewports) {
          const label = pageName + " [" + pageMode.mode + "] " + viewport.name;
          if (pageMode.signedIn && !auth.ok) {
            ctx.skip(label, "live QA sign-in unavailable: " + auth.error);
            continue;
          }
          const context = await newContext(ctx.browser, {
            signedIn: pageMode.signedIn,
            viewport: viewport.viewport,
          });
          const page = await context.newPage();
          try {
            await page.goto(pageUrl(ctx.baseURL, pageName), { waitUntil: "load" });
            await page.evaluate(() => {
              // Full-page captures never scroll, so scroll-reveal elements would
              // otherwise be captured invisible (large blank areas).
              document.documentElement.classList.remove("motion-ok");
              document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-in"));
            });
            await page.waitForTimeout(300);
            const file = await screenshot(
              page,
              pageSafeName(pageName) + "-" + pageMode.mode + "-" + viewport.name
            );
            captured++;
            ctx.pass(label, path.relative(ctx.testResultsDir, file));
          } catch (err) {
            ctx.fail(label, "screenshot failed: " + (err.message || err));
          } finally {
            await context.close();
          }
        }
      }
    }
    if (captured) ctx.pass("screenshots captured", captured + " images in test-results/screenshots/");
  },
};
