/* ============================================================
   Wetalk — practice session (text + AI coaching, no camera)

   Robust, camera-free flow:
   1. Practice your segment aloud with a timer.
   2. Type what you actually said (or use your script).
   3. The AI scores it on the same four aspects as the impromptu
      part — Organization, Analysis, Delivery, Creativity — with
      practical, specific feedback, with speaking pace computed automatically.
   ============================================================ */
(function (global) {
  "use strict";

  var CRITERIA = [
    { key: "organization", name: "Organization" },
    { key: "analysis", name: "Analysis" },
    { key: "delivery", name: "Delivery" },
    { key: "creativity", name: "Creativity" }
  ];

  var state = {
    segment: "",
    title: "",
    elapsed: 0,
    startedAt: 0,
    tickId: null
  };

  function $(id) { return document.getElementById(id); }

  function setStage(s) {
    ["setup", "record", "evaluating", "results"].forEach(function (st) {
      var el = $("stage-" + st);
      if (el) el.style.display = st === s ? "" : "none";
    });
  }

  function toast(m) { if (global.WetalkAuth && WetalkAuth.toast) WetalkAuth.toast(m); }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem("wetalk.topicDraft") || "null") || {};
      state.title = d.topic || "";
    } catch (e) {}
    try {
      var s = JSON.parse(localStorage.getItem("wetalk.schedule") || "null");
      if (s && s.days && s.days.length) state.segment = s.days[0].script_segment || "";
    } catch (e) {}
    if (!state.segment) {
      try { state.segment = localStorage.getItem("wetalk.speechDraft") || ""; } catch (e) {}
    }
    if (state.segment && state.segment.length > 800) state.segment = state.segment.slice(0, 800);
  }

  function evaluateSpeech(segment, transcript) {
    var system = "You are an expert public-speaking coach. Evaluate a student's speech honestly but supportively. For each of the four criteria — Organization, Analysis, Delivery, Creativity — give a score from 1 to 10 and 1-2 sentences of specific, actionable feedback that will genuinely help them improve. Point to exactly what to change and how.";
    var user =
      "The student was asked to deliver this part of their speech:\n---\n" + (segment || "(no script segment)") + "\n---\n\n" +
      "Here is what the student actually said:\n---\n" + (transcript || "(not provided)") + "\n---\n\n" +
      "Return ONLY valid JSON (no markdown):\n" +
      "{\n" +
      "  \"organization\": {\"score\": 0, \"feedback\": \"...\"},\n" +
      "  \"analysis\": {\"score\": 0, \"feedback\": \"...\"},\n" +
      "  \"delivery\": {\"score\": 0, \"feedback\": \"...\"},\n" +
      "  \"creativity\": {\"score\": 0, \"feedback\": \"...\"},\n" +
      "  \"overall_feedback\": \"1-2 sentences naming the single most important thing to fix next.\"\n" +
      "}";

    return WetalkLLM.chat([
      { role: "system", content: system },
      { role: "user", content: user }
    ], { max_tokens: 1200 }).then(function (text) {
      var obj = WetalkPlanner.extractJSON(text);
      if (obj && (obj.organization || obj.overall_feedback)) return obj;
      throw new Error("Could not parse AI evaluation.");
    });
  }

  function renderResults(ai, wpm) {
    var alist = $("aiScores");
    alist.innerHTML = "";
    CRITERIA.forEach(function (c) {
      var sc = (ai && ai[c.key]) ? ai[c.key] : { score: 5, feedback: "" };
      var score = clamp(Math.round(Number(sc.score) || 5), 1, 10);
      var row = document.createElement("div");
      row.className = "criteria";
      row.innerHTML =
        '<div class="criteria__head"><span class="criteria__name">' + c.name + '</span><span class="criteria__score">' + score + '/10</span></div>' +
        '<div class="criteria__bar"><span style="width:' + (score * 10) + '%"></span></div>' +
        '<p class="criteria__fb">' + escapeHtml(sc.feedback || "") + '</p>';
      alist.appendChild(row);
    });

    $("overallFeedback").textContent = (ai && ai.overall_feedback) ? ai.overall_feedback : "";

    $("paceInfo").textContent = wpm > 0
      ? ("You wrote " + Math.round(wpm * (state.elapsed / 60)) + " words in about " + fmt(state.elapsed) + " (~" + wpm + " wpm). " + (wpm < 110 ? "A bit slow — pick up the pace for energy." : wpm > 170 ? "A bit fast — slow down so each point lands." : "Good conversational pace."))
      : "Pace unavailable (not enough words captured).";
  }

  // ---- flow ----
  function init() {
    loadDraft();
    $("segmentSummary").textContent = state.segment ? state.segment : "No segment — practice your full speech.";
    $("startBtn").onclick = startPractice;
    $("useScriptBtn").onclick = useScript;
    $("finishBtn").onclick = finishAndEvaluate;
    $("againBtn").onclick = function () { location.reload(); };
    $("backBtn").onclick = function () { location.href = "schedule.html"; };
    setStage("setup");
  }

  function startPractice() {
    setStage("record");
    state.startedAt = Date.now();
    state.tickId = setInterval(function () {
      state.elapsed = (Date.now() - state.startedAt) / 1000;
      $("timer").textContent = fmt(state.elapsed);
    }, 500);
  }

  function useScript() {
    $("spokenText").value = state.segment;
    toast("Using your script as what you said.");
  }

  function finishAndEvaluate() {
    clearInterval(state.tickId);
    state.elapsed = (Date.now() - state.startedAt) / 1000;

    var spoken = $("spokenText").value.trim();
    var transcript = spoken || state.segment;

    setStage("evaluating");

    var words = transcript.split(/\s+/).filter(Boolean);
    var wpm = state.elapsed > 0 ? Math.round(words.length / (state.elapsed / 60)) : 0;

    var needsProvider = global.WetalkLLM && WetalkLLM.hasConfig ? WetalkLLM.hasConfig() : false;
    var aiPromise = needsProvider
      ? evaluateSpeech(state.segment, transcript).catch(function () { return null; })
      : Promise.resolve(null);

    aiPromise.then(function (ai) {
      renderResults(ai, wpm);
      if (!ai) {
        $("overallFeedback").textContent = "Connect an AI provider (in the speech step) to get AI scores and feedback.";
      }
      // practical tips
      var tips = [];
      if (ai) {
        var lowest = null, lowScore = 11;
        CRITERIA.forEach(function (c) {
          var sc = ai[c.key] ? Number(ai[c.key].score) : 5;
          if (sc < lowScore) { lowScore = sc; lowest = c.name; }
        });
        if (lowScore < 7) tips.push("Focus next round: " + lowest + " (" + lowScore + "/10).");
      }
      if (!tips.length) tips.push("Solid effort — keep practicing to lock it in.");
      var tipList = $("tipList");
      tipList.innerHTML = "";
      tips.forEach(function (t) {
        var li = document.createElement("li");
        li.textContent = t;
        tipList.appendChild(li);
      });
      setStage("results");
    });
  }

  global.WetalkPractice = { init: init };
})(window);
