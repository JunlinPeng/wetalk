/* ============================================================
   E2E spec: accessibility smoke checks

   Structural WCAG basics per page: language, title, viewport,
   headings, image alt text, accessible names on form controls,
   buttons and links, duplicate ids. Also verifies the Preview
   mode banner once js/auth.js is ready to inject it.
   ============================================================ */
"use strict";

const { newContext, pageUrl, pageModes, siteSource, ensureAuth } = require("../lib/harness");

async function collectIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const add = (severity, message) => issues.push({ severity, message });
    const describe = (el) => {
      if (!el) return "(missing)";
      const parts = [el.tagName.toLowerCase()];
      if (el.id) parts.push("#" + el.id);
      const cls = String(el.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) parts.push("." + cls.join("."));
      return parts.join("");
    };
    const nameOf = (el) => {
      const aria = (el.getAttribute("aria-label") || "").trim();
      if (aria) return aria;
      const labelledby = el.getAttribute("aria-labelledby");
      if (labelledby) {
        const target = document.getElementById(labelledby);
        if (target && (target.textContent || "").trim()) return target.textContent.trim();
      }
      if (el.labels && el.labels.length) {
        const text = Array.from(el.labels).map((label) => label.textContent || "").join(" ").trim();
        if (text) return text;
      }
      const title = (el.getAttribute("title") || "").trim();
      if (title) return title;
      if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text;
      if (el.tagName === "INPUT" && (el.type === "submit" || el.type === "button")) return el.value || "";
      return "";
    };

    if (!document.documentElement.getAttribute("lang")) add("error", "html element has no lang attribute");
    if (!(document.title || "").trim()) add("error", "document has no <title>");
    if (!document.querySelector('meta[name="viewport"]')) add("error", "no viewport meta tag");

    const h1s = document.querySelectorAll("h1");
    if (h1s.length === 0) add("warning", "page has no h1 heading");
    else if (h1s.length > 1) add("warning", h1s.length + " h1 headings (expected 1)");

    document.querySelectorAll("img").forEach((img, index) => {
      if (!img.hasAttribute("alt")) {
        add("error", "img #" + index + " (" + (img.getAttribute("src") || "no src") + ") has no alt attribute");
      }
    });

    document.querySelectorAll("input, select, textarea").forEach((el) => {
      const type = String(el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
      if (nameOf(el)) return;
      const placeholder = (el.getAttribute("placeholder") || "").trim();
      if (placeholder) add("warning", "form control " + describe(el) + " is labeled by placeholder only");
      else add("error", "form control " + describe(el) + " has no accessible name");
    });

    document.querySelectorAll("button").forEach((el) => {
      if (!nameOf(el)) add("error", "button " + describe(el) + " has no accessible name");
    });
    document.querySelectorAll('a[href]').forEach((el) => {
      if (!nameOf(el)) add("warning", "link " + describe(el) + " has no accessible name");
    });

    const ids = new Map();
    document.querySelectorAll("[id]").forEach((el) => ids.set(el.id, (ids.get(el.id) || 0) + 1));
    for (const [id, count] of ids) {
      if (count > 1) add("warning", "duplicate id '" + id + "' (" + count + "x)");
    }

    const controls = document.querySelectorAll("button, a[href], input, select, textarea").length;
    return { issues, controls };
  });
}

function summarize(issues) {
  return issues
    .slice(0, 12)
    .map((issue) => issue.severity + ": " + issue.message)
    .join(" | ");
}

module.exports = {
  name: "a11y",
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
        const context = await newContext(ctx.browser, { signedIn: pageMode.signedIn });
        const page = await context.newPage();
        try {
          await page.goto(pageUrl(ctx.baseURL, pageName), { waitUntil: "load" });
          await page.waitForTimeout(200);
          const { issues, controls } = await collectIssues(page);
          const errors = issues.filter((issue) => issue.severity === "error");
          const warnings = issues.filter((issue) => issue.severity === "warning");
          if (errors.length) {
            ctx.fail(label + " accessibility", errors.length + " error(s): " + summarize(errors));
          } else if (warnings.length) {
            ctx.warn(label + " accessibility", warnings.length + " warning(s): " + summarize(warnings));
          } else {
            ctx.pass(label + " accessibility", controls + " controls checked");
          }
        } catch (err) {
          ctx.fail(label + " accessibility", "could not evaluate: " + (err.message || err));
        } finally {
          await context.close();
        }
      }
    }

    // ---- Preview mode banner (js/auth.js contract) ----
    // With a real Supabase project in js/config.js the site is NOT preview mode,
    // so the banner must be absent. The banner is still verified when a build
    // ships an empty config (Preview mode).
    const authSource = siteSource("js/auth.js");
    const bannerImplemented = /preview-banner/.test(authSource);
    const context = await newContext(ctx.browser, { signedIn: false });
    const page = await context.newPage();
    try {
      await page.goto(pageUrl(ctx.baseURL, "signin.html"), { waitUntil: "load" });
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => {
        const el = document.querySelector(".preview-banner");
        const auth = window.WetalkAuth;
        const rect = el ? el.getBoundingClientRect() : null;
        return {
          preview: auth && typeof auth.isPreviewMode === "function" ? !!auth.isPreviewMode() : null,
          banner: el ? { text: (el.textContent || "").trim(), visible: !!rect && rect.width > 0 && rect.height > 0 } : null,
        };
      });
      if (info.preview === true) {
        if (!info.banner) {
          ctx.fail(
            "preview-mode banner",
            bannerImplemented
              ? "Preview mode is active (empty js/config.js) but the banner is not shown"
              : "Preview mode is active but js/auth.js does not implement the banner"
          );
        } else {
          if (/preview mode/i.test(info.banner.text)) ctx.pass("preview-mode banner shown", info.banner.text.slice(0, 120));
          else ctx.warn("preview-mode banner text", "expected 'Preview mode...', got: " + info.banner.text.slice(0, 120));
          if (!info.banner.visible) ctx.warn("preview-mode banner visibility", "banner is in the DOM but has zero size");
        }
      } else if (info.preview === false) {
        if (info.banner) {
          ctx.warn(
            "preview-mode banner absent",
            "banner is shown although a real Supabase project is configured (not Preview mode)"
          );
        } else {
          ctx.pass("preview-mode banner absent (real Supabase project configured)");
        }
      } else {
        ctx.pending("preview-mode banner", "WetalkAuth.isPreviewMode() is not available on signin.html");
      }
    } catch (err) {
      ctx.fail("preview-mode banner", "could not check: " + (err.message || err));
    } finally {
      await context.close();
    }
  },
};
