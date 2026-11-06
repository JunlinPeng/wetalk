/* ============================================================
   Wetalk - works store (previous scripts + schedules)

   Each "work" = { id, title, mode, speech, schedule, updatedAt }.
   Stored in localStorage (which the desktop app persists under
   %APPDATA%/Wetalk/web_profile), so works survive restarts.

   Cloud sync (js/store.js): when the visitor is signed in to a
   configured Supabase project, archive/remove fire-and-forget to
   the cloud and refresh() pulls+merges remote rows. Every change
   dispatches a "wetalk:works" event so lists can re-render.

   The sync path is intentionally fire-and-forget: a failed network
   call must never break the offline flow or surface an unhandled
   promise rejection.
   ============================================================ */
(function (global) {
  "use strict";

  var WORKS_KEY = "wetalk.works";
  var CHANGE_EVENT = "wetalk:works";

  function getStore() {
    return global.WetalkStore || null;
  }

  function readWorks() {
    try {
      var list = JSON.parse(global.localStorage.getItem(WORKS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeWorks(list) {
    try {
      global.localStorage.setItem(WORKS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch (e) { /* storage full or blocked - keep going */ }
  }

  function dispatchChange() {
    var detail = { works: readWorks() };
    try {
      if (typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent(CHANGE_EVENT, { detail: detail }));
      } else if (typeof global.Event === "function") {
        var ev = new global.Event(CHANGE_EVENT);
        global.dispatchEvent(ev);
      }
    } catch (e) { /* listeners are optional */ }
  }

  // getWorks() must stay synchronous + cached: every page reads it at load.
  function getWorks() {
    return readWorks();
  }

  function saveWorks(list) {
    writeWorks(list);
    dispatchChange();
  }

  function newId() {
    return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Snapshot the current working state (topic + speech + schedule).
  function snapshot() {
    var draft = {};
    var speech = "";
    var schedule = null;
    try { draft = JSON.parse(localStorage.getItem("wetalk.topicDraft") || "null") || {}; } catch (e) {}
    try { speech = localStorage.getItem("wetalk.speechDraft") || ""; } catch (e) {}
    try { schedule = JSON.parse(localStorage.getItem("wetalk.schedule") || "null"); } catch (e) {}
    return { title: draft.topic || "", mode: draft.mode || "ai", speech: speech, schedule: schedule };
  }

  function pushToCloud(work) {
    var store = getStore();
    if (!store || typeof store.pushWork !== "function") return;
    try {
      var p = store.pushWork(work);
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) { /* offline is fine */ }
  }

  function deleteFromCloud(id) {
    var store = getStore();
    if (!store || typeof store.deleteWork !== "function") return;
    try {
      var p = store.deleteWork(id);
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) { /* offline is fine */ }
  }

  // Save the current work into the works list (upsert by title).
  function archive() {
    var s = snapshot();
    if (!s.title && !s.speech) return null;
    var list = getWorks();
    var existing = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].title === s.title) { existing = list[i]; break; }
    }
    var work = {
      id: existing ? existing.id : newId(),
      title: s.title,
      mode: s.mode,
      speech: s.speech,
      schedule: s.schedule,
      updatedAt: Date.now()
    };
    if (existing) list.splice(list.indexOf(existing), 1);
    list.unshift(work);
    saveWorks(list);
    pushToCloud(work);
    return work;
  }

  // Restore a work into the current working state.
  function resume(work) {
    try {
      localStorage.setItem("wetalk.topicDraft", JSON.stringify({ topic: work.title, mode: work.mode || "ai" }));
    } catch (e) {}
    try { localStorage.setItem("wetalk.speechDraft", work.speech || ""); } catch (e) {}
    try {
      if (work.schedule) localStorage.setItem("wetalk.schedule", JSON.stringify(work.schedule));
      else localStorage.removeItem("wetalk.schedule");
    } catch (e) {}
  }

  function remove(id) {
    saveWorks(getWorks().filter(function (w) { return w.id !== id; }));
    deleteFromCloud(id);
  }

  // Pull the cloud rows, merge with the cache (store.js does the merge),
  // and notify listeners. Never rejects; resolves with the cached list when
  // the cloud is unavailable (Preview mode, signed out, offline).
  function refresh() {
    var store = getStore();
    if (!store || typeof store.pullWorks !== "function") {
      return Promise.resolve(getWorks());
    }
    var pending;
    try {
      pending = store.pullWorks();
    } catch (e) {
      return Promise.resolve(getWorks());
    }
    return Promise.resolve(pending).then(function (merged) {
      if (Array.isArray(merged)) dispatchChange();
      return getWorks();
    }).catch(function () {
      return getWorks();
    });
  }

  // If auth.js signals a sign-in / sign-out / token refresh, re-pull once.
  // Pages may also listen for "wetalk:works" themselves.
  function hookAuth() {
    var auth = global.WetalkAuth;
    if (!auth || typeof auth.onChange !== "function") return;
    try {
      auth.onChange(function () { refresh(); });
    } catch (e) { /* auth.js is optional on static pages */ }
  }

  global.WetalkWorks = {
    getWorks: getWorks,
    archive: archive,
    resume: resume,
    remove: remove,
    refresh: refresh
  };

  hookAuth();
})(typeof window !== "undefined" ? window : this);
