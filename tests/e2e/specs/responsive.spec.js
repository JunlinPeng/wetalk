/* ============================================================
   E2E spec: responsive layout

   Mobile (390x844, iPhone-class) must render without horizontal
   scrolling. Desktop (1440x900) is checked too but only warns, to
   avoid blocking on optional wide layouts.
   ============================================================ */
"use strict";

const { newContext, pageUrl, pageModes, ensureAuth, MOBILE_VIEWPORT, DESKTOP_VIEWPORT } = require("../lib/harness");

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const innerWidth = window.innerWidth;
    const overflow = doc.scrollWidth - innerWidth;
    const offenders = [];
    if (overflow > 2) {
      for (const el of document.querySelectorAll("body *")) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.right > innerWidth + 2) {
          offenders.push({
            element: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
              (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""),
            right: Math.round(rect.right),
          });
        }
      }
      offenders.sort((a, b) => b.right - a.right);
    }
    return {
      innerWidth,
      scrollWidth: doc.scrollWidth,
      overflow,
      hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
      offenders: offenders.slice(0, 6),
    };
  });
}

module.exports = {
  name: "responsive",
  requiresBrowser: true,
  run: async (ctx) => {
    const needsAuth = ctx.pages.some((pageName) => pageModes(pageName).some((pageMode) => pageMode.signedIn));
    const auth = needsAuth ? await ensureAuth(ctx.browser) : { ok: false, error: "" };
    for (const pageName of ctx.pages) {
      for (const pageMode of pageModes(pageName)) {
        const label = pageName + " [" + pageMode.mode + "]";
        if (pageMode.signedIn && !auth.ok) {
          ctx.skip(label, "live QA sign-in unavailable: " + auth.error);
          continue;
        }
        // ---- mobile ----
        const mobileContext = await newContext(ctx.browser, { signedIn: pageMode.signedIn, viewport: MOBILE_VIEWPORT });
        const mobilePage = await mobileContext.newPage();
        try {
          await mobilePage.goto(pageUrl(ctx.baseURL, pageName), { waitUntil: "load" });
          await mobilePage.waitForTimeout(250);
          const metrics = await measure(mobilePage);
          if (!metrics.hasViewportMeta) {
            ctx.fail(label + " mobile", "no viewport meta - the page will not scale on phones");
          } else if (metrics.overflow > 2) {
            ctx.fail(
              label + " mobile 390x844",
              "horizontal scroll: content " + metrics.scrollWidth + "px wide in " + metrics.innerWidth + "px viewport; widest: " +
                metrics.offenders.map((o) => o.element + " right=" + o.right).join(", ")
            );
          } else {
            ctx.pass(label + " mobile 390x844");
          }
        } catch (err) {
          ctx.fail(label + " mobile", "could not measure: " + (err.message || err));
        } finally {
          await mobileContext.close();
        }

        // ---- desktop (warn only) ----
        const desktopContext = await newContext(ctx.browser, { signedIn: pageMode.signedIn, viewport: DESKTOP_VIEWPORT });
        const desktopPage = await desktopContext.newPage();
        try {
          await desktopPage.goto(pageUrl(ctx.baseURL, pageName), { waitUntil: "load" });
          await desktopPage.waitForTimeout(200);
          const metrics = await measure(desktopPage);
          if (metrics.overflow > 2) {
            ctx.warn(
              label + " desktop 1440x900",
              "horizontal scroll: " + metrics.overflow + "px of overflow; widest: " +
                metrics.offenders.map((o) => o.element + " right=" + o.right).join(", ")
            );
          } else {
            ctx.pass(label + " desktop 1440x900");
          }
        } catch (err) {
          ctx.warn(label + " desktop", "could not measure: " + (err.message || err));
        } finally {
          await desktopContext.close();
        }
      }
    }
  },
};
