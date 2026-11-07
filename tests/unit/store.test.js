/* ============================================================
   Unit tests: js/store.js - cloud/local works sync

   The merge is pure logic (no network): WetalkStore.mergeWorks
   decides which rows win and which need pushing. The Supabase-
   backed helpers are tested through stub clients to prove they
   never reject and degrade to a no-op in Preview mode.

   If js/store.js is missing the whole file is skipped (marked
   PENDING) so the suite stays green while the data workstream is
   still landing the module.
   ============================================================ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindow, loadScripts, loadSource, siteFileExists } = require("../helpers/mock-browser");

const STORE_PRESENT = siteFileExists("js/store.js");
const STORE_MISSING_REASON =
  "PENDING: js/store.js has not landed yet (data workstream) - see docs/ARCHITECTURE.md";

// Do not load the real js/config.js (it points at the live Supabase project):
// stub the public runtime config so the Preview-mode behaviour is deterministic.
const PREVIEW_CONFIG_SOURCE = [
  "/* unit-test stub of js/config.js - empty values mean Preview mode */",
  "window.WETALK_CONFIG = { supabaseUrl: '', supabaseAnonKey: '', aiProxyUrl: '', siteUrl: '' };",
].join("\n");

function loadStore(options) {
  const win = createWindow(options);
  loadSource(win, PREVIEW_CONFIG_SOURCE, "unit-stub-config.js");
  loadScripts(win, ["js/store.js"]);
  return win;
}

/** Preview mode: empty config, no auth -> store disabled. */
function loadPreview() {
  const win = createWindow();
  loadSource(win, PREVIEW_CONFIG_SOURCE, "unit-stub-config.js");
  loadScripts(win, ["js/auth.js", "js/store.js"]);
  return win;
}

/** Pretend Supabase is configured and a session/client exists. */
function enableCloud(win, client) {
  win.WETALK_CONFIG = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-anon", aiProxyUrl: "", siteUrl: "" };
  win.WetalkAuth = {
    getSession: () => ({ id: "user-1", username: "qa", email: "qa@example.com" }),
    getClient: () => client,
    onChange: () => {},
  };
  return win;
}

function work(id, title, updatedAt) {
  return { id, title, mode: "ai", speech: title + " speech", schedule: null, updatedAt };
}

test("store: module exists and exposes sync API", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const win = loadStore();
  const store = win.WetalkStore;
  assert.ok(store, "window.WetalkStore should exist");
  for (const name of ["mergeWorks", "ready", "pullWorks", "pushWork", "deleteWork", "getProfile", "updateProfile"]) {
    assert.equal(typeof store[name], "function", "WetalkStore." + name + " should be a function");
  }
  assert.equal(typeof store.enabled, "boolean", "WetalkStore.enabled should be a boolean getter");
});

test("store: disabled in Preview mode (empty config)", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, async () => {
  const win = loadPreview();
  const store = win.WetalkStore;
  assert.equal(store.enabled, false, "Preview mode must not try to sync");
  assert.equal(await store.ready(), false);
  assert.equal(await store.pullWorks(), null);
  assert.equal(await store.pushWork(work("w1", "x", 1)), false);
  assert.equal(await store.deleteWork("w1"), false);
  assert.equal(await store.getProfile(), null);
  const updated = await store.updateProfile({ username: "new-name" });
  assert.equal(updated.ok, false, "profile update should fail cleanly when cloud is disabled");
  assert.equal(typeof updated.error, "string");
});

test("store: enabled flips on when config + session + client exist", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const win = enableCloud(loadPreview(), { from: () => ({}) });
  assert.equal(win.WetalkStore.enabled, true);
});

// ---------------------------------------------------------------
// mergeWorks - pure merge logic
// ---------------------------------------------------------------
test("store.mergeWorks keeps local-only works and marks them for push", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const local = [work("a", "local only", 500)];
  const result = store.mergeWorks(local, []);

  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].id, "a");
  assert.equal(result.merged[0].title, "local only");
  assert.deepEqual(JSON.parse(JSON.stringify(result.toPush)).map((w) => w.id), ["a"]);
});

test("store.mergeWorks adopts remote-only works", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const result = store.mergeWorks([], [
    { id: "r1", title: "remote only", mode: "ai", speech: "remote speech", schedule: { days: 2 }, updated_at: new Date(4000).toISOString() },
  ]);

  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].id, "r1");
  assert.equal(result.merged[0].title, "remote only");
  assert.equal(result.merged[0].updatedAt, 4000, "updated_at ISO should map to updatedAt ms");
  assert.deepEqual(JSON.parse(JSON.stringify(result.toPush)), [], "remote rows are not pushed back");
});

test("store.mergeWorks: newer local row wins and is pushed", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const result = store.mergeWorks(
    [work("shared", "local newer", 9000)],
    [{ id: "shared", title: "remote older", updated_at: new Date(8000).toISOString() }]
  );

  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].title, "local newer");
  assert.equal(result.merged[0].updatedAt, 9000);
  assert.deepEqual(JSON.parse(JSON.stringify(result.toPush)).map((w) => w.id), ["shared"]);
});

test("store.mergeWorks: newer remote row wins and is not pushed", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const result = store.mergeWorks(
    [work("shared", "local older", 8000)],
    [{ id: "shared", title: "remote newer", updated_at: new Date(9000).toISOString() }]
  );

  assert.equal(result.merged[0].title, "remote newer");
  assert.equal(result.merged[0].updatedAt, 9000);
  assert.deepEqual(JSON.parse(JSON.stringify(result.toPush)), [], "remote-newer rows need no upload");
});

test("store.mergeWorks: ties keep the remote row (documented tie-break)", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const result = store.mergeWorks(
    [work("tie", "local tie", 7000)],
    [{ id: "tie", title: "remote tie", updated_at: new Date(7000).toISOString() }]
  );
  assert.equal(result.merged[0].title, "remote tie");
  assert.deepEqual(JSON.parse(JSON.stringify(result.toPush)), []);
});

test("store.mergeWorks sorts by updatedAt descending", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const result = store.mergeWorks(
    [work("old", "old", 100), work("newest", "newest", 5000)],
    [{ id: "middle", title: "middle", updated_at: new Date(2000).toISOString() }]
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result.merged)).map((w) => w.id), ["newest", "middle", "old"]);
});

test("store.mergeWorks ignores invalid rows and duplicate local ids", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, () => {
  const store = loadStore().WetalkStore;
  const result = store.mergeWorks(
    [work("a", "first", 1), work("a", "duplicate", 2)],
    [{ title: "no id" }, null, { id: "remote", title: "valid remote", updated_at: new Date(3).toISOString() }]
  );
  assert.equal(result.merged.length, 2);
  assert.equal(result.merged[0].id, "remote");
  assert.ok(result.merged.filter((w) => w.id === "a").length === 1, "duplicate local ids should collapse");
});

// ---------------------------------------------------------------
// Sync helpers never reject
// ---------------------------------------------------------------
test("store: pullWorks merges remote rows into the local cache", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(table);
      return {
        select() {
          return {
            eq(column, value) {
              calls.push(column + "=" + value);
              return {
                order: async () => ({
                  data: [
                    { id: "remote-1", title: "From cloud", mode: "ai", speech: "cloud speech", schedule: null, updated_at: new Date(5000).toISOString() },
                  ],
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const win = enableCloud(loadPreview(), client);
  const merged = await win.WetalkStore.pullWorks();

  assert.ok(Array.isArray(merged), "pullWorks should resolve with the merged list");
  assert.equal(merged[0].id, "remote-1");
  assert.deepEqual(JSON.parse(win.__storage.getItem("wetalk.works")).map((w) => w.id), ["remote-1"]);
  assert.ok(calls.includes("works"), "pullWorks should query the works table");
  assert.ok(calls.includes("user_id=user-1"), "pullWorks should scope the query to the signed-in user");
});

test("store: pullWorks resolves null instead of rejecting on network errors", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, async () => {
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({ order: () => Promise.reject(new Error("network down")) }),
        }),
      };
    },
  };
  const win = enableCloud(loadPreview(), client);
  const warning = console.warn;
  console.warn = () => {}; // expected diagnostic log
  try {
    assert.equal(await win.WetalkStore.pullWorks(), null);
  } finally {
    console.warn = warning;
  }
});

test("store: pushWork upserts the work row for the signed-in user", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, async () => {
  let upserted = null;
  const client = {
    from(table) {
      return {
        upsert(row) {
          upserted = { table, row };
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  const win = enableCloud(loadPreview(), client);
  const ok = await win.WetalkStore.pushWork(work("w9", "Cloud work", 12345));

  assert.equal(ok, true);
  assert.equal(upserted.table, "works");
  assert.equal(upserted.row.id, "w9");
  assert.equal(upserted.row.user_id, "user-1");
  assert.equal(upserted.row.title, "Cloud work");
});

test("store: deleteWork scopes the delete to the signed-in user", { skip: !STORE_PRESENT && STORE_MISSING_REASON }, async () => {
  const filters = [];
  const client = {
    from() {
      return {
        delete() {
          return {
            eq(column, value) {
              filters.push(column + "=" + value);
              return { eq: (c2, v2) => { filters.push(c2 + "=" + v2); return Promise.resolve({ error: null }); } };
            },
          };
        },
      };
    },
  };
  const win = enableCloud(loadPreview(), client);
  assert.equal(await win.WetalkStore.deleteWork("w9"), true);
  assert.deepEqual(filters, ["id=w9", "user_id=user-1"]);
});
