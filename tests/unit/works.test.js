/* ============================================================
   Unit tests: js/works.js - works list API
   (getWorks / archive / resume / remove)

   Contract: docs/ARCHITECTURE.md -> WetalkWorks.
   ============================================================ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindow, loadScripts } = require("../helpers/mock-browser");

function loadWorks(storageSeed) {
  const win = createWindow({ storageSeed });
  loadScripts(win, ["js/works.js"]);
  return win;
}

function seedDraft(win, topic, speech, mode, schedule) {
  win.__storage.setItem("wetalk.topicDraft", JSON.stringify({ topic: topic, mode: mode || "ai" }));
  win.__storage.setItem("wetalk.speechDraft", speech || "");
  if (schedule) win.__storage.setItem("wetalk.schedule", JSON.stringify(schedule));
}

test("works: exposes the API the pages depend on", () => {
  const win = loadWorks();
  assert.ok(win.WetalkWorks, "window.WetalkWorks should exist");
  for (const name of ["getWorks", "archive", "resume", "remove"]) {
    assert.equal(typeof win.WetalkWorks[name], "function", "WetalkWorks." + name + " should be a function");
  }
});

test("works: getWorks returns an empty list by default", () => {
  assert.deepEqual(Array.from(loadWorks().WetalkWorks.getWorks()), []);
});

test("works: getWorks tolerates corrupt storage", () => {
  const win = loadWorks({ "wetalk.works": "{not valid json" });
  assert.deepEqual(Array.from(win.WetalkWorks.getWorks()), [], "corrupt JSON should degrade to an empty list");
});

test("works: archive snapshots the current draft", () => {
  const win = loadWorks();
  const schedule = { days: [{ day: 1, tasks: ["Practice"] }] };
  seedDraft(win, "Climate change", "Hello world.\n\nSecond paragraph.", "ai", schedule);

  const work = win.WetalkWorks.archive();

  assert.ok(work, "archive should return the new work");
  assert.match(String(work.id), /^w/, "work ids should start with w");
  assert.equal(work.title, "Climate change");
  assert.equal(work.mode, "ai");
  assert.equal(work.speech, "Hello world.\n\nSecond paragraph.");
  assert.deepEqual(JSON.parse(JSON.stringify(work.schedule)), schedule);
  assert.equal(typeof work.updatedAt, "number");
  assert.equal(win.WetalkWorks.getWorks().length, 1, "the work should be persisted");

  const stored = JSON.parse(win.__storage.getItem("wetalk.works"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, work.id);
});

test("works: archive returns null when there is nothing to save", () => {
  const win = loadWorks();
  assert.equal(win.WetalkWorks.archive(), null, "empty draft should not create a work");
  assert.equal(win.WetalkWorks.getWorks().length, 0);
});

test("works: archive upserts by title instead of duplicating", () => {
  const win = loadWorks();
  seedDraft(win, "Same title", "first version", "ai");
  const first = win.WetalkWorks.archive();

  win.__storage.setItem("wetalk.speechDraft", "second version");
  const second = win.WetalkWorks.archive();

  const list = win.WetalkWorks.getWorks();
  assert.equal(list.length, 1, "the same title should update the existing work, not add a second");
  assert.equal(second.id, first.id, "the id should be stable across updates");
  assert.equal(list[0].speech, "second version");
  assert.ok(second.updatedAt >= first.updatedAt, "updatedAt should move forward");
});

test("works: most recent work comes first", () => {
  const win = loadWorks();
  seedDraft(win, "Topic A", "a", "ai");
  const a = win.WetalkWorks.archive();
  seedDraft(win, "Topic B", "b", "ai");
  const b = win.WetalkWorks.archive();

  const list = win.WetalkWorks.getWorks();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id, "newest work should be first");
  assert.equal(list[1].id, a.id);
});

test("works: remove deletes only the requested work", () => {
  const win = loadWorks();
  seedDraft(win, "Keep me", "keep", "ai");
  const keep = win.WetalkWorks.archive();
  seedDraft(win, "Delete me", "delete", "ai");
  const drop = win.WetalkWorks.archive();
  assert.equal(win.WetalkWorks.getWorks().length, 2);

  win.WetalkWorks.remove(drop.id);

  const list = win.WetalkWorks.getWorks();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, keep.id);
});

test("works: resume restores drafts and schedule into localStorage", () => {
  const win = loadWorks();
  const work = {
    id: "w1",
    title: "Resumed topic",
    mode: "manual",
    speech: "Restored speech",
    schedule: { days: [{ day: 1, tasks: ["Read aloud"] }] },
    updatedAt: Date.now(),
  };

  win.WetalkWorks.resume(work);

  assert.deepEqual(JSON.parse(win.__storage.getItem("wetalk.topicDraft")), {
    topic: "Resumed topic",
    mode: "manual",
  });
  assert.equal(win.__storage.getItem("wetalk.speechDraft"), "Restored speech");
  assert.deepEqual(JSON.parse(win.__storage.getItem("wetalk.schedule")), work.schedule);
});

test("works: resume without a schedule clears the previous schedule", () => {
  const win = loadWorks({ "wetalk.schedule": JSON.stringify({ days: [{ day: 1 }] }) });
  win.WetalkWorks.resume({ id: "w2", title: "No schedule", mode: "ai", speech: "text", updatedAt: 1 });
  assert.equal(win.__storage.getItem("wetalk.schedule"), null, "stale schedule should be removed");
});

test("works: archive keeps an empty speech but a real title", () => {
  const win = loadWorks();
  win.__storage.setItem("wetalk.topicDraft", JSON.stringify({ topic: "Title only", mode: "ai" }));
  const work = win.WetalkWorks.archive();
  assert.ok(work, "a title alone is enough to archive");
  assert.equal(work.speech, "");
});
