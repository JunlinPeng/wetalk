/* ============================================================
   E2E spec: auth flow against the live Supabase project

   Covers the visitor journey the migration must keep working:
     1. a protected page redirects signed-out visitors to
        signin.html?next=<page> (now app.html is the protected app)
     2. signup.html validates the form locally before any request
     3. a successful signup redirects to app.html (the signup call is
        stubbed so the suite never creates real accounts on the live
        Supabase project)
     4. signing in with the shared QA account lands on app.html and
        caches the session
     5. an already-signed-in visitor on signin.html / signup.html is
        auto-forwarded to app.html
     6. sign out returns to index.html and clears the session

   Preview mode no longer exists in production (js/config.js points at
   the real project), so there is no preview-account signup here; the
   Preview-mode fallback is covered by the unit tests with a stub
   config.
   ============================================================ */
"use strict";

const {
  newContext,
  pageUrl,
  attachDiagnostics,
  pendingReferenceReason,
  isBrowserNoise,
  snapshotUi,
  screenshot,
  waitForUrl,
  signInThroughUi,
  signedInAvailable,
  AUTH_SKIP_REASON,
  configure,
} = require("../lib/harness");

const SIGNUP_EMAIL = "qa.e2e.signup@example.com"; // never created: /auth/v1/signup is stubbed
const SIGNUP_USERNAME = "qae2esignup";
const SIGNUP_PASSWORD = "wetalk-qa-pass-123";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Run one check; failures carry the visible UI snapshot for fast debugging. */
async function check(ctx, page, name, fn) {
  try {
    const detail = await fn();
    ctx.pass(name, typeof detail === "string" ? detail : undefined);
    return true;
  } catch (err) {
    let ui = "";
    try {
      ui = JSON.stringify(await snapshotUi(page));
    } catch (e) {
      ui = "(page unavailable)";
    }
    ctx.fail(name, (err && err.message ? err.message : String(err)) + " | UI: " + ui);
    return false;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

/**
 * Signup happy path without touching the live project: GoTrue's response is
 * transformed by supabase-js from the top-level access_token/refresh_token, so
 * the stub returns a flat session payload. Profiles is stubbed too so the
 * fake token never reaches the real REST endpoint.
 */
async function stubSignup(page) {
  const fakeUser = {
    id: "qa-stub-user", // not a UUID -> cloud sync stays disabled for the stub
    email: SIGNUP_EMAIL,
    user_metadata: { username: SIGNUP_USERNAME },
    app_metadata: { provider: "email" },
    identities: [{}],
  };
  await page.route("**/rest/v1/rpc/username_available", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, contentType: "application/json", headers: CORS_HEADERS, body: "true" })
  );
  await page.route("**/auth/v1/signup*", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: CORS_HEADERS,
          body: JSON.stringify({
            access_token: "qa-stub-access-token",
            refresh_token: "qa-stub-refresh-token",
            token_type: "bearer",
            expires_in: 3600,
            user: fakeUser,
          }),
        })
  );
  await page.route("**/rest/v1/profiles*", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, contentType: "application/json", headers: CORS_HEADERS, body: "[]" })
  );
}

async function readSession(page) {
  return page.evaluate(() => {
    try {
      return localStorage.getItem("wetalk.session");
    } catch (err) {
      return null;
    }
  });
}

module.exports = {
  name: "auth",
  requiresBrowser: true,
  run: async (ctx) => {
    // ---- 1. signed-out visitor is redirected away from the protected app ----
    {
      const context = await newContext(ctx.browser, { signedIn: false });
      const page = await context.newPage();
      await check(ctx, page, "auth: signed-out app.html redirects to signin.html?next=app.html", async () => {
        try {
          await page.goto(pageUrl(ctx.baseURL, "app.html"), { waitUntil: "load" });
          await waitForUrl(page, [/signin\.html/], 15000);
          const target = new URL(page.url());
          const next = target.searchParams.get("next");
          assert(next === "app.html", "expected ?next=app.html, got " + JSON.stringify(next));
          assert(await page.isVisible("#signinBtn"), "signin form did not render");
          return page.url();
        } finally {
          await context.close();
        }
      });
    }

    // ---- 2. signup form validation happens before any network call ----
    {
      const context = await newContext(ctx.browser, { signedIn: false });
      const page = await context.newPage();
      await check(ctx, page, "auth: signup form validates empty input locally", async () => {
        try {
          await page.goto(pageUrl(ctx.baseURL, "signup.html"), { waitUntil: "load" });
          await page.click("#createBtn");
          await page.waitForTimeout(300);
          const hints = await page.evaluate(() => ({
            email: (document.getElementById("emailHint") || {}).textContent || "",
            username: (document.getElementById("usernameHint") || {}).textContent || "",
            password: (document.getElementById("passwordHint") || {}).textContent || "",
            url: location.href,
          }));
          assert(/email/i.test(hints.email), "email hint not shown: " + JSON.stringify(hints.email));
          assert(/username/i.test(hints.username), "username hint not shown: " + JSON.stringify(hints.username));
          assert(/password/i.test(hints.password), "password hint not shown: " + JSON.stringify(hints.password));
          assert(/\.html$/.test(hints.url) && /signup\.html$/.test(hints.url), "form navigated away: " + hints.url);
          await screenshot(page, "auth-01-signup-validation");
          return "field-level hints shown, no navigation";
        } finally {
          await context.close();
        }
      });
    }

    // ---- 3. successful signup redirects to app.html (stubbed, no live account) ----
    {
      const context = await newContext(ctx.browser, { signedIn: false });
      const page = await context.newPage();
      await stubSignup(page);
      await check(ctx, page, "auth: successful signup redirects to app.html (stubbed signup call)", async () => {
        try {
          await page.goto(pageUrl(ctx.baseURL, "signup.html"), { waitUntil: "load" });
          await page.fill("#email", SIGNUP_EMAIL);
          await page.fill("#username", SIGNUP_USERNAME);
          await page.fill("#password", SIGNUP_PASSWORD);
          await page.click("#createBtn");
          await waitForUrl(page, [/\/app\.html(\?|$)/], 25000);
          await page.waitForTimeout(1500);
          assert(/\/app\.html(\?|$)/.test(page.url()), "app.html bounced back to " + page.url());
          const session = await readSession(page);
          assert(session, "signup did not cache wetalk.session");
          await screenshot(page, "auth-02-after-signup");
          return page.url();
        } finally {
          await context.close();
        }
      });
    }

    // ---- 4-6. real sign-in -> app.html, signed-in redirects, sign out ----
    if (!signedInAvailable()) {
      ctx.skip("auth: sign in with the live QA account lands on app.html", AUTH_SKIP_REASON);
      ctx.skip("auth: already-signed-in visitors are forwarded from signin/signup to app.html", AUTH_SKIP_REASON);
      ctx.skip("auth: sign out returns to index.html and clears the session", AUTH_SKIP_REASON);
      return;
    }
    const context = await newContext(ctx.browser, { signedIn: false });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    let signedIn = false;

    try {
      signedIn = await check(ctx, page, "auth: sign in with the live QA account lands on app.html", async () => {
        const result = await signInThroughUi(page, ctx.baseURL);
        assert(result.session && result.session.id, "no session cached after sign-in");
        await page.waitForTimeout(2000); // let auth.js re-check the Supabase session
        assert(/\/app\.html(\?|$)/.test(page.url()), "bounced away from app.html to " + page.url());
        await screenshot(page, "auth-03-after-signin");
        return "session=" + (result.session.username || result.session.email);
      });

      if (signedIn) {
        await check(ctx, page, "auth: already-signed-in visitors are forwarded from signin/signup to app.html", async () => {
          const signinPage = await context.newPage();
          try {
            await signinPage.goto(pageUrl(ctx.baseURL, "signin.html"), { waitUntil: "load" });
            await waitForUrl(signinPage, [/\/app\.html(\?|$)/], 20000);
            assert(/\/app\.html(\?|$)/.test(signinPage.url()), "signin.html did not forward: " + signinPage.url());
          } finally {
            await signinPage.close();
          }
          const signupPage = await context.newPage();
          try {
            await signupPage.goto(pageUrl(ctx.baseURL, "signup.html"), { waitUntil: "load" });
            await waitForUrl(signupPage, [/\/app\.html(\?|$)/], 20000);
            assert(/\/app\.html(\?|$)/.test(signupPage.url()), "signup.html did not forward: " + signupPage.url());
          } finally {
            await signupPage.close();
          }
          // Return to the signed-in app for the sign-out step.
          await page.goto(pageUrl(ctx.baseURL, "app.html"), { waitUntil: "load" });
          await page.waitForSelector("#v2SignOut", { state: "visible", timeout: 15000 });
          return "both auth pages forwarded to app.html";
        });

        await check(ctx, page, "auth: sign out returns to index.html and clears the session", async () => {
          await page.click("#v2SignOut");
          await waitForUrl(page, [/index\.html$/, /\/$/], 20000);
          const session = await readSession(page);
          assert(session === null, "wetalk.session still present after sign out: " + JSON.stringify(session));
          await screenshot(page, "auth-04-signed-out");
          return page.url();
        });
        // The sign-out revoked the shared account's sessions; later signed-in
        // specs must sign in again instead of reusing a revoked token.
        configure({ resetAuth: true });
      } else {
        ctx.skip("auth: already-signed-in visitors are forwarded from signin/signup to app.html", "sign-in failed");
        ctx.skip("auth: sign out returns to index.html and clears the session", "sign-in failed");
      }

      // ---- 7. console cleanliness across the whole journey ----
      const problems = [];
      const ignored = [];
      for (const error of diagnostics.consoleErrors) {
        const reason = error.url ? pendingReferenceReason(error.url) : null;
        if (reason) ignored.push("/" + error.url + " (" + reason + ")");
        else problems.push("console.error: " + error.text + (error.url ? " @/" + error.url : ""));
      }
      for (const message of diagnostics.pageErrors) {
        if (isBrowserNoise(message)) continue;
        problems.push("pageerror: " + message);
      }
      if (problems.length) {
        ctx.fail("auth journey has no console errors", problems.join("; "));
      } else {
        ctx.pass("auth journey has no console errors", ignored.length ? "ignored: " + ignored.join(", ") : undefined);
      }
      if (diagnostics.browserNoise.length) {
        ctx.warn(
          "auth journey browser transition noise",
          "ignored (Edge view-transition quirk): " + diagnostics.browserNoise.slice(0, 3).join(" | ")
        );
      }
    } finally {
      await context.close();
    }
  },
};
