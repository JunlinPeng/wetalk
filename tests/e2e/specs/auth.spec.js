/* ============================================================
   E2E spec: auth flow in a real browser (Preview mode)

   Covers the visitor journey the site must never break:
     1. protected page redirects signed-out visitors to signin
     2. signup -> works page, session created in localStorage
     3. sign out -> session cleared, public page
     4. sign in again -> works page, session restored

   Selectors are intentionally adaptive: the auth workstream is
   redesigning signup.html / signin.html, so fields are located by
   label, name, placeholder, type and autocomplete rather than by
   brittle ids, and step wizards are walked by clicking "Next".
   Failures include a UI snapshot to make debugging fast.
   ============================================================ */
"use strict";

const {
  newContext,
  pageUrl,
  pageModes,
  attachDiagnostics,
  pendingReferenceReason,
  snapshotUi,
  screenshot,
  waitForUrl,
  findAction,
} = require("../lib/harness");

const PASSWORD = "wetalk-qa-pass-123";
const EMAIL = "qa.e2e.preview@example.com";
const USERNAME = "qae2euser";

async function visibleInputAttrs(page) {
  const locators = await page.locator("input:visible").all();
  const list = [];
  for (const locator of locators) {
    try {
      list.push({ locator, attrs: await locator.evaluate((el) => ({
        id: el.id || "",
        name: el.name || "",
        type: (el.type || "").toLowerCase(),
        placeholder: el.placeholder || "",
        autocomplete: el.autocomplete || "",
        value: el.value || "",
      })) });
    } catch (err) {
      /* element disappeared - ignore */
    }
  }
  return list;
}

function identifierPredicate(attrs) {
  if (attrs.type === "password") return false;
  if (attrs.type === "email" || attrs.type === "tel") return true;
  return /identifier|email|phone|login|account/i.test(
    attrs.id + " " + attrs.name + " " + attrs.placeholder + " " + attrs.autocomplete
  );
}

function usernamePredicate(attrs) {
  if (attrs.type === "password") return false;
  return /username|display.?name|nickname|handle/i.test(attrs.id + " " + attrs.name + " " + attrs.placeholder);
}

async function fillFirst(page, predicate, value) {
  const inputs = await visibleInputAttrs(page);
  const match = inputs.find((input) => predicate(input.attrs));
  if (!match) return false;
  await match.locator.fill(value);
  return true;
}

async function findPassword(page) {
  const inputs = await visibleInputAttrs(page);
  return inputs.find((input) => input.attrs.type === "password") || null;
}

async function clickNext(page) {
  const action = await findAction(page, /^(next|continue|next step|proceed)$/i);
  if (!action) return false;
  await action.click();
  await page.waitForTimeout(250);
  return true;
}

async function submitSignup(page) {
  let action = await findAction(page, /create account|create your account|sign up|signup|create/i);
  if (!action) action = await findAction(page, /^(next|continue|finish|done)$/i);
  if (action) {
    await action.click();
    return true;
  }
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if (await submit.count()) {
    await submit.click();
    return true;
  }
  return false;
}

async function signup(page, baseURL) {
  await page.goto(pageUrl(baseURL, "signup.html"), { waitUntil: "load" });
  await page.waitForTimeout(300);
  await screenshot(page, "auth-01-signup");

  // Fill the identifier (email) if the first step exposes it.
  const filledIdentifier = await fillFirst(page, identifierPredicate, EMAIL);
  if (!filledIdentifier) {
    // Some designs show a single form: fall back to the first visible text input.
    const inputs = await visibleInputAttrs(page);
    const textInput = inputs.find((input) => ["text", "email", "tel"].includes(input.attrs.type));
    if (!textInput) throw new Error("no identifier input on signup.html");
    await textInput.locator.fill(EMAIL);
  }

  // Walk any step wizard until the password field appears.
  for (let step = 0; step < 5; step++) {
    if (await findPassword(page)) break;
    const usernameInput = (await visibleInputAttrs(page)).find((input) => usernamePredicate(input.attrs));
    if (usernameInput && !usernameInput.attrs.value) await usernameInput.locator.fill(USERNAME);
    if (!(await clickNext(page))) break;
  }

  // Fill the username if it is still empty and visible (single-form designs).
  const usernameInput = (await visibleInputAttrs(page)).find((input) => usernamePredicate(input.attrs));
  if (usernameInput && !usernameInput.attrs.value) await usernameInput.locator.fill(USERNAME);

  const passwordInput = await findPassword(page);
  if (!passwordInput) {
    throw new Error("password input never became visible; UI: " + JSON.stringify(await snapshotUi(page)));
  }
  await passwordInput.locator.fill(PASSWORD);
  await screenshot(page, "auth-02-signup-filled");

  if (!(await submitSignup(page))) throw new Error("no signup submit button found");

  await waitForUrl(page, [/works\.html/, /app\.html/], 20000);
  const session = await page.evaluate(() => {
    try { return localStorage.getItem("wetalk.session"); } catch (err) { return null; }
  });
  if (!session) throw new Error("signup navigated but localStorage[wetalk.session] is empty");
  return { session: JSON.parse(session), finalUrl: page.url() };
}

async function signOut(page) {
  const action = await findAction(page, /sign out|signout|log out|logout/i);
  if (!action) throw new Error("no sign-out control found; UI: " + JSON.stringify(await snapshotUi(page)));
  await action.click();
  await page.waitForTimeout(600);
  await waitForUrl(page, [/index\.html/, /signin\.html/, /\/$/], 15000);
  const session = await page.evaluate(() => {
    try { return localStorage.getItem("wetalk.session"); } catch (err) { return null; }
  });
  return session;
}

async function signIn(page, baseURL) {
  await page.goto(pageUrl(baseURL, "signin.html"), { waitUntil: "load" });
  await page.waitForTimeout(300);
  await screenshot(page, "auth-04-signin");

  let filled = await fillFirst(page, identifierPredicate, EMAIL);
  if (!filled) {
    const inputs = await visibleInputAttrs(page);
    const textInput = inputs.find((input) => ["text", "email", "tel"].includes(input.attrs.type));
    if (!textInput) throw new Error("no identifier input on signin.html");
    await textInput.locator.fill(EMAIL);
  }
  const passwordInput = await findPassword(page);
  if (!passwordInput) throw new Error("no password input on signin.html");
  await passwordInput.locator.fill(PASSWORD);

  const action = await findAction(page, /sign in|signin|log in|login/i);
  if (!action) throw new Error("no sign-in submit button found; UI: " + JSON.stringify(await snapshotUi(page)));
  await action.click();

  await waitForUrl(page, [/works\.html/, /app\.html/], 20000);
  const session = await page.evaluate(() => {
    try { return localStorage.getItem("wetalk.session"); } catch (err) { return null; }
  });
  if (!session) throw new Error("signin navigated but localStorage[wetalk.session] is empty");
  return { session: JSON.parse(session), finalUrl: page.url() };
}

module.exports = {
  name: "auth",
  requiresBrowser: true,
  run: async (ctx) => {
    // ---- 1. signed-out visitor is redirected away from protected pages ----
    {
      const context = await newContext(ctx.browser, { signedIn: false });
      const page = await context.newPage();
      try {
        await page.goto(pageUrl(ctx.baseURL, "app.html"), { waitUntil: "load" });
        await waitForUrl(page, [/signin\.html/], 15000);
        ctx.pass("protected page redirects signed-out visitor to signin.html");
      } catch (err) {
        ctx.fail(
          "protected page redirects signed-out visitor to signin.html",
          (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page))
        );
      } finally {
        await context.close();
      }
    }

    // ---- 2-4. signup / signout / signin journey ----
    const context = await newContext(ctx.browser, { signedIn: false });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    let signedUp = false;
    let signedOut = false;

    try {
      try {
        const result = await signup(page, ctx.baseURL);
        signedUp = true;
        const file = await screenshot(page, "auth-03-after-signup");
        ctx.pass(
          "preview signup -> works page",
          "session user=" + (result.session.username || "?") + " screenshot=" + file
        );
      } catch (err) {
        ctx.fail(
          "preview signup -> works page",
          (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page))
        );
      }

      if (signedUp) {
        try {
          const session = await signOut(page);
          if (session) ctx.fail("sign out clears the session", "wetalk.session still present after sign out");
          else {
            signedOut = true;
            ctx.pass("sign out clears the session", "landed on " + page.url());
          }
        } catch (err) {
          ctx.fail("sign out clears the session", err.message || String(err));
        }
      } else {
        ctx.skip("sign out clears the session", "signup failed");
      }

      if (signedOut) {
        try {
          const result = await signIn(page, ctx.baseURL);
          await screenshot(page, "auth-05-after-signin");
          ctx.pass("sign in after sign out restores the session", "landed on " + result.finalUrl);
        } catch (err) {
          ctx.fail("sign in after sign out restores the session", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
        }
      } else {
        ctx.skip("sign in after sign out restores the session", "sign up or sign out failed");
      }

      // ---- console cleanliness across the whole journey ----
      // Requests for files/endpoints another workstream is still landing are
      // reported as PENDING instead of failing the journey.
      const problems = [];
      const pendingNotes = new Set();
      for (const error of diagnostics.consoleErrors) {
        const reason = error.url ? pendingReferenceReason(error.url) : null;
        if (reason) pendingNotes.add("/" + error.url + " 404s (" + reason + ")");
        else problems.push("console.error: " + error.text + (error.url ? " @/" + error.url : ""));
      }
      if (diagnostics.pageErrors.length) problems.push("pageerror: " + diagnostics.pageErrors.join(" | "));
      if (problems.length) {
        ctx.fail("auth flow has no console errors", problems.join("; "));
      } else if (pendingNotes.size) {
        ctx.pending("auth flow has no console errors", "clean except: " + Array.from(pendingNotes).join(", "));
      } else {
        ctx.pass("auth flow has no console errors");
      }
      if (diagnostics.browserNoise.length) {
        ctx.warn("auth flow browser transition noise", "ignored (Edge view-transition quirk): " + diagnostics.browserNoise.join(" | "));
      }
    } finally {
      await context.close();
    }
  },
};
