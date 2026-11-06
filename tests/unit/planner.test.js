/* ============================================================
   Unit tests: js/planner.js - JSON extraction + offline fallbacks
   ============================================================ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindow, loadScripts } = require("../helpers/mock-browser");

function loadPlanner(llm) {
  const win = createWindow();
  loadScripts(win, ["js/planner.js"]);
  if (llm) win.WetalkLLM = llm;
  return win;
}

// ---------------------------------------------------------------
// extractJSON
// ---------------------------------------------------------------
test("planner.extractJSON parses plain JSON", () => {
  const { extractJSON } = loadPlanner().WetalkPlanner;
  assert.deepEqual(JSON.parse(JSON.stringify(extractJSON('{"daily_plan":[]}'))), { daily_plan: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(extractJSON("[1,2,3]"))), [1, 2, 3]);
});

test("planner.extractJSON unwraps markdown code fences", () => {
  const { extractJSON } = loadPlanner().WetalkPlanner;
  const fenced = "Here is your plan:\n\n" + String.fromCharCode(96, 96, 96) + "json\n" +
    '{"daily_plan":[{"day_number":1,"focus_area":"Intro","tasks":["Read"],"estimated_minutes":30}]}' +
    "\n" + String.fromCharCode(96, 96, 96) + "\n\nGood luck!";
  const parsed = extractJSON(fenced);
  assert.ok(parsed && parsed.daily_plan, "fenced JSON should be extracted");
  assert.equal(parsed.daily_plan.length, 1);
});

test("planner.extractJSON unwraps fences without a language tag", () => {
  const { extractJSON } = loadPlanner().WetalkPlanner;
  const tick = String.fromCharCode(96);
  const fenced = tick + tick + tick + "\n" + '{"outline_title":"My talk"}' + "\n" + tick + tick + tick;
  const parsed = extractJSON(fenced);
  assert.ok(parsed);
  assert.equal(parsed.outline_title, "My talk");
});

test("planner.extractJSON finds a JSON object inside prose", () => {
  const { extractJSON } = loadPlanner().WetalkPlanner;
  const text = "Sure, here is the schedule you asked for:\n" +
    '{"daily_plan":[{"day_number":1}],"note":"done"}\n' +
    "Let me know if you want changes.";
  const parsed = extractJSON(text);
  assert.ok(parsed, "JSON embedded in prose should be extracted");
  assert.equal(parsed.note, "done");
  assert.equal(parsed.daily_plan.length, 1);
});

test("planner.extractJSON handles nested objects", () => {
  const { extractJSON } = loadPlanner().WetalkPlanner;
  const parsed = extractJSON('{"a":{"b":{"c":1}},"d":[{"e":2}]}');
  assert.ok(parsed);
  assert.equal(parsed.a.b.c, 1);
  assert.equal(parsed.d[0].e, 2);
});

test("planner.extractJSON returns null for missing or garbage input", () => {
  const { extractJSON } = loadPlanner().WetalkPlanner;
  for (const value of [null, undefined, "", "   ", "no json here", "{"]) {
    assert.equal(extractJSON(value), null, JSON.stringify(value) + " should not parse");
  }
  const truncated = '{"daily_plan":[{"day_number":1,"focus_area":"Intro"';
  assert.equal(extractJSON(truncated), null, "truncated JSON should return null");
});

// ---------------------------------------------------------------
// Offline fallbacks
// ---------------------------------------------------------------
test("planner.fallbackSchedule returns the requested number of days", () => {
  const planner = loadPlanner().WetalkPlanner;
  const speech = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
  const plan = planner.fallbackSchedule(speech, 3);

  assert.ok(plan && Array.isArray(plan.daily_plan));
  assert.equal(plan.daily_plan.length, 3);
  plan.daily_plan.forEach((day, index) => {
    assert.equal(day.day_number, index + 1);
    assert.equal(typeof day.focus_area, "string");
    assert.ok(day.focus_area.length > 0);
    assert.ok(Array.isArray(day.tasks) && day.tasks.length > 0, "each day needs tasks");
    assert.equal(day.estimated_minutes, 30);
  });
  assert.equal(plan.daily_plan[2].focus_area, "Full Dress Rehearsal", "last day is a dress rehearsal");
});

test("planner.fallbackSchedule spreads paragraphs across days", () => {
  const planner = loadPlanner().WetalkPlanner;
  const plan = planner.fallbackSchedule("First segment.\n\nSecond segment.", 2);
  assert.match(plan.daily_plan[0].script_segment, /First segment/);
  assert.match(plan.daily_plan[1].script_segment, /Second segment/);
});

test("planner.fallbackSchedule copes with an empty speech", () => {
  const planner = loadPlanner().WetalkPlanner;
  const plan = planner.fallbackSchedule("", 2);
  assert.equal(plan.daily_plan.length, 2);
  assert.match(plan.daily_plan[0].script_segment, /run-through/i);
});

test("planner.fallbackPPT builds sections from paragraphs", () => {
  const planner = loadPlanner().WetalkPlanner;
  const outline = planner.fallbackPPT("My speech", "Opening hook.\n\nMiddle argument.\n\nClosing call.");
  assert.equal(outline.outline_title, "My speech");
  assert.ok(Array.isArray(outline.sections));
  assert.ok(outline.sections.length >= 1);
  for (const section of outline.sections) {
    assert.equal(typeof section.slide_heading, "string");
    assert.ok(Array.isArray(section.bullet_points) && section.bullet_points.length > 0);
  }
});

test("planner.fallbackPPT always returns a slide", () => {
  const planner = loadPlanner().WetalkPlanner;
  const outline = planner.fallbackPPT("", "");
  assert.equal(outline.outline_title, "Presentation");
  assert.equal(outline.sections.length, 1);
});

// ---------------------------------------------------------------
// AI paths with a mocked WetalkLLM (no network)
// ---------------------------------------------------------------
test("planner.generateSchedule parses an AI reply", async () => {
  const reply = '{"daily_plan":[{"day_number":1,"focus_area":"AI focus","script_segment":"intro","tasks":["t1"],"estimated_minutes":20},' +
    '{"day_number":2,"focus_area":"AI focus 2","script_segment":"body","tasks":["t2"],"estimated_minutes":20}]}';
  const win = loadPlanner({ chat: async () => reply });
  const plan = await win.WetalkPlanner.generateSchedule("Title", "Speech text", 2);
  assert.equal(plan.daily_plan.length, 2);
  assert.equal(plan.daily_plan[0].focus_area, "AI focus");
});

test("planner.generateSchedule pads a short AI plan to the requested day count", async () => {
  const reply = '{"daily_plan":[{"day_number":1,"focus_area":"AI focus","script_segment":"intro","tasks":["t1"],"estimated_minutes":20}]}';
  const win = loadPlanner({ chat: async () => reply });
  const plan = await win.WetalkPlanner.generateSchedule("Title", "Speech", 3);
  assert.equal(plan.daily_plan.length, 3, "AI plan should be padded to the requested days");
});

test("planner.generateSchedule falls back when the AI reply is unusable", async () => {
  const win = loadPlanner({ chat: async () => "I cannot help with that." });
  const plan = await win.WetalkPlanner.generateSchedule("Title", "Speech", 2);
  assert.equal(plan.daily_plan.length, 2, "fallback plan should be returned");
  assert.equal(plan.daily_plan[1].focus_area, "Full Dress Rehearsal");
});

test("planner.generateSchedule falls back when the AI request fails", async () => {
  const win = loadPlanner({ chat: async () => { throw new Error("offline"); } });
  const plan = await win.WetalkPlanner.generateSchedule("Title", "Speech", 2);
  assert.equal(plan.daily_plan.length, 2);
});

test("planner.generateSchedule clamps invalid day counts", async () => {
  const win = loadPlanner({ chat: async () => { throw new Error("offline"); } });
  const plan = await win.WetalkPlanner.generateSchedule("Title", "Speech", 0);
  assert.equal(plan.daily_plan.length, 1, "day count should clamp to at least 1");
});

test("planner.generatePPT parses an AI outline", async () => {
  const reply = '{"outline_title":"AI outline","thesis":"A thesis","sections":[{"slide_heading":"Intro","bullet_points":["a","b"]}]}';
  const win = loadPlanner({ chat: async () => reply });
  const outline = await win.WetalkPlanner.generatePPT("Title", "Speech");
  assert.equal(outline.outline_title, "AI outline");
  assert.equal(outline.sections.length, 1);
});

test("planner.generatePPT falls back when the AI request fails", async () => {
  const win = loadPlanner({ chat: async () => { throw new Error("offline"); } });
  const outline = await win.WetalkPlanner.generatePPT("Talk", "One paragraph.\n\nTwo paragraph.");
  assert.equal(outline.outline_title, "Talk");
  assert.ok(outline.sections.length >= 2);
});
