/* ============================================================
   E2E spec: Wetalk v2 app (app.html) - the live practice workspace

   Covers the migrated v2 experience against the REAL Supabase
   project (like the deployed site):
     1. signed-out app.html redirects to signin.html?next=app.html
     2. sign in through the UI -> lands back on app.html; sidebar
        brand / Previous Work / three mode cards / user chip /
        sign out all render
     3. Impromptu mode: Generate Topic replaces the placeholder and
        reveals "Begin Practice" (local topic bank, no AI)
     4. Settings modal shows a non-empty AI status and closes
     5. AI path: the ai-feedback Edge Function is intercepted and
        WetalkV2AI.requestFeedback resolves through
        v2-ai.js -> llm.js platform routing (zero real AI quota)
     6. Cloud history: a saved v2 session is uploaded to
        public.sessions, survives a localStorage wipe + reload and
        is pulled back into the "Previous Work" sidebar, then the
        test row is deleted again
     7. Sign out returns to index.html and clears the session

   The AI Edge Function is ALWAYS stubbed - the suite never spends
   real AI quota. Signed-in state is real (shared QA account) and
   the captured storage state is shared with the other specs.
   ============================================================ */
"use strict";

const {
  newContext,
  pageUrl,
  attachDiagnostics,
  diagnosticsSummary,
  pendingReferenceReason,
  isBrowserNoise,
  snapshotUi,
  screenshot,
  waitForUrl,
  signInThroughUi,
  rememberSignedInState,
  signedInAvailable,
  AUTH_SKIP_REASON,
  configure,
} = require("../lib/harness");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function textOf(page, selector) {
  return page
    .locator(selector)
    .first()
    .textContent()
    .then((text) => String(text || "").replace(/\s+/g, " ").trim())
    .catch(() => "");
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

async function closeModalIfOpen(page) {
  const open = await page
    .evaluate(() => {
      const el = document.getElementById("settingsModal");
      return !!el && !el.hidden;
    })
    .catch(() => false);
  if (!open) return;
  await page.click("#btnSettingsSave").catch(() => {});
  await page.waitForTimeout(200);
}

module.exports = {
  name: "v2",
  requiresBrowser: true,
  run: async (ctx) => {
    // ---- 1. signed-out visitor is bounced to signin with the app as ?next ----
    {
      const context = await newContext(ctx.browser, { signedIn: false });
      const page = await context.newPage();
      try {
        await page.goto(pageUrl(ctx.baseURL, "app.html"), { waitUntil: "load" });
        await waitForUrl(page, [/signin\.html/], 15000);
        const target = new URL(page.url());
        assert(target.pathname.endsWith("/signin.html"), "expected signin.html, got " + page.url());
        const next = target.searchParams.get("next");
        assert(next === "app.html", "expected ?next=app.html, got " + JSON.stringify(next));
        await screenshot(page, "v2-01-signed-out-redirect");
        ctx.pass("v2 app: signed-out app.html redirects to signin.html?next=app.html", page.url());
      } catch (err) {
        ctx.fail(
          "v2 app: signed-out app.html redirects to signin.html?next=app.html",
          (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page))
        );
      } finally {
        await context.close();
      }
    }

    // ---- 2-7. the signed-in v2 journey in one real browser session ----
    if (!signedInAvailable()) {
      ctx.skip("v2 app: signed-in v2 journey (sign-in, modes, AI, cloud history, sign out)", AUTH_SKIP_REASON);
      return;
    }
    const context = await newContext(ctx.browser, { signedIn: false });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);

    try {
      // ---- 2. real UI sign-in lands on app.html and the workspace renders ----
      const signedIn = await check(ctx, page, "v2 app: UI sign-in with the live QA account lands on app.html", async () => {
        const result = await signInThroughUi(page, ctx.baseURL);
        assert(result.session && result.session.id, "no session cached after sign-in");
        await page.waitForTimeout(2500); // let auth bootstrap re-check Supabase
        assert(/\/app\.html(\?|$)/.test(page.url()), "bounced away from app.html to " + page.url());
        return "session=" + (result.session.username || result.session.email);
      });

      if (!signedIn) {
        ctx.skip("v2 app: remaining signed-in v2 checks", "sign-in failed");
        return;
      }

      // Share this real signed-in state with the other specs (they must not
      // submit the sign-in form again).
      rememberSignedInState(await context.storageState());

      await check(ctx, page, "v2 app: sidebar, Previous Work, mode cards, user chip and sign out render", async () => {
        await page.waitForSelector(".mode-card", { state: "visible", timeout: 15000 });
        const ui = await page.evaluate(() => {
          const el = (selector) => document.querySelector(selector);
          return {
            brand: (el(".sidebar__brand") || {}).textContent || "",
            section: (el(".sidebar__section-title") || {}).textContent || "",
            modes: Array.from(document.querySelectorAll(".mode-card")).map(
              (card) => ((card.querySelector("h2") || {}).textContent || "").trim()
            ),
            username: (el("#v2Username") || {}).textContent || "",
            userBlock: !!(el("#v2UserBlock") && !el("#v2UserBlock").hidden),
            signOut: (el("#v2SignOut") || {}).textContent || "",
            signOutVisible: !!(el("#v2SignOut") && el("#v2SignOut").offsetParent),
          };
        });
        assert(/Wetalk/.test(ui.brand), "sidebar brand missing (got " + JSON.stringify(ui.brand) + ")");
        assert(/Previous Work/i.test(ui.section), "no 'Previous Work' section title");
        assert(ui.modes.length === 3, "expected 3 mode cards, got " + ui.modes.length);
        const modes = ui.modes.join(" | ").toLowerCase();
        assert(/impromptu/.test(modes), "Impromptu mode card missing");
        assert(/vericant/.test(modes), "Vericant mode card missing");
        assert(/toefl/.test(modes), "TOEFL mode card missing");
        assert(ui.username.trim().length > 0, "user chip #v2Username is empty");
        assert(ui.userBlock, "user chip block is hidden");
        assert(/sign out/i.test(ui.signOut), "no Sign out control");
        assert(ui.signOutVisible, "Sign out is not visible");
        await screenshot(page, "v2-02-app-signed-in");
        return ui.modes.join(", ");
      });

      // ---- 3. Impromptu topic generator (local topic bank, no AI) ----
      await check(ctx, page, "v2 app: Impromptu Generate Topic shows a topic and reveals Begin Practice", async () => {
        const placeholder = "Your topic will appear here";
        await page.click('.mode-card[data-mode="impromptu"]');
        await page.waitForSelector("#view-impromptu:not([hidden])", { timeout: 10000 });
        const before = await textOf(page, "#topicText");
        assert(before === placeholder, "expected the placeholder before spinning, got " + JSON.stringify(before));
        await page.click("#btnSpin");
        const deadline = Date.now() + 20000;
        let topic = "";
        while (Date.now() < deadline) {
          await page.waitForTimeout(200);
          const state = await page.evaluate(() => {
            const el = document.getElementById("topicText");
            return {
              text: el ? String(el.textContent || "").trim() : "",
              placeholder: el ? el.classList.contains("is-placeholder") : true,
              beginVisible: !!(
                document.getElementById("btnBegin") &&
                document.getElementById("btnBegin").offsetParent &&
                !document.getElementById("practiceActions").hidden
              ),
            };
          });
          if (state.text && state.text !== placeholder && !state.placeholder) {
            topic = state.text;
            if (state.beginVisible) break;
          }
        }
        assert(topic, "topic text never replaced the placeholder");
        const beginVisible = await page.isVisible("#btnBegin");
        assert(beginVisible, "#btnBegin did not become visible");
        await screenshot(page, "v2-03-impromptu-topic");
        return JSON.stringify(topic.slice(0, 60));
      });

      // ---- 4. Settings modal AI status ----
      await check(ctx, page, "v2 app: Settings modal shows a non-empty AI status and closes", async () => {
        await page.click("#btnSettings");
        await page.waitForSelector("#settingsModal:not([hidden])", { timeout: 10000 });
        const status = (await textOf(page, "#aiStatus")) || "";
        assert(status.length > 0, "#aiStatus is empty");
        assert(!/loading/i.test(status), "#aiStatus is still loading: " + JSON.stringify(status));
        await screenshot(page, "v2-04-settings-modal");
        await page.click("#btnSettingsSave");
        await page.waitForTimeout(250);
        const hidden = await page.evaluate(() => document.getElementById("settingsModal").hidden);
        assert(hidden, "Settings modal did not close");
        return JSON.stringify(status.slice(0, 80));
      });

      // ---- 5. AI feedback through the intercepted Edge Function (no quota spent) ----
      await check(ctx, page, "v2 app: AI examiner feedback routes through the platform proxy (Edge Function stubbed)", async () => {
        let intercepted = 0;
        const stubBody = JSON.stringify({
          content: '{"questions":[{"feedback":"Test feedback"}],"overall":"Test overall"}',
          remaining: 19,
          limit: 20,
        });
        await page.route("**/functions/v1/ai-feedback", (route) => {
          intercepted += 1;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: stubBody,
          });
        });
        try {
          const result = await page.evaluate(async () => {
            try {
              const data = await window.WetalkV2AI.requestFeedback({
                rubric: "toefl",
                topic: "QA topic",
                questions: [
                  { prompt: "Question one?", transcript: "answer", stats: { wordCount: 10, wpm: 130, fillers: 0 } },
                ],
              });
              return { ok: true, data: data };
            } catch (err) {
              return { ok: false, error: String((err && (err.code + ": " + err.message)) || err) };
            }
          });
          assert(result.ok, "WetalkV2AI.requestFeedback rejected: " + JSON.stringify(result));
          const questions = (result.data && result.data.questions) || [];
          assert(questions.length === 1, "expected 1 feedback question, got " + questions.length);
          assert(questions[0].feedback === "Test feedback", "wrong feedback: " + JSON.stringify(questions[0]));
          assert(result.data.overall === "Test overall", "wrong overall: " + JSON.stringify(result.data.overall));
          assert(intercepted === 1, "expected exactly 1 stubbed Edge Function call, got " + intercepted);
          return "1 stubbed call, no real AI quota";
        } finally {
          await page.unroute("**/functions/v1/ai-feedback").catch(() => {});
        }
      });

      // ---- 6. Cloud history round trip through public.sessions ----
      await check(ctx, page, "v2 app: history syncs to Supabase and is restored after a localStorage wipe", async () => {
        const marker = Date.now();
        const testId = "qa-cloud-" + marker;
        const testTitle = "QA cloud sync " + marker;
        const supabase = async (fn, arg) =>
          page.evaluate(fn, arg).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));

        const cleanupRemote = () =>
          supabase(async (testIdArg) => {
            const client = window.WetalkAuth && WetalkAuth.getClient ? WetalkAuth.getClient() : null;
            const session = window.WetalkAuth ? WetalkAuth.getSession() : null;
            if (!client || !session) return { ok: false, error: "no Supabase client/session" };
            const res = await client.from("sessions").delete().eq("user_id", session.id).eq("id", testIdArg);
            try { localStorage.removeItem("wetalk.v2.history"); } catch (e) {}
            return { ok: !res.error, error: res.error ? res.error.message : "" };
          }, testId);

        // Remove leftovers from a previous aborted run so the check is clean.
        await supabase(async () => {
          const client = window.WetalkAuth && WetalkAuth.getClient ? WetalkAuth.getClient() : null;
          const session = window.WetalkAuth ? WetalkAuth.getSession() : null;
          if (!client || !session) return { ok: false };
          let stale = [];
          try {
            const list = await client.from("sessions").select("id").eq("user_id", session.id).like("id", "qa-cloud-%");
            stale = ((list && list.data) || []).map((row) => row.id);
          } catch (e) {}
          for (const id of stale) {
            await client.from("sessions").delete().eq("user_id", session.id).eq("id", id);
          }
          return { ok: true, removed: stale.length };
        });

        // Save a v2 session: local cache first, debounced upload to Supabase.
        await page.evaluate(([item]) => {
          window.WetalkV2.saveHistory([item]);
        }, [{
          id: testId,
          mode: "impromptu",
          modeLabel: "Impromptu Speech",
          title: testTitle,
          startedAt: marker,
          scores: { overall: 4, max: 5 },
          stats: { duration: 60, wordCount: 80, wpm: 80 },
          transcript: "qa",
          tips: [],
          questions: [],
        }]);
        await page.waitForTimeout(2500);

        // The row must really exist in public.sessions (not just localStorage).
        const uploaded = await supabase(async (testIdArg) => {
          const client = window.WetalkAuth.getClient();
          const session = window.WetalkAuth.getSession();
          const res = await client.from("sessions").select("id,title").eq("user_id", session.id).eq("id", testIdArg);
          return { ok: !res.error, error: res.error ? res.error.message : "", rows: res.data || [] };
        }, testId);
        assert(uploaded.ok, "could not query public.sessions: " + JSON.stringify(uploaded));
        assert(
          uploaded.rows.length === 1 && uploaded.rows[0].title === testTitle,
          "test session did not reach public.sessions: " + JSON.stringify(uploaded.rows)
        );

        // Wipe the local cache, reload, and expect the cloud pull to restore it.
        await page.evaluate(() => { try { localStorage.removeItem("wetalk.v2.history"); } catch (e) {} });
        await page.reload({ waitUntil: "load" });
        assert(/\/app\.html(\?|$)/.test(page.url()), "reload bounced to " + page.url());
        const deadline = Date.now() + 25000;
        let restored = false;
        while (Date.now() < deadline && !restored) {
          await page.waitForTimeout(500);
          restored = await page.evaluate((title) => {
            return Array.from(document.querySelectorAll(".history-item__title")).some(
              (el) => (el.textContent || "").trim() === title
            );
          }, testTitle);
        }
        await screenshot(page, "v2-05-cloud-history-restored");
        assert(restored, "cloud history was not restored into the Previous Work sidebar");

        // Clean up: delete the row from Supabase and the local cache.
        const cleaned = await cleanupRemote();
        assert(cleaned.ok, "could not delete the QA session row: " + JSON.stringify(cleaned));
        const after = await supabase(async (testIdArg) => {
          const client = window.WetalkAuth.getClient();
          const session = window.WetalkAuth.getSession();
          const res = await client.from("sessions").select("id").eq("user_id", session.id).eq("id", testIdArg);
          return { ok: !res.error, error: res.error ? res.error.message : "", rows: res.data || [] };
        }, testId);
        assert(after.ok && after.rows.length === 0, "QA session row was not deleted: " + JSON.stringify(after));
        return "uploaded, restored after reload, deleted";
      });

      // ---- 7. Sign out returns to the landing page and clears the session ----
      await check(ctx, page, "v2 app: Sign out returns to index.html and clears the session", async () => {
        await page.click("#v2SignOut");
        await waitForUrl(page, [/index\.html$/, /\/$/], 20000);
        const session = await page.evaluate(() => {
          try { return localStorage.getItem("wetalk.session"); } catch (e) { return "?"; }
        });
        assert(session === null, "wetalk.session still present after sign out: " + JSON.stringify(session));
        await screenshot(page, "v2-06-signed-out-index");
        // Signing out must restore the sign-in redirect on the app.
        await page.goto(pageUrl(ctx.baseURL, "app.html"), { waitUntil: "load" });
        await waitForUrl(page, [/signin\.html/], 15000);
        return "landed on index.html, app.html requires sign-in again";
      });
      // Signing out revokes the account's sessions, so the storage state we
      // shared earlier is no longer usable by other specs: make them sign in
      // again (fresh session) instead of reusing a revoked token.
      configure({ resetAuth: true });

      // ---- journey console cleanliness ----
      const ignored = [];
      const problems = [];
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
        ctx.fail("v2 journey has no console errors", problems.join("; "));
      } else {
        ctx.pass("v2 journey has no console errors", ignored.length ? "ignored: " + ignored.join(", ") : undefined);
      }
    } finally {
      await closeModalIfOpen(page);
      await context.close();
    }
  },
};
