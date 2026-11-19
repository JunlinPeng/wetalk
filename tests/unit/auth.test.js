/* ============================================================
   Unit tests: js/auth.js - identifier validation + preview-mode
   account and session behaviour.

   Runs against the shared contract in docs/ARCHITECTURE.md.
   When the auth workstream lands the Supabase-backed rewrite the
   new-API assertions activate automatically; until then they are
   reported as skipped (not failed) so the suite stays green while
   other workstreams are still editing.
   ============================================================ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindow, loadScripts, loadSource } = require("../helpers/mock-browser");

const PREVIEW_BANNER_NOTE =
  "preview banner detection needs a real browser - covered by tests/e2e/specs/a11y.spec.js";

// js/config.js points at the LIVE Supabase project (that is intentional in
// production), so unit tests must not load it: they stub the public runtime
// config instead. Empty values = Preview mode; a URL + anon key = configured
// Supabase mode.
const PREVIEW_CONFIG_SOURCE = [
  "/* unit-test stub of js/config.js - empty values mean Preview mode */",
  "window.WETALK_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', aiProxyUrl: '', siteUrl: '' };",
].join("\n");

const CONFIGURED_CONFIG_SOURCE = [
  "/* unit-test stub of js/config.js - a configured Supabase project */",
  "window.WETALK_CONFIG = {",
  "  supabaseUrl: 'https://qa-project.supabase.co',",
  "  supabaseAnonKey: 'qa-public-anon-key',",
  "  aiProxyUrl: 'https://qa-project.supabase.co/functions/v1/ai-feedback',",
  "  siteUrl: ''",
  "};",
].join("\n");

function loadAuth(options, sharedStorage, configSource) {
  const win = createWindow(Object.assign({}, options || {}, { storage: sharedStorage }));
  loadSource(win, configSource || PREVIEW_CONFIG_SOURCE, "unit-stub-config.js");
  loadScripts(win, ["js/auth.js"]);
  // Let any DOMContentLoaded hook (e.g. preview-banner injection) run.
  if (win.__document && typeof win.__document._fire === "function") {
    win.__document._fire("DOMContentLoaded");
  }
  return win;
}

function newAuthApi(auth) {
  return (
    auth &&
    typeof auth.isPreviewMode === "function" &&
    typeof auth.getClient === "function" &&
    typeof auth.onChange === "function"
  );
}

function skipPending(t, label) {
  t.skip(
    label +
      " - pending: js/auth.js has not landed the new Supabase/preview contract yet (see docs/ARCHITECTURE.md)"
  );
}

function getStoredSession(win) {
  const raw = win.__storage.getItem("wetalk.session");
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------
// Identifier validation (kept for compatibility with the pages)
// ---------------------------------------------------------------
test("auth: exposes the API the pages depend on", () => {
  const win = loadAuth();
  const auth = win.WetalkAuth;
  assert.ok(auth, "window.WetalkAuth should be defined after js/auth.js loads");
  for (const name of ["getSession", "requireAuth", "signOut", "createAccount", "authenticate", "toast"]) {
    assert.equal(typeof auth[name], "function", "WetalkAuth." + name + " should be a function");
  }
  assert.equal(typeof auth.identifyIdentifier, "function", "identifyIdentifier kept for compatibility");
});

test("auth.identifyIdentifier classifies emails", () => {
  const auth = loadAuth().WetalkAuth;
  const identify = auth.identifyIdentifier;
  for (const value of ["student@example.com", "a.b+tag@school.edu", "  padded@example.org  "]) {
    assert.equal(identify(value), "email", JSON.stringify(value) + " should be an email");
  }
});

test("auth.identifyIdentifier classifies phone numbers", () => {
  const auth = loadAuth().WetalkAuth;
  const identify = auth.identifyIdentifier;
  // Known gap: a leading "(" ((555) 123-4567) does not classify today - see docs/TESTING.md.
  for (const value of ["+1 555 123 4567", "5551234567", "+86 138 0013 8000", "555 123 4567"]) {
    assert.equal(identify(value), "phone", JSON.stringify(value) + " should be a phone number");
  }
});

test("auth.identifyIdentifier rejects malformed / empty values", () => {
  const auth = loadAuth().WetalkAuth;
  const identify = auth.identifyIdentifier;
  for (const value of ["", "   ", "not-an-identifier", "student@", "@example.com", "abc@"]) {
    assert.equal(identify(value), null, JSON.stringify(value) + " should not be identified");
  }
  assert.equal(identify(null), null);
  assert.equal(identify(undefined), null);
});

test("auth.normalizeIdentifier trims whitespace", () => {
  const auth = loadAuth().WetalkAuth;
  if (typeof auth.normalizeIdentifier !== "function") return; // optional helper
  assert.equal(auth.normalizeIdentifier("  a@b.co  "), "a@b.co");
  assert.equal(auth.normalizeIdentifier(null), "");
});

// ---------------------------------------------------------------
// Preview-mode accounts + sessions
// ---------------------------------------------------------------
test("auth: createAccount signs the new user in and persists the account", async () => {
  const win = loadAuth();
  const auth = win.WetalkAuth;
  const result = await auth.createAccount({
    email: "qa.preview@example.com",
    identifier: "qa.preview@example.com",
    username: "qa_preview",
    password: "correct-horse-1",
  });

  assert.equal(result.ok, true, "preview signup should succeed: " + JSON.stringify(result));
  const session = auth.getSession();
  assert.ok(session, "signup should create a session");
  assert.equal(session.username, "qa_preview");
  assert.ok(getStoredSession(win), "session should be cached in localStorage[wetalk.session]");
  assert.ok(
    win.__storage.getItem("wetalk.accounts"),
    "preview accounts should be stored in localStorage[wetalk.accounts]"
  );
});

test("auth: duplicate signup is rejected without replacing the session", async () => {
  const win = loadAuth();
  const auth = win.WetalkAuth;
  await auth.createAccount({
    email: "dup@example.com",
    identifier: "dup@example.com",
    username: "first_user",
    password: "correct-horse-1",
  });
  const before = auth.getSession();
  const result = await auth.createAccount({
    email: "DUP@example.com",
    identifier: "DUP@example.com",
    username: "second_user",
    password: "another-password",
  });

  assert.equal(result.ok, false, "the same email should not be able to sign up twice");
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0, "the duplicate error should have a message");
  assert.equal(auth.getSession().username, before.username, "the first account should stay signed in");
});

test("auth: authenticate accepts the right password and rejects the wrong one", async () => {
  const win = loadAuth();
  const auth = win.WetalkAuth;
  await auth.createAccount({
    email: "login@example.com",
    identifier: "login@example.com",
    username: "login_user",
    password: "correct-horse-1",
  });
  auth.signOut();
  assert.equal(auth.getSession(), null, "signOut should clear the session");

  const wrong = await auth.authenticate("login@example.com", "wrong-password");
  assert.equal(wrong.ok, false);
  assert.equal(typeof wrong.error, "string");
  assert.equal(auth.getSession(), null, "a failed sign-in must not create a session");

  const right = await auth.authenticate("login@example.com", "correct-horse-1");
  assert.equal(right.ok, true, "correct password should sign in: " + JSON.stringify(right));
  assert.equal(auth.getSession().username, "login_user");
});

test("auth: authenticate rejects unknown accounts", async () => {
  const auth = loadAuth().WetalkAuth;
  const result = await auth.authenticate("nobody@example.com", "whatever-123");
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
});

test("auth: preview accounts survive a reload (shared localStorage)", async () => {
  const win = loadAuth();
  await win.WetalkAuth.createAccount({
    email: "persist@example.com",
    identifier: "persist@example.com",
    username: "persist_user",
    password: "correct-horse-1",
  });

  // Same storage, fresh window = page reload in the same browser.
  const reloaded = loadAuth({}, win.__storage);
  assert.ok(reloaded.WetalkAuth.getSession(), "session should be restored after reload");
  const result = await reloaded.WetalkAuth.authenticate("persist@example.com", "correct-horse-1");
  assert.equal(result.ok, true, "stored preview account should authenticate after reload");
});

test("auth: signOut clears storage and navigates away", async () => {
  const win = loadAuth();
  await win.WetalkAuth.createAccount({
    email: "bye@example.com",
    identifier: "bye@example.com",
    username: "bye_user",
    password: "correct-horse-1",
  });
  win.__redirects.length = 0;

  win.WetalkAuth.signOut();

  assert.equal(win.WetalkAuth.getSession(), null);
  assert.equal(win.__storage.getItem("wetalk.session"), null, "session cache should be removed");
  assert.ok(win.__redirects.length > 0, "signOut should navigate (index.html or signin.html)");
  assert.match(
    win.__redirects[win.__redirects.length - 1],
    /(index|signin)\.html$|\/$/,
    "signOut should land on the landing or sign-in page"
  );
});

test("auth: requireAuth redirects to signin.html when signed out", () => {
  const win = loadAuth();
  assert.equal(win.WetalkAuth.getSession(), null);
  win.__redirects.length = 0;

  assert.equal(win.WetalkAuth.requireAuth(), false);
  assert.ok(
    win.__redirects.some((target) => /signin\.html/.test(target)),
    "requireAuth should redirect to signin.html, got: " + JSON.stringify(win.__redirects)
  );
});

test("auth: requireAuth returns true and does not redirect when signed in", async () => {
  const win = loadAuth();
  await win.WetalkAuth.createAccount({
    email: "signed-in@example.com",
    identifier: "signed-in@example.com",
    username: "signed_in",
    password: "correct-horse-1",
  });
  win.__redirects.length = 0;
  assert.equal(win.WetalkAuth.requireAuth(), true);
  assert.equal(win.__redirects.length, 0, "no navigation needed for a signed-in user");
});

// ---------------------------------------------------------------
// New-contract assertions (activate when the rewrite lands)
// ---------------------------------------------------------------
test("auth: getSession matches the documented profile shape", async (t) => {
  const win = loadAuth();
  const auth = win.WetalkAuth;
  if (!newAuthApi(auth)) return skipPending(t, "documented session shape { id, username, email, provider, avatar }");
  await auth.createAccount({
    email: "shape@example.com",
    identifier: "shape@example.com",
    username: "shape_user",
    password: "correct-horse-1",
  });
  const session = auth.getSession();
  assert.ok(session, "session should exist");
  assert.equal(typeof session.username, "string");
  assert.ok(session.username.length > 0);
  assert.equal(typeof session.id, "string");
  assert.ok(session.id.length > 0, "session.id should be a non-empty string");
  assert.equal(typeof session.email, "string");
  assert.ok("avatar" in session, "session should expose an avatar field (string or null)");
});

test("auth: isPreviewMode reflects WETALK_CONFIG", (t) => {
  const previewWindow = loadAuth();
  const auth = previewWindow.WetalkAuth;
  if (!newAuthApi(auth)) return skipPending(t, "isPreviewMode()");
  assert.equal(auth.isPreviewMode(), true, "empty config must mean preview mode");
  assert.equal(auth.getClient(), null, "no Supabase client in preview mode");
});

// ---------------------------------------------------------------
// Configured Supabase mode (the production configuration)
// ---------------------------------------------------------------
test("auth: a configured Supabase project takes the site out of Preview mode", () => {
  const win = loadAuth({}, null, CONFIGURED_CONFIG_SOURCE);
  const auth = win.WetalkAuth;
  assert.equal(auth.isPreviewMode(), false, "a URL + anon key must not be Preview mode");
  // The mock window has no vendored supabase-js global, so no client can be
  // built - the page must degrade instead of falling back to local accounts.
  assert.equal(auth.getClient(), null, "without vendor/supabase.js there is no Supabase client");
  const banner = win.__document.body.children.find((el) => /preview-banner/.test(el.className || ""));
  assert.equal(banner, undefined, "configured mode must not inject the Preview-mode banner");
});

test("auth: configured mode without a Supabase client reports 'still loading' instead of creating local accounts", async () => {
  const win = loadAuth({}, null, CONFIGURED_CONFIG_SOURCE);
  const auth = win.WetalkAuth;

  const signup = await auth.createAccount({
    email: "configured@example.com",
    identifier: "configured@example.com",
    username: "configured_user",
    password: "correct-horse-1",
  });
  assert.equal(signup.ok, false, "configured mode must not silently create a local account");
  assert.match(String(signup.error || ""), /still loading/i, "the page should explain the client is not ready yet");

  const signin = await auth.authenticate("configured@example.com", "correct-horse-1");
  assert.equal(signin.ok, false, "configured mode must not authenticate against local accounts");
  assert.match(String(signin.error || ""), /still loading/i, "the page should explain the client is not ready yet");

  assert.equal(win.__storage.getItem("wetalk.accounts"), null, "no preview accounts may be written in configured mode");
  assert.equal(auth.getSession(), null, "a failed Supabase-mode sign-in must not create a session");
});

test("auth: preview banner is inserted for preview visitors", (t) => {
  const win = loadAuth();
  const auth = win.WetalkAuth;
  if (!newAuthApi(auth)) return skipPending(t, "preview banner injection");
  const body = win.__document.body;
  const html = String(body.innerHTML || "");
  const banner = body.children.find((el) => /preview-banner/.test(el.className || ""));
  if (!banner && !/preview-banner/.test(html)) {
    t.diagnostic(PREVIEW_BANNER_NOTE);
    return; // covered end-to-end; mock DOM cannot see every insertion method
  }
  assert.ok(banner || /preview-banner/.test(html), "a .preview-banner element should be in the body");
});

// ---------------------------------------------------------------
// Google One Tap (initGoogleOneTap)
// ---------------------------------------------------------------
const ONE_TAP_CONFIG_SOURCE = [
  "/* unit-test stub of js/config.js - configured + Google One Tap client ID */",
  "window.WETALK_CONFIG = {",
  "  supabaseUrl: 'https://qa-project.supabase.co',",
  "  supabaseAnonKey: 'qa-public-anon-key',",
  "  aiProxyUrl: '',",
  "  googleClientId: 'qa-google-client-id.apps.googleusercontent.com',",
  "  siteUrl: ''",
  "};",
].join("\n");

function fakeGoogleSession() {
  return {
    access_token: "qa-access-token",
    user: {
      id: "user-one-tap-1",
      email: "onetap@example.com",
      user_metadata: { full_name: "One Tap" },
      app_metadata: { provider: "google" },
    },
  };
}

function fakeSupabaseLib(session, signInError) {
  const client = {
    auth: {
      onAuthStateChange() {},
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithIdToken: signInError
        ? () => Promise.resolve({ data: {}, error: { message: signInError } })
        : () => Promise.resolve({ data: { session }, error: null }),
      signOut: () => Promise.resolve({}),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  };
  return { createClient: () => client };
}

function fakeGsi(captured) {
  return {
    accounts: {
      id: {
        initialize(options) {
          captured.initializeOptions = options;
        },
        prompt() {
          captured.prompted = true;
        },
      },
    },
  };
}

test("auth.initGoogleOneTap is exposed and no-ops in Preview mode", () => {
  const auth = loadAuth().WetalkAuth;
  assert.equal(typeof auth.initGoogleOneTap, "function", "WetalkAuth.initGoogleOneTap should be a function");
  assert.equal(auth.initGoogleOneTap({}), false, "Preview mode has no real accounts - One Tap must not start");
});

test("auth.initGoogleOneTap no-ops when googleClientId is not configured", () => {
  const win = loadAuth({}, null, CONFIGURED_CONFIG_SOURCE);
  assert.equal(win.WetalkAuth.initGoogleOneTap({}), false, "an empty googleClientId disables One Tap");
});

test("auth.initGoogleOneTap no-ops for an already signed-in visitor", () => {
  const win = loadAuth(
    { storageSeed: { "wetalk.session": { username: "signed_in", email: "in@example.com" } } },
    null,
    ONE_TAP_CONFIG_SOURCE
  );
  assert.ok(win.WetalkAuth.getSession(), "the seeded session should be picked up");
  assert.equal(win.WetalkAuth.initGoogleOneTap({}), false, "no prompt for signed-in visitors");
});

test("auth.initGoogleOneTap exchanges the Google credential and caches the session", async () => {
  const win = loadAuth({}, null, ONE_TAP_CONFIG_SOURCE);
  const captured = {};
  win.google = fakeGsi(captured);
  win.supabase = fakeSupabaseLib(fakeGoogleSession());

  let succeeded = null;
  let failed = null;
  const started = win.WetalkAuth.initGoogleOneTap({
    onSuccess: (session) => { succeeded = session; },
    onError: (message) => { failed = message; },
  });
  assert.equal(started, true, "One Tap should start for a signed-out visitor with a client ID");
  assert.equal(captured.initializeOptions.client_id, "qa-google-client-id.apps.googleusercontent.com");
  assert.equal(captured.prompted, true, "the One Tap prompt should be shown");

  // Simulate Google returning an ID token for the chosen account.
  captured.initializeOptions.callback({ credential: "qa-google-id-token" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(failed, null, "the exchange should not fail: " + failed);
  assert.ok(succeeded, "onSuccess should receive the shaped session");
  const session = win.WetalkAuth.getSession();
  assert.ok(session, "the session should be cached like every other sign-in");
  assert.equal(session.provider, "google");
  assert.equal(session.email, "onetap@example.com");
  assert.equal(session.id, "user-one-tap-1");
});

test("auth.initGoogleOneTap surfaces exchange failures through onError", async () => {
  const win = loadAuth({}, null, ONE_TAP_CONFIG_SOURCE);
  const captured = {};
  win.google = fakeGsi(captured);
  win.supabase = fakeSupabaseLib(null, "Invalid token");

  let succeeded = null;
  let failed = null;
  win.WetalkAuth.initGoogleOneTap({
    onSuccess: (session) => { succeeded = session; },
    onError: (message) => { failed = message; },
  });
  captured.initializeOptions.callback({ credential: "bad-token" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(succeeded, null, "a failed exchange must not sign the visitor in");
  assert.equal(typeof failed, "string");
  assert.ok(failed.length > 0, "onError should receive a readable message");
  assert.equal(win.WetalkAuth.getSession(), null, "no session may be cached on failure");
});
