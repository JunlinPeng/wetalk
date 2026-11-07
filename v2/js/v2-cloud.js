/* ============================================================
   Wetalk v2 - cloud history sync (Supabase)

   Keeps the v2 "Previous Work" list in public.sessions for the
   signed-in account while localStorage["wetalk.v2.history"] stays
   the instant / offline cache.

   Cloud rows: public.sessions(id text PK, user_id uuid, mode text,
   title text, started_at timestamptz, payload jsonb). The payload is
   exactly one v2 session result object:
     { id, mode, modeLabel, title, startedAt (ms), scores, stats,
       criteria, tips, transcript, questions?, aiOverall?, ... }

   Contract (window.WetalkV2Cloud):
     enabled             -> boolean, live: configured + real session + client
     init()              -> Promise<item[]>  pull + merge into the cache
     onLocalChange(list) -> void             debounced upsert/delete mirror
     pull()              -> Promise<item[]>  rows -> items, newest first
     mergeLists(local, remote) -> item[]     pure merge (unit-tested)
     toRow(item, userId) -> row|null         pure mapping (unit-tested)
     fromRow(row) -> item|null               pure mapping (unit-tested)

   Merge rule: by id. A conflict goes to the local item when it carries AI
   feedback text the remote copy lacks (the user just received feedback for
   that session); otherwise the remote item wins. Newest startedAt first.

   Everything degrades to a no-op in Preview mode (no Supabase config)
   or while signed out (the synthetic "local-..." session id), and when
   the network fails or the page is offline: methods resolve empty lists /
   false and never reject. Tokens are never read or written here.
   ============================================================ */
(function (global) {
  "use strict";

  var HISTORY_KEY = "wetalk.v2.history";
  var TABLE_SESSIONS = "sessions";
  var DEBOUNCE_MS = 700;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Ids/signatures the cloud is believed to hold. init() primes this from the
  // pulled rows; when a local write happens before init() finished, the first
  // flush primes it from the local cache (so nothing is lost). Only new or
  // changed sessions are uploaded; ids that vanished from the list are deleted.
  var baseline = { primed: false, ids: {}, sigs: {} };
  var pendingTimer = null;
  var pendingList = null;
  var pendingDeletes = {}; // deletes that failed - retried on the next flush

  /* ---------- diagnostics ---------- */

  function log() {
    try {
      if (global.console && global.console.warn) {
        global.console.warn.apply(global.console, ["[WetalkV2Cloud]"].concat(
          Array.prototype.slice.call(arguments)
        ));
      }
    } catch (e) { /* diagnostics are optional */ }
  }

  /* ---------- auth / config ---------- */

  function publicConfig() {
    return global.WETALK_CONFIG || {};
  }

  function auth() {
    return global.WetalkAuth || null;
  }

  function configured() {
    var c = publicConfig();
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  }

  function getSession() {
    var a = auth();
    if (!a || typeof a.getSession !== "function") return null;
    try { return a.getSession() || null; } catch (e) { return null; }
  }

  function getClient() {
    var a = auth();
    if (!a || typeof a.getClient !== "function") return null;
    try { return a.getClient() || null; } catch (e) { return null; }
  }

  function isPreviewMode() {
    var a = auth();
    if (!a || typeof a.isPreviewMode !== "function") return false;
    try { return !!a.isPreviewMode(); } catch (e) { return false; }
  }

  // Real Supabase sessions cache the auth user id (a UUID); Preview-mode
  // accounts use synthetic "local-<hash>" ids and must never touch the cloud.
  function userId() {
    var session = getSession();
    var id = session && session.id != null ? String(session.id) : "";
    return UUID_RE.test(id) ? id : null;
  }

  function isEnabled() {
    return configured() && !isPreviewMode() && !!userId() && !!getClient();
  }

  /* ---------- local cache ---------- */

  function readLocal() {
    try {
      var raw = global.localStorage ? global.localStorage.getItem(HISTORY_KEY) : null;
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(list) {
    try {
      global.localStorage.setItem(HISTORY_KEY, JSON.stringify(Array.isArray(list) ? list : []));
      return true;
    } catch (e) {
      log("could not write the local history cache", e);
      return false;
    }
  }

  function signature(item) {
    try { return JSON.stringify(item); } catch (e) { return ""; }
  }

  /* ---------- row mapping (pure, unit-tested) ---------- */

  function hasText(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function hasAiFeedback(item) {
    if (!item || typeof item !== "object") return false;
    if (hasText(item.aiOverall)) return true;
    var questions = item.questions;
    if (!Array.isArray(questions)) return false;
    for (var i = 0; i < questions.length; i++) {
      if (questions[i] && hasText(questions[i].aiFeedback)) return true;
    }
    return false;
  }

  function toIsoStartedAt(value) {
    var ms = Number(value);
    if (!isFinite(ms) || ms <= 0) return null;
    var date = new Date(ms);
    if (isNaN(date.getTime())) return null;
    try { return date.toISOString(); } catch (e) { return null; }
  }

  // One v2 result item -> one public.sessions row. The payload column carries
  // the item verbatim, so every score/tip/transcript survives the round trip.
  function toRow(item, uid) {
    if (!item || typeof item !== "object" || item.id == null || item.id === "") return null;
    return {
      id: String(item.id),
      user_id: uid != null ? String(uid) : null,
      mode: item.mode ? String(item.mode) : "",
      title: item.title ? String(item.title) : "",
      started_at: toIsoStartedAt(item.startedAt),
      payload: item
    };
  }

  // public.sessions row -> v2 result item. The payload is authoritative; the
  // id/startedAt columns are only used as a fallback for hand-written rows.
  function fromRow(row) {
    if (!row || typeof row !== "object") return null;
    var payload = row.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

    var item = payload;
    var needsId = item.id == null || item.id === "";
    var startedMs = Number(item.startedAt);
    var needsStarted = !isFinite(startedMs) || startedMs <= 0;
    if (needsId || needsStarted) {
      item = {};
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) item[key] = payload[key];
      }
    }
    if (needsId && row.id != null && row.id !== "") item.id = String(row.id);
    if (needsStarted) {
      var parsed = row.started_at ? Date.parse(row.started_at) : NaN;
      item.startedAt = isNaN(parsed) ? 0 : parsed;
    }
    return item.id == null || item.id === "" ? null : item;
  }

  /* ---------- merge (pure, unit-tested) ---------- */

  // Union of both lists by id, newest first. On a conflict the remote item wins
  // unless the local copy holds AI feedback the remote one is missing (the user
  // may have received examiner feedback after the last upload).
  function mergeLists(localList, remoteList) {
    var remoteById = {};
    var i;
    for (i = 0; i < (remoteList || []).length; i++) {
      var remote = remoteList[i];
      if (!remote || remote.id == null || remote.id === "") continue;
      var remoteId = String(remote.id);
      if (!Object.prototype.hasOwnProperty.call(remoteById, remoteId)) {
        remoteById[remoteId] = remote;
      }
    }

    var merged = [];
    var seen = {};
    for (i = 0; i < (localList || []).length; i++) {
      var local = localList[i];
      if (!local || local.id == null || local.id === "") continue;
      var localId = String(local.id);
      if (seen[localId]) continue;
      seen[localId] = true;
      var match = remoteById[localId];
      if (!match) {
        merged.push(local);
      } else {
        merged.push(hasAiFeedback(local) && !hasAiFeedback(match) ? local : match);
        delete remoteById[localId];
      }
    }

    var remoteOnly = Object.keys(remoteById);
    for (i = 0; i < remoteOnly.length; i++) merged.push(remoteById[remoteOnly[i]]);

    merged.sort(function (a, b) {
      return (Number(b && b.startedAt) || 0) - (Number(a && a.startedAt) || 0);
    });
    return merged;
  }

  /* ---------- promise helpers ---------- */

  // Supabase query builders are thenables; wrapping keeps us tolerant of the
  // mocked plain promises / plain objects used in unit tests.
  function settle(query) {
    return Promise.resolve(query).catch(function (err) {
      return { data: null, error: err };
    });
  }

  /* ---------- cloud reads ---------- */

  function pull() {
    if (!isEnabled()) return Promise.resolve([]);
    var uid = userId();
    var sb = getClient();
    if (!sb || !uid) return Promise.resolve([]);

    var query;
    try {
      query = sb.from(TABLE_SESSIONS).select("*")
        .eq("user_id", uid)
        .order("started_at", { ascending: false });
    } catch (e) {
      log("pull could not start", e);
      return Promise.resolve([]);
    }

    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("pull failed", res && res.error);
        return [];
      }
      var rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
      var items = [];
      for (var i = 0; i < rows.length; i++) {
        var item = fromRow(rows[i]);
        if (item) items.push(item);
      }
      items.sort(function (a, b) {
        return (Number(b && b.startedAt) || 0) - (Number(a && a.startedAt) || 0);
      });
      return items;
    }).catch(function (err) {
      log("pull failed", err);
      return [];
    });
  }

  /* ---------- cloud writes ---------- */

  function collectState(items) {
    var ids = {};
    var sigs = {};
    for (var i = 0; i < (items || []).length; i++) {
      var item = items[i];
      if (!item || item.id == null || item.id === "") continue;
      var id = String(item.id);
      if (ids[id]) continue;
      ids[id] = true;
      sigs[id] = signature(item);
    }
    return { ids: ids, sigs: sigs };
  }

  function pushRows(sb, rows, attempted, onFail) {
    var query;
    try {
      query = sb.from(TABLE_SESSIONS).upsert(rows, { onConflict: "id" });
    } catch (e) {
      log("upsert could not start", e);
      if (onFail) onFail(attempted);
      return Promise.resolve(false);
    }
    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("upsert failed", res && res.error);
        if (onFail) onFail(attempted);
        return false;
      }
      return true;
    }).catch(function (err) {
      log("upsert failed", err);
      if (onFail) onFail(attempted);
      return false;
    });
  }

  function pushDelete(sb, uid, id, done) {
    var query;
    try {
      query = sb.from(TABLE_SESSIONS).delete()
        .eq("id", String(id))
        .eq("user_id", uid);
    } catch (e) {
      log("delete could not start", e);
      if (done) done(false);
      return Promise.resolve(false);
    }
    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("delete failed", res && res.error);
        if (done) done(false);
        return false;
      }
      if (done) done(true);
      return true;
    }).catch(function (err) {
      log("delete failed", err);
      if (done) done(false);
      return false;
    });
  }

  // Diff the given list against the baseline, then fire the upserts/deletes.
  // Never rejects; resolves true when every request settled without error.
  function flush(list) {
    try {
      if (!isEnabled()) return Promise.resolve(false);
      var uid = userId();
      var sb = getClient();
      if (!sb || !uid) return Promise.resolve(false);

      var items = Array.isArray(list) ? list : readLocal();
      var state = collectState(items);
      var id;
      var q;

      // A failed delete whose session came back (pull / undo) is no longer a
      // delete candidate: the local copy wins and is uploaded below.
      var pendingIds = Object.keys(pendingDeletes);
      for (q = 0; q < pendingIds.length; q++) {
        if (state.ids[pendingIds[q]]) delete pendingDeletes[pendingIds[q]];
      }

      var upserts = [];
      var attempted = {};
      var ids = Object.keys(state.ids);
      for (q = 0; q < ids.length; q++) {
        id = ids[q];
        if (baseline.ids[id] && baseline.sigs[id] === state.sigs[id]) continue;
        for (var j = 0; j < items.length; j++) {
          if (items[j] && String(items[j].id) === id) {
            var row = toRow(items[j], uid);
            if (row) { upserts.push(row); attempted[id] = state.sigs[id]; }
            break;
          }
        }
      }

      var deletes = [];
      var known = Object.keys(baseline.ids);
      for (q = 0; q < known.length; q++) {
        id = known[q];
        if (!state.ids[id] && deletes.indexOf(id) === -1) deletes.push(id);
      }
      var retry = Object.keys(pendingDeletes);
      for (q = 0; q < retry.length; q++) {
        if (deletes.indexOf(retry[q]) === -1 && !state.ids[retry[q]]) deletes.push(retry[q]);
      }

      // Update the in-memory baseline before the fire-and-forget requests so
      // overlapping flushes do not upload the same row twice. Failed uploads
      // drop their signature again so the next flush retries them.
      baseline = { primed: true, ids: state.ids, sigs: state.sigs };

      var work = [];
      if (upserts.length) {
        work.push(pushRows(sb, upserts, attempted, function (attemptedRows) {
          var failed = Object.keys(attemptedRows || {});
          for (var k = 0; k < failed.length; k++) {
            if (baseline.sigs[failed[k]] === attemptedRows[failed[k]]) {
              delete baseline.sigs[failed[k]];
            }
          }
        }));
      }
      for (q = 0; q < deletes.length; q++) {
        (function (deleteId) {
          work.push(pushDelete(sb, uid, deleteId, function (ok) {
            if (ok) delete pendingDeletes[deleteId];
            else pendingDeletes[deleteId] = true;
          }));
        })(deletes[q]);
      }
      if (!work.length) return Promise.resolve(true);
      return Promise.all(work).then(function (results) {
        for (var r = 0; r < results.length; r++) {
          if (results[r] === false) return false;
        }
        return true;
      }, function () { return false; });
    } catch (e) {
      log("sync flush failed", e);
      return Promise.resolve(false);
    }
  }

  /* ---------- public API ---------- */

  function primeBaseline(items) {
    var state = collectState(items || []);
    baseline = { primed: true, ids: state.ids, sigs: state.sigs };
  }

  // Pull the account's sessions, merge them into the local cache (newest first)
  // and resolve with the merged list. Never rejects; in Preview mode / signed
  // out / offline it resolves with the untouched local cache.
  function init() {
    if (!isEnabled()) return Promise.resolve(readLocal());
    return pull().then(function (remote) {
      var merged = mergeLists(readLocal(), remote);
      writeLocal(merged);
      primeBaseline(remote);
      return merged;
    }).catch(function (err) {
      log("init failed", err);
      return readLocal();
    });
  }

  // Mirror a local history write to the cloud after a short debounce. Purely
  // fire-and-forget: every failure is logged and retried on the next change.
  function onLocalChange(list) {
    try {
      if (!isEnabled()) return;
      pendingList = Array.isArray(list) ? list.slice() : readLocal();
      if (pendingTimer !== null) {
        try { global.clearTimeout(pendingTimer); } catch (e) { /* ignore */ }
      }
      pendingTimer = global.setTimeout(function () {
        pendingTimer = null;
        var queued = pendingList;
        pendingList = null;
        var pending = flush(queued);
        if (pending && typeof pending.catch === "function") pending.catch(function () {});
      }, DEBOUNCE_MS);
    } catch (e) {
      log("could not queue the history sync", e);
    }
  }

  // Test-only hook: cancel the debounce and flush the queued list right now.
  function flushNow() {
    var queued = pendingList;
    pendingList = null;
    if (pendingTimer !== null) {
      try { global.clearTimeout(pendingTimer); } catch (e) { /* ignore */ }
      pendingTimer = null;
    }
    if (queued === null) return Promise.resolve(false);
    return flush(queued);
  }

  var api = {
    init: init,
    onLocalChange: onLocalChange,
    pull: pull,
    mergeLists: mergeLists,
    toRow: toRow,
    fromRow: fromRow,
    _flushNow: flushNow
  };

  // "enabled" is a live boolean (recomputed on access), so the app can read it
  // synchronously without calling anything.
  try {
    Object.defineProperty(api, "enabled", {
      enumerable: true,
      get: function () { return isEnabled(); }
    });
  } catch (e) {
    api.enabled = false;
  }

  global.WetalkV2Cloud = api;
})(typeof window !== "undefined" ? window : this);
