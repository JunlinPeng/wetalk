/* ============================================================
   Wetalk - cloud store (profile + works sync)

   Keeps localStorage["wetalk.works"] as the offline cache and,
   when Supabase is configured AND a real session exists, syncs
   the cached works with public.works in Supabase.

   Merge rule: by work id, keep the row with the newest updatedAt.
   - local-only or local-newer  -> push to Supabase
   - remote-only or remote-newer -> adopt into the local cache
   Ties keep the remote row (no extra write).

   Everything degrades to a no-op in Preview mode (no config, no
   session, auth.js not loaded) or when the network fails: the
   methods resolve to null/false and never reject.

   API (all safe to call at any time):
     enabled            -> boolean, sync is live right now
     ready()            -> Promise<boolean>
     pullWorks()        -> Promise<Work[]|null>
     pushWork(work)     -> Promise<boolean>
     deleteWork(id)     -> Promise<boolean>
     getProfile()       -> Promise<profile|null>
     updateProfile(p)   -> Promise<{ ok, profile?, error? }>

   Work = { id, title, mode, speech, schedule, updatedAt }
   ============================================================ */
(function (global) {
  "use strict";

  var WORKS_KEY = "wetalk.works";
  var TABLE_WORKS = "works";
  var TABLE_PROFILES = "profiles";
  var PROFILE_FIELDS = ["username", "email"];
  var READY_TIMEOUT_MS = 1500;
  var READY_POLL_MS = 120;

  function log() {
    try {
      if (global.console && global.console.warn) {
        global.console.warn.apply(global.console, ["[WetalkStore]"].concat(
          Array.prototype.slice.call(arguments)
        ));
      }
    } catch (e) { /* ignore */ }
  }

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

  function authReadyForCloud() {
    var a = auth();
    return !!(a && typeof a.getClient === "function");
  }

  function getSession() {
    var a = auth();
    if (!a || typeof a.getSession !== "function") return null;
    try { return a.getSession() || null; } catch (e) { return null; }
  }

  function userId() {
    var s = getSession();
    return (s && typeof s.id === "string" && s.id) ? s.id : null;
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

  function isEnabled() {
    // Preview auth sessions carry a synthetic id; only real Supabase sessions
    // with a live client may touch the cloud.
    return configured() && !isPreviewMode() && !!userId() && !!getClient();
  }

  /* ---------- local cache ---------- */

  function readLocal() {
    try {
      var raw = global.localStorage ? global.localStorage.getItem(WORKS_KEY) : null;
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(list) {
    try {
      global.localStorage.setItem(WORKS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch (e) {
      log("could not write the local works cache", e);
    }
  }

  /* ---------- row mapping ---------- */

  function toWork(row) {
    if (!row || !row.id) return null;
    var t = row.updated_at ? Date.parse(row.updated_at) : 0;
    return {
      id: String(row.id),
      title: row.title || "",
      mode: row.mode || "ai",
      speech: row.speech || "",
      schedule: row.schedule || null,
      updatedAt: isNaN(t) ? 0 : t
    };
  }

  function toRow(work, uid) {
    return {
      id: String(work.id),
      user_id: uid,
      title: work.title || "",
      mode: work.mode || "ai",
      speech: work.speech || "",
      schedule: work.schedule || null,
      updated_at: new Date(Number(work.updatedAt) || Date.now()).toISOString()
    };
  }

  /* ---------- merge (pure, unit-testable) ---------- */

  function mergeWorks(localList, remoteRows) {
    var remoteById = {};
    var i;
    for (i = 0; i < (remoteRows || []).length; i++) {
      var rw = toWork(remoteRows[i]);
      if (rw) remoteById[rw.id] = rw;
    }

    var merged = [];
    var toPush = [];
    var seen = {};

    for (i = 0; i < (localList || []).length; i++) {
      var lw = localList[i];
      if (!lw || !lw.id || seen[lw.id]) continue;
      seen[lw.id] = true;
      var lUpdated = Number(lw.updatedAt) || 0;
      var remote = remoteById[lw.id];
      if (!remote) {
        merged.push(lw);
        toPush.push(lw);
      } else {
        var rUpdated = Number(remote.updatedAt) || 0;
        if (lUpdated > rUpdated) {
          merged.push(lw);
          toPush.push(lw);
        } else {
          merged.push(remote);
        }
        delete remoteById[lw.id];
      }
    }

    var remoteIds = Object.keys(remoteById);
    for (i = 0; i < remoteIds.length; i++) {
      merged.push(remoteById[remoteIds[i]]);
    }

    merged.sort(function (a, b) {
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });

    return { merged: merged, toPush: toPush };
  }

  /* ---------- promise helpers ---------- */

  function settle(query) {
    // Supabase query builders are thenables; wrapping keeps us tolerant of
    // mocks (plain promises / plain objects) used in tests.
    return Promise.resolve(query).catch(function (err) {
      return { data: null, error: err };
    });
  }

  /* ---------- public API ---------- */

  function ready() {
    if (isEnabled()) return Promise.resolve(true);
    if (!configured() || !authReadyForCloud()) return Promise.resolve(false);

    // auth.js may still be hydrating the Supabase client / session.
    var started = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        if (isEnabled()) return resolve(true);
        if (Date.now() - started >= READY_TIMEOUT_MS) return resolve(false);
        global.setTimeout(tick, READY_POLL_MS);
      })();
    });
  }

  function pullWorks() {
    if (!isEnabled()) return Promise.resolve(null);
    var uid = userId();
    var sb = getClient();
    if (!sb || !uid) return Promise.resolve(null);

    var query;
    try {
      query = sb.from(TABLE_WORKS).select("*").eq("user_id", uid).order("updated_at", { ascending: false });
    } catch (e) {
      log("pullWorks could not start", e);
      return Promise.resolve(null);
    }

    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("pullWorks failed", res && res.error);
        return null;
      }
      var local = readLocal();
      var merged = mergeWorks(local, res.data || []);
      writeLocal(merged.merged);
      // Push local-only / local-newer works back to the cloud.
      for (var i = 0; i < merged.toPush.length; i++) pushWork(merged.toPush[i]);
      return merged.merged;
    }).catch(function (err) {
      log("pullWorks failed", err);
      return null;
    });
  }

  function pushWork(work) {
    if (!work || !work.id || !isEnabled()) return Promise.resolve(false);
    var uid = userId();
    var sb = getClient();
    if (!sb || !uid) return Promise.resolve(false);

    var row = toRow(work, uid);
    var query;
    try {
      query = sb.from(TABLE_WORKS).upsert(row, { onConflict: "id" });
    } catch (e) {
      log("pushWork could not start", e);
      return Promise.resolve(false);
    }

    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("pushWork failed", res && res.error);
        return false;
      }
      return true;
    });
  }

  function deleteWork(id) {
    if (!id || !isEnabled()) return Promise.resolve(false);
    var uid = userId();
    var sb = getClient();
    if (!sb || !uid) return Promise.resolve(false);

    var query;
    try {
      query = sb.from(TABLE_WORKS).delete().eq("id", String(id)).eq("user_id", uid);
    } catch (e) {
      log("deleteWork could not start", e);
      return Promise.resolve(false);
    }

    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("deleteWork failed", res && res.error);
        return false;
      }
      return true;
    });
  }

  function getProfile() {
    if (!isEnabled()) return Promise.resolve(null);
    var uid = userId();
    var sb = getClient();
    if (!sb || !uid) return Promise.resolve(null);

    var query;
    try {
      query = sb.from(TABLE_PROFILES).select("*").eq("id", uid).limit(1);
    } catch (e) {
      log("getProfile could not start", e);
      return Promise.resolve(null);
    }

    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("getProfile failed", res && res.error);
        return null;
      }
      var rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
      return rows.length ? rows[0] : null;
    });
  }

  function updateProfile(patch) {
    if (!isEnabled()) return Promise.resolve({ ok: false, error: "Cloud sync is not enabled." });
    var uid = userId();
    var sb = getClient();
    if (!sb || !uid) return Promise.resolve({ ok: false, error: "Cloud sync is not enabled." });
    if (!patch || typeof patch !== "object") {
      return Promise.resolve({ ok: false, error: "Nothing to update." });
    }

    var row = {};
    var hasField = false;
    for (var i = 0; i < PROFILE_FIELDS.length; i++) {
      var key = PROFILE_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        row[key] = patch[key];
        hasField = true;
      }
    }
    if (!hasField) return Promise.resolve({ ok: false, error: "Nothing to update." });

    var query;
    try {
      query = sb.from(TABLE_PROFILES).update(row).eq("id", uid).select();
    } catch (e) {
      log("updateProfile could not start", e);
      return Promise.resolve({ ok: false, error: "Could not update the profile." });
    }

    return settle(query).then(function (res) {
      if (!res || res.error) {
        log("updateProfile failed", res && res.error);
        var msg = (res && res.error && (res.error.message || res.error.details)) || "Could not update the profile.";
        return { ok: false, error: msg };
      }
      var rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
      return { ok: true, profile: rows.length ? rows[0] : null };
    });
  }

  var api = {
    mergeWorks: mergeWorks,
    ready: ready,
    pullWorks: pullWorks,
    pushWork: pushWork,
    deleteWork: deleteWork,
    getProfile: getProfile,
    updateProfile: updateProfile
  };

  // "enabled" is a live boolean (recomputed on access), so pages can read it
  // synchronously without calling anything.
  try {
    Object.defineProperty(api, "enabled", {
      enumerable: true,
      get: function () { return isEnabled(); }
    });
  } catch (e) {
    api.enabled = false;
  }

  global.WetalkStore = api;
})(typeof window !== "undefined" ? window : this);
