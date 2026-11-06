/* ============================================================
   Wetalk — works store (previous scripts + schedules)

   Each "work" = { id, title, mode, speech, schedule, updatedAt }.
   Stored in localStorage (which the desktop app persists under
   %APPDATA%/Wetalk/web_profile), so works survive restarts.
   ============================================================ */
(function (global) {
  "use strict";

  function getWorks() {
    try { return JSON.parse(localStorage.getItem("wetalk.works") || "[]"); } catch (e) { return []; }
  }

  function saveWorks(list) {
    try { localStorage.setItem("wetalk.works", JSON.stringify(list)); } catch (e) {}
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
  }

  global.WetalkWorks = {
    getWorks: getWorks,
    archive: archive,
    resume: resume,
    remove: remove
  };
})(window);
