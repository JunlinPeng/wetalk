/* ============================================================
   E2E spec: internal link crawl

   Crawls every page reachable from the home page (plus all site
   pages discovered on disk) and verifies every same-origin link
   target answers HTTP 200. External links are counted but not
   fetched (no network dependency).
   ============================================================ */
"use strict";

const { newContext, pageUrl, pageModes, pendingReason, ensureAuth } = require("../lib/harness");

module.exports = {
  name: "links",
  requiresBrowser: true,
  run: async (ctx) => {
    const auth = await ensureAuth(ctx.browser);
    const queue = ctx.pages.slice();
    const visited = new Set();
    const targets = new Map(); // path -> { from }
    let externalCount = 0;

    while (queue.length) {
      const pageName = queue.shift();
      if (visited.has(pageName) || !pageName) continue;
      visited.add(pageName);

      const pageMode = pageModes(pageName)[0];
      if (pageMode.signedIn && !auth.ok) {
        ctx.skip(pageName + " link crawl", "live QA sign-in unavailable: " + auth.error);
        continue;
      }
      const context = await newContext(ctx.browser, { signedIn: pageMode.signedIn });
      const page = await context.newPage();
      try {
        await page.goto(pageUrl(ctx.baseURL, pageName), { waitUntil: "load" });
        await page.waitForTimeout(pageMode.signedIn ? 500 : 200);
        if (pageMode.signedIn && /\/signin\.html/.test(page.url())) {
          ctx.fail(pageName + " link crawl", "redirected to signin.html despite the signed-in context");
          continue;
        }
        const hrefs = await page.$$eval("a[href]", (anchors) =>
          anchors.map((anchor) => ({ href: anchor.getAttribute("href"), text: (anchor.textContent || "").trim().slice(0, 40) }))
        );
        for (const item of hrefs) {
          const href = item.href;
          if (!href) continue;
          if (/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
          let url;
          try {
            url = new URL(href, page.url());
          } catch (err) {
            continue;
          }
          if (url.origin !== new URL(ctx.baseURL).origin) {
            externalCount++;
            continue;
          }
          const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
          const key = relative || "";
          if (!targets.has(key)) targets.set(key, new Set());
          targets.get(key).add(pageName);
          if (/\.html$/i.test(relative) && !visited.has(relative) && !queue.includes(relative)) queue.push(relative);
        }
      } catch (err) {
        ctx.fail(pageName + " link crawl", "could not load page: " + (err.message || err));
      } finally {
        await context.close();
      }
    }

    for (const [relative, sources] of targets) {
      const label = "link target /" + (relative || "(root)");
      try {
        const response = await ctx.http(relative);
        if (response.status === 200) continue;
        const pending = pendingReason(relative);
        if (pending) ctx.pending(label, "missing while the " + pending + " is in progress (from " + Array.from(sources).join(", ") + ")");
        else ctx.fail(label, "HTTP " + response.status + " (linked from " + Array.from(sources).join(", ") + ")");
      } catch (err) {
        ctx.fail(label, "request failed: " + err.message);
      }
    }

    ctx.pass("crawled " + visited.size + " pages, checked " + targets.size + " internal link targets", "external links skipped: " + externalCount);
  },
};
