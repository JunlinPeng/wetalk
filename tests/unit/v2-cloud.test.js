/* ============================================================
   Unit tests: v2/js/v2-cloud.js - Supabase sessions sync

   The v2 "Previous Work" list lives in localStorage["wetalk.v2.history"]
   and is mirrored to public.sessions for the signed-in account. These
   tests load the shipped script into the fake window from
   tests/helpers/mock-browser.js and exercise:

   - the live `enabled` getter (config + real UUID session + client only),
     and that Preview mode / signed-out / no-client stays silent (no calls);
   - the pure helpers mergeLists / toRow / fromRow;
   - pull() mapping + ordering against a stub Supabase client;
   - init() pull -> merge -> cache write, never rejecting on errors;
   - onLocalChange() debounce, new/changed upsert diff and vanished-id
     deletes, plus retry behaviour after network failures.

   If v2/js/v2-cloud.js is missing the whole file is skipped (marked
   PENDING) so the suite stays green while the file is in flight.
   ============================================================ */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createWindow, loadScripts, siteFileExists } = require("../helpers/mock-browser");

const CLOUD_PRESENT = siteFileExists("v2/js/v2-cloud.js");
const MISSING_REASON = "PENDING: v2/js/v2-cloud.js has not landed yet";

const HISTORY_KEY = "wetalk.v2.history";
const USER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CONFIG = {
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "public-anon",
  aiProxyUrl: "",
  siteUrl: ""
};

/* ---------- fixtures ---------- */

function session(id, startedAt, extra) {
  const item = {
    id: id,
    mode: "impromptu",
    modeLabel: "Impromptu Speech",
    title: "Topic " + id,
    startedAt: startedAt,
    scores: { organization: 4, analysis: 3, delivery: 4, creativity: 3, overall: 3.5, max: 5 },
    stats: { wordCount: 120, wpm: 130, duration: 55, fillers: 2 },
    tips: [],
    transcript: "transcript " + id
  };
  return Object.assign(item, extra || {});
}

function aiSession(id, startedAt) {
  return session(id, startedAt, {
    aiOverall: "Strong, clear delivery.",
    questions: [
      { q: "Tell me about yourself.", label: "Introduction", scores: { overall: 4, max: 5 }, tips: [], transcript: "answer", aiFeedback: "Good answer." }
    ]
  });
}

/** Snapshot a value produced inside the vm sandbox as plain host data. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- stub Supabase client ---------- */

function createMockClient(options) {
  options = options || {};
  const calls = [];
  const state = {
    rows: options.rows || [],
    failPull: !!options.failPull,
    failUpsert: !!options.failUpsert,
    failDelete: !!options.failDelete,
    throwFrom: !!options.throwFrom
  };
  const client = {
    calls: calls,
    state: state,
    from(table) {
      calls.push({ op: "from", table: table });
      if (state.throwFrom) throw new Error("client unavailable");
      return {
        select(columns) {
          calls.push({ op: "select", table: table, columns: columns });
          return {
            eq(column, value) {
              calls.push({ op: "eq", column: column, value: value });
              return {
                order(orderColumn, opts) {
                  calls.push({ op: "order", column: orderColumn, ascending: opts && opts.ascending });
                  if (state.failPull) return Promise.reject(new Error("network down"));
                  return Promise.resolve({ data: state.rows, error: null });
                }
              };
            }
          };
        },
        upsert(rows, opts) {
          calls.push({ op: "upsert", table: table, rows: rows, options: opts });
          if (state.failUpsert) return Promise.reject(new Error("offline"));
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters = {};
          const chain = {
            eq(column, value) {
              filters[column] = value;
              return Object.keys(filters).length < 2 ? chain : settleDelete();
            }
          };
          function settleDelete() {
            calls.push({ op: "delete", table: table, filters: filters });
            if (state.failDelete) return Promise.reject(new Error("offline"));
            return Promise.resolve({ error: null });
          }
          return chain;
        }
      };
    }
  };
  return client;
}

/* ---------- loading the module ---------- */

function loadCloud(options) {
  options = options || {};
  const seed = {};
  if (Array.isArray(options.local)) seed[HISTORY_KEY] = JSON.stringify(options.local);
  const config = Object.prototype.hasOwnProperty.call(options, "config") ? options.config : CONFIG;
  const win = createWindow({ config: config, storageSeed: seed });
  const sessionValue = Object.prototype.hasOwnProperty.call(options, "session")
    ? options.session
    : { id: USER_ID, username: "qa", email: "qa@example.com" };
  win.WetalkAuth = {
    getSession: function () { return sessionValue; },
    getClient: function () { return options.client || null; },
    isPreviewMode: function () { return !!options.preview; }
  };
  loadScripts(win, ["v2/js/v2-cloud.js"]);
  return win;
}

function cacheOf(win) {
  return plain(JSON.parse(win.__storage.getItem(HISTORY_KEY) || "[]"));
}

function upsertsOf(client) {
  return client.calls.filter((call) => call.op === "upsert");
}

function deletesOf(client) {
  return client.calls.filter((call) => call.op === "delete");
}

/* ============================================================
   Module surface + the live `enabled` getter
   ============================================================ */

test("v2 cloud: module exists and exposes the sync API", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const win = loadCloud({ client: createMockClient() });
  const cloud = win.WetalkV2Cloud;
  assert.ok(cloud, "window.WetalkV2Cloud should exist");
  for (const name of ["init", "onLocalChange", "pull", "mergeLists", "toRow", "fromRow"]) {
    assert.equal(typeof cloud[name], "function", "WetalkV2Cloud." + name + " should be a function");
  }
  assert.equal(typeof cloud.enabled, "boolean", "WetalkV2Cloud.enabled should be a live boolean getter");
});

test("v2 cloud: enabled only with config + real UUID session + client", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const win = loadCloud({ client: createMockClient() });
  assert.equal(win.WetalkV2Cloud.enabled, true, "configured + UUID session + client = sync on");

  win.WetalkAuth.getSession = () => null;
  assert.equal(win.WetalkV2Cloud.enabled, false, "signed-out visitors must not sync");

  win.WetalkAuth.getSession = () => ({ id: "local-8fa3c1de", username: "demo" });
  assert.equal(win.WetalkV2Cloud.enabled, false, "Preview-mode synthetic session ids must not sync");

  win.WetalkAuth.getSession = () => ({ id: USER_ID, username: "qa" });
  win.WetalkAuth.getClient = () => null;
  assert.equal(win.WetalkV2Cloud.enabled, false, "no Supabase client = no sync");
});

test("v2 cloud: enabled is false when js/config.js is empty (Preview mode)", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const win = loadCloud({ config: {}, client: createMockClient() });
  assert.equal(win.WetalkV2Cloud.enabled, false);
});

test("v2 cloud: enabled is false when auth.js is not loaded", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const win = createWindow({ config: CONFIG });
  loadScripts(win, ["v2/js/v2-cloud.js"]);
  assert.equal(win.WetalkV2Cloud.enabled, false);
});

/* ============================================================
   Preview mode / signed out - no network calls at all
   ============================================================ */

test("v2 cloud: Preview mode makes every sync method a silent no-op", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient({ rows: [{ id: "remote", payload: session("remote", 1) }] });
  const win = loadCloud({ config: {}, client: client });
  const cloud = win.WetalkV2Cloud;

  assert.deepEqual(plain(await cloud.init()), [], "init resolves the (empty) local cache");
  assert.deepEqual(plain(await cloud.pull()), [], "pull resolves an empty list");
  cloud.onLocalChange([session("a", 1)]);
  assert.equal(await cloud._flushNow(), false, "debounced flush is a no-op");
  assert.equal(client.calls.length, 0, "Preview mode must never touch Supabase");
});

test("v2 cloud: signed-out visitors make every sync method a silent no-op", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient();
  const win = loadCloud({ client: client, session: null, local: [session("kept", 500)] });
  const cloud = win.WetalkV2Cloud;

  assert.deepEqual(plain(await cloud.init()).map((item) => item.id), ["kept"], "init keeps the local cache");
  assert.deepEqual(plain(await cloud.pull()), []);
  cloud.onLocalChange([session("kept", 500)]);
  assert.equal(await cloud._flushNow(), false);
  assert.equal(client.calls.length, 0, "signed-out visitors must never touch Supabase");
});

test("v2 cloud: Preview-mode session ids are never uploaded", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient();
  const win = loadCloud({
    session: { id: "local-1234abcd", username: "demo" },
    client: client
  });
  win.WetalkV2Cloud.onLocalChange([session("a", 1000)]);
  assert.equal(await win.WetalkV2Cloud._flushNow(), false);
  assert.equal(client.calls.length, 0);
});

/* ============================================================
   mergeLists - pure merge (single source of truth for the cache)
   ============================================================ */

test("v2 cloud: mergeLists unions by id, newest startedAt first", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const cloud = loadCloud({ client: createMockClient() }).WetalkV2Cloud;
  const merged = plain(cloud.mergeLists(
    [session("old", 1000), session("shared", 3000, { title: "local shared" })],
    [session("remote", 4000), session("shared", 2000, { title: "remote shared" })]
  ));

  assert.deepEqual(merged.map((item) => item.id), ["remote", "shared", "old"]);
  assert.equal(merged[1].title, "remote shared", "the remote copy wins a plain conflict");
});

test("v2 cloud: mergeLists prefers a local copy that has AI feedback", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const cloud = loadCloud({ client: createMockClient() }).WetalkV2Cloud;

  const overall = plain(cloud.mergeLists(
    [aiSession("s1", 100)],
    [session("s1", 100)]
  ));
  assert.equal(overall[0].aiOverall, "Strong, clear delivery.", "local overall AI feedback must survive the pull");

  const perQuestion = plain(cloud.mergeLists(
    [session("s2", 100, { questions: [{ q: "Q", aiFeedback: "Nice answer." }] })],
    [session("s2", 100, { questions: [{ q: "Q", aiFeedback: null }] })]
  ));
  assert.equal(perQuestion[0].questions[0].aiFeedback, "Nice answer.", "local question feedback must survive the pull");
});

test("v2 cloud: mergeLists prefers the remote copy otherwise (incl. both-with-feedback tie)", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const cloud = loadCloud({ client: createMockClient() }).WetalkV2Cloud;

  const remoteHasFeedback = plain(cloud.mergeLists(
    [session("s1", 100)],
    [aiSession("s1", 100)]
  ));
  assert.equal(remoteHasFeedback[0].aiOverall, "Strong, clear delivery.");

  const bothHaveFeedback = plain(cloud.mergeLists(
    [session("s2", 100, { aiOverall: "local feedback" })],
    [session("s2", 100, { aiOverall: "remote feedback" })]
  ));
  assert.equal(bothHaveFeedback[0].aiOverall, "remote feedback", "ties are documented to keep the remote copy");
});

test("v2 cloud: mergeLists ignores invalid/duplicate entries and does not mutate inputs", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const cloud = loadCloud({ client: createMockClient() }).WetalkV2Cloud;
  const local = [null, { title: "no id" }, session("dup", 100, { title: "first" }), session("dup", 200, { title: "second" })];
  const remote = [null, { id: "" }, { id: "remote", title: "remote only", startedAt: 500 }];
  const localBefore = JSON.stringify(local);
  const remoteBefore = JSON.stringify(remote);

  const merged = plain(cloud.mergeLists(local, remote));
  assert.deepEqual(merged.map((item) => item.id), ["remote", "dup"]);
  assert.equal(merged[1].title, "first", "duplicate local ids collapse to the first entry");
  assert.equal(JSON.stringify(local), localBefore, "mergeLists must not mutate the local list");
  assert.equal(JSON.stringify(remote), remoteBefore, "mergeLists must not mutate the remote list");
});

/* ============================================================
   Row mapping - pure helpers
   ============================================================ */

test("v2 cloud: toRow maps columns and keeps the payload verbatim", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const cloud = loadCloud({ client: createMockClient() }).WetalkV2Cloud;
  const item = aiSession("w1", Date.UTC(2026, 0, 2, 3, 4, 5));
  const row = cloud.toRow(item, USER_ID);

  assert.equal(row.id, "w1");
  assert.equal(row.user_id, USER_ID);
  assert.equal(row.mode, "impromptu");
  assert.equal(row.title, "Topic w1");
  assert.equal(row.started_at, new Date(item.startedAt).toISOString());
  assert.equal(row.payload, item, "payload must be the item itself (no copy / no token fields)");
  assert.deepEqual(Object.keys(plain(row)).sort(), ["id", "mode", "payload", "started_at", "title", "user_id"]);

  assert.equal(cloud.toRow({}, USER_ID), null, "items without an id cannot be rowed");
  assert.equal(cloud.toRow(null, USER_ID), null);
  assert.equal(cloud.toRow(session("w2", NaN), USER_ID).started_at, null, "invalid startedAt -> null column");
  assert.equal(cloud.toRow(session("w3", 0), USER_ID).started_at, null);
});

test("v2 cloud: fromRow uses the payload and falls back to the row columns", { skip: !CLOUD_PRESENT && MISSING_REASON }, () => {
  const cloud = loadCloud({ client: createMockClient() }).WetalkV2Cloud;
  const item = aiSession("w1", 1234567890);

  const same = cloud.fromRow({ id: "w1", started_at: new Date(item.startedAt).toISOString(), payload: item });
  assert.deepEqual(plain(same), plain(item), "a complete payload round-trips exactly");

  const patched = cloud.fromRow({
    id: "row-id",
    started_at: new Date(5000).toISOString(),
    payload: { mode: "toefl", title: "No id or date in the payload" }
  });
  assert.equal(patched.id, "row-id", "payload without id falls back to the row id");
  assert.equal(patched.startedAt, 5000, "payload without startedAt falls back to started_at");
  assert.equal(patched.title, "No id or date in the payload");

  assert.equal(cloud.fromRow(null), null);
  assert.equal(cloud.fromRow({ id: "x", payload: null }), null);
  assert.equal(cloud.fromRow({ id: "x", payload: "not-an-object" }), null);
  assert.equal(cloud.fromRow({ started_at: new Date(1).toISOString(), payload: {} }), null,
    "no id anywhere means the row is ignored instead of poisoning the list");
});

/* ============================================================
   pull()
   ============================================================ */

test("v2 cloud: pull reads the caller's rows newest-first and maps payloads", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient({
    rows: [
      { id: "b", started_at: new Date(1000).toISOString(), payload: session("b", 1000) },
      { id: "a", started_at: new Date(2000).toISOString(), payload: session("a", 2000) }
    ]
  });
  const cloud = loadCloud({ client: client }).WetalkV2Cloud;
  const items = plain(await cloud.pull());

  assert.deepEqual(items.map((item) => item.id), ["a", "b"], "newest startedAt first");
  assert.equal(items[0].title, "Topic a");
  assert.equal(client.calls[0].table, "sessions", "pull reads public.sessions");
  const userFilter = client.calls.find((call) => call.op === "eq");
  assert.deepEqual(plain(userFilter), { op: "eq", column: "user_id", value: USER_ID }, "the query is scoped to the signed-in user");
  const order = client.calls.find((call) => call.op === "order");
  assert.equal(order.column, "started_at");
  assert.equal(order.ascending, false);
});

test("v2 cloud: pull resolves [] instead of rejecting on network errors", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const warn = console.warn;
  console.warn = () => {}; // expected diagnostic log
  try {
    const win = loadCloud({ client: createMockClient({ failPull: true }) });
    assert.deepEqual(plain(await win.WetalkV2Cloud.pull()), []);
    assert.deepEqual(plain(await win.WetalkV2Cloud.init()), []);
  } finally {
    console.warn = warn;
  }
});

/* ============================================================
   init()
   ============================================================ */

test("v2 cloud: init pulls, merges and writes the local cache (no writes)", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient({
    rows: [{ id: "remote-1", started_at: new Date(1000).toISOString(), payload: session("remote-1", 1000) }]
  });
  const win = loadCloud({ client: client, local: [session("local-only", 3000)] });
  const cloud = win.WetalkV2Cloud;

  const merged = plain(await cloud.init());
  assert.deepEqual(merged.map((item) => item.id), ["local-only", "remote-1"]);
  assert.deepEqual(cacheOf(win).map((item) => item.id), ["local-only", "remote-1"], "the merged list becomes the cache");
  assert.equal(upsertsOf(client).length, 0, "init only reads - the next local change uploads the delta");
});

test("v2 cloud: init never rejects - broken client / offline keeps the cache", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const offline = loadCloud({ client: createMockClient({ failPull: true }), local: [session("kept", 500)] });
    assert.deepEqual(plain(await offline.WetalkV2Cloud.init()).map((item) => item.id), ["kept"]);

    const broken = loadCloud({ client: createMockClient({ throwFrom: true }) });
    assert.deepEqual(plain(await broken.WetalkV2Cloud.init()), []);

    const noClient = loadCloud({ client: null });
    assert.deepEqual(plain(await noClient.WetalkV2Cloud.init()), []);
  } finally {
    console.warn = warn;
  }
});

/* ============================================================
   onLocalChange() - debounce + upsert/delete diff
   ============================================================ */

test("v2 cloud: onLocalChange debounces (~700ms) and coalesces writes", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient();
  const win = loadCloud({ client: client });
  const cloud = win.WetalkV2Cloud;

  cloud.onLocalChange([session("a", 1000)]);
  cloud.onLocalChange([session("a", 1000), session("b", 900)]);
  assert.equal(upsertsOf(client).length, 0, "no network call while the debounce is pending");

  await delay(850);
  const upserts = upsertsOf(client);
  assert.equal(upserts.length, 1, "one coalesced upsert after the debounce");
  assert.deepEqual(plain(upserts[0].rows.map((row) => row.id)).sort(), ["a", "b"]);
});

test("v2 cloud: onLocalChange upserts new rows, skips unchanged and deletes vanished ids", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient();
  const win = loadCloud({ client: client });
  const cloud = win.WetalkV2Cloud;
  const first = session("a", 2000);
  const second = session("b", 1000);

  cloud.onLocalChange([first, second]);
  assert.equal(await cloud._flushNow(), true);
  let upserts = upsertsOf(client);
  assert.equal(upserts.length, 1, "the first flush primes the baseline and uploads both sessions");
  assert.deepEqual(plain(upserts[0].rows.map((row) => row.id)).sort(), ["a", "b"]);
  assert.deepEqual(plain(upserts[0].options), { onConflict: "id" }, "upsert conflicts on the text primary key");
  for (const row of upserts[0].rows) {
    assert.equal(row.user_id, USER_ID, "every row carries the signed-in user id");
    assert.ok(row.payload && row.payload.id === row.id, "payload stays the session item");
  }

  client.calls.length = 0;
  cloud.onLocalChange([second]);
  assert.equal(await cloud._flushNow(), true);
  assert.equal(upsertsOf(client).length, 0, "unchanged sessions are not uploaded again");
  const deletes = deletesOf(client);
  assert.equal(deletes.length, 1, "the id that vanished from the list is deleted from the cloud");
  assert.deepEqual(plain(deletes[0].filters), { id: "a", user_id: USER_ID });
});

test("v2 cloud: onLocalChange re-uploads a session when AI feedback lands", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient();
  const win = loadCloud({ client: client });
  const cloud = win.WetalkV2Cloud;
  const before = session("a", 1000);

  cloud.onLocalChange([before]);
  await cloud._flushNow();

  client.calls.length = 0;
  const withAi = aiSession("a", 1000);
  cloud.onLocalChange([withAi]);
  await cloud._flushNow();
  let upserts = upsertsOf(client);
  assert.equal(upserts.length, 1, "the AI reply changed the session payload");
  assert.equal(upserts[0].rows[0].payload.aiOverall, "Strong, clear delivery.");

  client.calls.length = 0;
  cloud.onLocalChange([withAi]);
  await cloud._flushNow();
  assert.equal(upsertsOf(client).length, 0, "an identical list is a no-op");
});

test("v2 cloud: clearing history deletes every cloud row", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const client = createMockClient();
  const win = loadCloud({ client: client });
  const cloud = win.WetalkV2Cloud;

  cloud.onLocalChange([session("a", 2000), session("b", 1000)]);
  await cloud._flushNow();
  client.calls.length = 0;

  cloud.onLocalChange([]);
  await cloud._flushNow();
  const deletes = deletesOf(client);
  assert.equal(deletes.length, 2);
  assert.deepEqual(plain(deletes.map((call) => call.filters.id)).sort(), ["a", "b"]);
});

/* ============================================================
   Failure handling - never throws, retries on the next change
   ============================================================ */

test("v2 cloud: failed uploads are retried on the next local change", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const client = createMockClient({ failUpsert: true });
    const win = loadCloud({ client: client });
    const cloud = win.WetalkV2Cloud;
    const item = session("a", 1000);

    cloud.onLocalChange([item]);
    assert.equal(await cloud._flushNow(), false, "a failed upload resolves false instead of throwing");
    assert.equal(upsertsOf(client).length, 1);

    client.state.failUpsert = false;
    client.calls.length = 0;
    cloud.onLocalChange([item]);
    assert.equal(await cloud._flushNow(), true, "the retry succeeds once the network is back");
    assert.equal(upsertsOf(client).length, 1, "the previously failed row is attempted again");
  } finally {
    console.warn = warn;
  }
});

test("v2 cloud: failed deletes stay queued and are retried", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const client = createMockClient({ failDelete: true });
    const win = loadCloud({ client: client });
    const cloud = win.WetalkV2Cloud;

    cloud.onLocalChange([session("a", 1000)]);
    await cloud._flushNow();
    assert.equal(deletesOf(client).length, 0);

    client.state.failDelete = true;
    cloud.onLocalChange([]);
    assert.equal(await cloud._flushNow(), false, "the delete failure does not throw");
    assert.equal(deletesOf(client).length, 1);

    client.state.failDelete = false;
    client.calls.length = 0;
    cloud.onLocalChange([]);
    assert.equal(await cloud._flushNow(), true);
    assert.equal(deletesOf(client).length, 1, "the queued delete is retried");
    assert.equal(deletesOf(client)[0].filters.id, "a");
  } finally {
    console.warn = warn;
  }
});

test("v2 cloud: a broken/missing Supabase client degrades to a no-op, never throws", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const client = createMockClient();
    client.from = () => { throw new Error("client broke"); };
    const win = loadCloud({ client: client });
    const cloud = win.WetalkV2Cloud;

    assert.equal(cloud.enabled, true);
    assert.deepEqual(plain(await cloud.pull()), []);
    cloud.onLocalChange([session("a", 1000)]);
    assert.equal(await cloud._flushNow(), false);
  } finally {
    console.warn = warn;
  }
});

test("v2 cloud: preview/disabled modes never write to localStorage cache", { skip: !CLOUD_PRESENT && MISSING_REASON }, async () => {
  const win = loadCloud({ config: {}, client: createMockClient() });
  assert.equal(win.__storage.getItem(HISTORY_KEY), null, "the module does not create the cache on its own");
  await win.WetalkV2Cloud.init();
  assert.equal(win.__storage.getItem(HISTORY_KEY), null);
});
