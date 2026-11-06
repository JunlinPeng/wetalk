/* ============================================================
   E2E spec: complete speech-practice journey in Preview mode

   A visitor must be able to go from a topic to feedback without any
   AI key and without getting stuck:

     topic (write it myself) -> speech (manual editor, no AI needed)
       -> schedule (built-in offline plan) -> check-in -> practice
       -> local heuristic feedback -> previous works

   This is the "smooth end-to-end flow" guarantee for the public
   Preview-mode site. It runs signed-in with the seeded session.
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

module.exports = {
  name: "flow",
  requiresBrowser: true,
  run: async (ctx) => {
    const context = await newContext(ctx.browser, { signedIn: true });
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);

    try {
      // 1. Topic page -> manual mode -> speech editor (no AI required).
      try {
        await page.goto(pageUrl(ctx.baseURL, "topic.html"), { waitUntil: "load" });
        await page.fill("#topicInput", TOPIC);
        await page.click("#opt-manual");
        await page.click("#continueBtn");
        await waitForUrl(page, [/script\.html/], 15000);
        await waitFor(page, "#manualView");
        const visible = await page.isVisible("#manualText");
        if (!visible) throw new Error("manual editor is not visible without an AI provider");
        ctx.pass("topic -> manual speech editor works with no AI");
      } catch (err) {
        ctx.fail("topic -> manual speech editor works with no AI", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 2. Save the speech and continue to the schedule page.
      try {
        await page.fill("#manualText", SPEECH);
        await page.click("#saveManualBtn");
        await waitForUrl(page, [/schedule\.html/], 15000);
        await screenshot(page, "flow-01-schedule");
        ctx.pass("manual speech saves and continues to schedule");
      } catch (err) {
        ctx.fail("manual speech saves and continues to schedule", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 3. Build the schedule with no AI (offline plan fallback).
      try {
        await page.click("#genScheduleBtn");
        await waitFor(page, "#scheduleResult", 20000);
        const days = await page.locator("#scheduleList .day-card").count();
        if (days < 1) throw new Error("offline plan produced no day cards");
        await screenshot(page, "flow-02-plan");
        ctx.pass("schedule builds an offline plan with no AI", days + " day cards");
      } catch (err) {
        ctx.fail("schedule builds an offline plan with no AI", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 4. Daily check-in -> practice.
      try {
        await page.click("#finishTodayBtn");
        await waitForUrl(page, [/checkin\.html/], 15000);
        const action = await findAction(page, /continue/i);
        if (!action) throw new Error("no continue button on checkin page");
        await action.click();
        await waitForUrl(page, [/practice\.html/], 15000);
        ctx.pass("check-in leads into practice");
      } catch (err) {
        ctx.fail("check-in leads into practice", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
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
        ctx.pass("practice gives local heuristic feedback with no AI", criteria + " criteria scored");
      } catch (err) {
        ctx.fail("practice gives local heuristic feedback with no AI", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 6. The work appears in Previous works and is resumable.
      try {
        await page.goto(pageUrl(ctx.baseURL, "works.html"), { waitUntil: "load" });
        await page.waitForTimeout(500);
        const works = await page.locator(".work-card").count();
        if (works < 1) throw new Error("no work cards after the flow");
        ctx.pass("completed work appears in Previous works", works + " card(s)");
      } catch (err) {
        ctx.fail("completed work appears in Previous works", (err.message || String(err)) + " | UI: " + JSON.stringify(await snapshotUi(page)));
      }

      // 7. No console errors along the whole journey.
      const summary = diagnosticsSummary(diagnostics);
      if (summary) {
        ctx.fail("full Preview-mode journey has no console errors", summary);
      } else {
        ctx.pass("full Preview-mode journey has no console errors");
      }
    } finally {
      await context.close();
    }
  },
};
