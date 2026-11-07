/* ============================================================
   E2E spec: legacy speech-practice journey (signed in for real)

   The old prototype pages (topic -> script -> schedule -> checkin ->
   practice -> works) are no longer linked from the v2 app, but they
   are still deployed and must not rot. This spec walks the complete
   journey without an AI key (manual editor + offline schedule plan +
   local heuristic feedback) using the real QA account.

   It runs signed in through the real UI (harness storage state), so
   archiving a work pushes a row to public.works; the spec deletes the
   rows it created afterwards so no QA data is left behind.
   ============================================================ */
"use strict";

const {
  newContext,
  pageUrl,
  attachDiagnostics,
  diagnosticsSummary,
  screenshot,
  waitForUrl,
  findAction,
  snapshotUi,
  ensureAuth,
} = require("../lib/harness");

const TOPIC = "Why sleep matters for students";
const SPEECH =
  "Imagine walking into a test you did not study for. That is what every school day feels like when you are sleep deprived. " +
  "First, sleep is when your brain saves what you learned. For example, research shows that students who sleep eight hours remember more. " +
  "Second, sleep controls your mood. Because tired students snap at friends, lack of sleep hurts more than grades. " +
  "Finally, small changes work. A phone-free hour before bed makes a real difference. " +
  "In conclusion, protect your sleep and everything else gets easier.";

async function waitFor(page, selector, timeout) {
  await page.waitForSelector(selector, { state: "visible", timeout: timeout || 15000 });
}

async function readWorkIds(page) {
  return page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem("wetalk.works") || "[]");
      return Array.isArray(list) ? list.map((work) => work && work.id).filter(Boolean) : [];
    } catch (err) {
      return [];
    }
  });
}

/**
 * Delete the public.works rows this spec created (and the local cache).
 * Resolves { known, created, deleted, failed, error } - never throws.
 */
async function cleanupWorks(page, knownIds) {
  return page
    .evaluate(async (baselineIds) => {
      const out = { known: baselineIds.length, created: [], deleted: [], failed: [], error: "" };
      let ids = [];
      try {
        const list = JSON.parse(localStorage.getItem("wetalk.works") || "[]");
        ids = Array.isArray(list) ? list.map((work) => work && work.id).filter(Boolean) : [];
      } catch (err) {
        out.error = "could not read wetalk.works: " + String(err);
      }
      out.created = ids.filter((id) => baselineIds.indexOf(id) === -1);
      try { localStorage.removeItem("wetalk.works"); } catch (err) {}
      try { localStorage.removeItem("wetalk.topicDraft"); } catch (err) {}
      try { localStorage.removeItem("wetalk.speechDraft"); } catch (err) {}
      try { localStorage.removeItem("wetalk.schedule"); } catch (err) {}

      const client = window.WetalkAuth && WetalkAuth.getClient ? WetalkAuth.getClient() : null;
      const session = window.WetalkAuth ? WetalkAuth.getSession() : null;
      if (!client || !session) {
        if (out.created.length) out.error = "no Supabase client/session to delete the created rows";
        return out;
      }
      for (const id of out.created) {
        try {
          const res = await client.from("works").delete().eq("id", id).eq("user_id", session.id);
          if (res && res.error) out.failed.push(id + ": " + res.error.message);
          else out.deleted.push(id);
        } catch (err) {
          out.failed.push(id + ": " + String((err && err.message) || err));
        }
      }
      return out;
    }, knownIds)
    .catch((err) => ({ known: knownIds.length, created: [], deleted: [], failed: [], error: String((err && err.message) || err) }));
}

module.exports = {
  name: "flow",
  requiresBrowser: true,
  run: async (ctx) => {
    const auth = await ensureAuth(ctx.browser);
    if (!auth.ok) {
      ctx.skip("legacy journey (signed in)", "live QA sign-in unavailable: " + auth.error);
      return;
    }

    const context = await newContext(ctx.browser, { signedIn: true });
    const page = await context.newPage();
    // The legacy pages also try the included AI (schedule + practice feedback).
    // Stub the Edge Function so the suite never spends real AI quota and the
    // journey stays deterministic; the assertions below only need the offline
    // fallback to work, which the stub still exercises.
    let aiCalls = 0;
    await page.route("**/functions/v1/ai-feedback", (route) => {
      aiCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          content: JSON.stringify({
            organization: { score: 5, feedback: "Stub feedback (QA)" },
            analysis: { score: 5, feedback: "Stub feedback (QA)" },
            delivery: { score: 5, feedback: "Stub feedback (QA)" },
            creativity: { score: 5, feedback: "Stub feedback (QA)" },
            overall_feedback: "Stub overall feedback (QA)",
          }),
          remaining: 19,
          limit: 20,
        }),
      });
    });
    const diagnostics = attachDiagnostics(page);
    let knownIds = [];

    try {
      // 1. Topic page -> manual mode -> speech editor (no AI required).
      try {
        await page.goto(pageUrl(ctx.baseURL, "topic.html"), { waitUntil: "load" });
        await page.waitForTimeout(600);
        if (/\/signin\.html/.test(page.url())) throw new Error("redirected to " + page.url());
        knownIds = await readWorkIds(page);
        await page.fill("#topicInput", TOPIC);
        await page.click("#opt-manual");
        await page.click("#continueBtn");
        await waitForUrl(page, [/script\.html/], 15000);
        await waitFor(page, "#manualView");
        const visible = await page.isVisible("#manualText");
        if (!visible) throw new Error("manual editor is not visible without an AI provider");
        ctx.pass("legacy: topic -> manual speech editor works with no AI");
      } catch (err) {
        ctx.fail("legacy: topic -> manual speech editor works with no AI", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 2. Save the speech and continue to the schedule page.
      try {
        await page.fill("#manualText", SPEECH);
        await page.click("#saveManualBtn");
        await waitForUrl(page, [/schedule\.html/], 15000);
        await screenshot(page, "flow-01-schedule");
        ctx.pass("legacy: manual speech saves and continues to schedule");
      } catch (err) {
        ctx.fail("legacy: manual speech saves and continues to schedule", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 3. Build the schedule with no AI (offline plan fallback).
      try {
        await page.click("#genScheduleBtn");
        await waitFor(page, "#scheduleResult", 20000);
        const days = await page.locator("#scheduleList .day-card").count();
        if (days < 1) throw new Error("offline plan produced no day cards");
        await screenshot(page, "flow-02-plan");
        ctx.pass("legacy: schedule builds an offline plan with no AI", days + " day cards");
      } catch (err) {
        ctx.fail("legacy: schedule builds an offline plan with no AI", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 4. Daily check-in -> practice.
      try {
        await page.click("#finishTodayBtn");
        await waitForUrl(page, [/checkin\.html/], 15000);
        const action = await findAction(page, /continue/i);
        if (!action) throw new Error("no continue button on checkin page");
        await action.click();
        await waitForUrl(page, [/practice\.html/], 15000);
        ctx.pass("legacy: check-in leads into practice");
      } catch (err) {
        ctx.fail("legacy: check-in leads into practice", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 5. Practice -> local heuristic feedback (no AI key).
      try {
        await page.click("#startBtn");
        await page.waitForTimeout(1500);
        await page.fill("#spokenText", SPEECH);
        await page.click("#finishBtn");
        await waitFor(page, "#stage-results", 20000);
        const criteria = await page.locator("#aiScores .criteria").count();
        if (criteria < 4) throw new Error("expected 4 scored criteria, got " + criteria);
        const overall = (await page.textContent("#overallFeedback")) || "";
        if (!overall.trim()) throw new Error("overall feedback is empty");
        await screenshot(page, "flow-03-feedback");
        ctx.pass("legacy: practice gives local heuristic feedback with no AI", criteria + " criteria scored");
      } catch (err) {
        ctx.fail("legacy: practice gives local heuristic feedback with no AI", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 6. The work appears in Previous works and is resumable.
      try {
        await page.goto(pageUrl(ctx.baseURL, "works.html"), { waitUntil: "load" });
        await page.waitForTimeout(800);
        const works = await page.locator(".work-card").count();
        if (works < 1) throw new Error("no work cards after the flow");
        ctx.pass("legacy: completed work appears in Previous works", works + " card(s)");
      } catch (err) {
        ctx.fail("legacy: completed work appears in Previous works", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 7. No console errors along the whole journey.
      const summary = diagnosticsSummary(diagnostics);
      if (summary) {
        ctx.fail("legacy journey has no console errors", summary);
      } else {
        ctx.pass("legacy journey has no console errors");
      }
    } finally {
      // 8. Remove the public.works rows + drafts this journey created.
      try {
        await page.waitForTimeout(1500); // let the fire-and-forget upserts settle
        const cleanup = await cleanupWorks(page, knownIds);
        if (cleanup.error || cleanup.failed.length) {
          ctx.fail(
            "legacy journey cleans up its public.works rows",
            JSON.stringify(cleanup)
          );
        } else {
          ctx.pass(
            "legacy journey cleans up its public.works rows",
            cleanup.deleted.length + " row(s) deleted; " + aiCalls + " AI call(s) stubbed (0 real quota)"
          );
        }
      } catch (err) {
        ctx.fail("legacy journey cleans up its public.works rows", err.message || String(err));
      }
      await context.close();
    }
  },
};
