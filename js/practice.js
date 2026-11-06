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

  // ---- offline heuristic scoring (used when no AI is connected/reachable) ----
  function countMatches(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
  }

  function heuristicScores(transcript, wpm) {
    var text = String(transcript || "").toLowerCase();
    var words = text.split(/\s+/).filter(Boolean);
    var wordCount = words.length;
    var unique = {};
    for (var i = 0; i < words.length; i++) {
      var k = words[i].replace(/[^a-z0-9'-]/g, "");
      if (k) unique[k] = true;
    }
    var variety = wordCount ? Object.keys(unique).length / wordCount : 0;
    var transitions = countMatches(text, /\b(first|second|third|next|then|finally|however|therefore|because|for example|in conclusion|to sum up|another|moreover|also|as a result|on the other hand)\b/g);
    var reasoning = countMatches(text, /\b(because|therefore|since|so that|evidence|research|study|statistic|percent|reason|result|which means|this shows)\b/g);
    var fillers = countMatches(text, /\b(um|uh|er|like|you know|kind of|sort of|basically|actually)\b/g);
    var questions = countMatches(text, /\?/g);

    function score(base) { return Math.max(1, Math.min(10, Math.round(base))); }

    var orgScore = score(4.2 + Math.min(3.6, transitions * 0.75) + (wordCount >= 60 ? 1 : 0));
    var anaScore = score(4.2 + Math.min(3.6, reasoning * 0.8) + (variety >= 0.5 ? 0.8 : 0));
    var deliveryScore = 5;
    if (wpm >= 120 && wpm <= 165) deliveryScore += 2.6;
    else if (wpm >= 95 && wpm < 120) deliveryScore += 1.2;
    else if (wpm > 165 && wpm <= 200) deliveryScore += 0.9;
    deliveryScore -= Math.min(2.4, fillers * 0.4);
    deliveryScore = score(deliveryScore);
    var creaScore = score(4.2 + (variety >= 0.6 ? 1.4 : 0) + Math.min(1.8, questions * 0.6) + (wordCount >= 80 ? 0.8 : 0));

    var orgFb = transitions >= 3
      ? "Clear signposting (" + transitions + " linking words) - your structure is easy to follow."
      : "Add explicit signposting: 'first', 'next', 'finally', 'because of this'. Try one per main point.";
    var anaFb = reasoning >= 3
      ? "Good reasoning language (" + reasoning + " support words). Keep backing every claim with a concrete example."
      : "Support each point with a reason or example: say 'because...' or 'for example...' at least once per body point.";
    var deliveryFb = wpm <= 0
      ? "Pace not measured - try a longer answer next time."
      : (wpm < 95 ? "Your pace is about " + wpm + " wpm - a little slow. Aim for 120-160 wpm to sound engaged."
        : wpm > 200 ? "Your pace is about " + wpm + " wpm - fast. Pause after key sentences so points land."
        : "Your pace is about " + wpm + " wpm - a comfortable conversational speed.");
    if (fillers > 2) deliveryFb += " Trim filler words ('um', 'like') - " + fillers + " spotted.";
    var creaFb = variety >= 0.6
      ? "Good vocabulary variety - your wording stays fresh."
      : "Vary your wording more; repetition makes a speech feel flat. Swap repeated words for stronger synonyms.";
    if (questions > 0) creaFb += " The rhetorical question is a nice hook.";

    var scores = { organization: orgScore, analysis: anaScore, delivery: deliveryScore, creativity: creaScore };
    var order = ["organization", "analysis", "delivery", "creativity"];
    var lowestKey = "organization";
    for (var j = 1; j < order.length; j++) {
      if (scores[order[j]] < scores[lowestKey]) lowestKey = order[j];
    }
    var names = { organization: "organisation", analysis: "analysis", delivery: "delivery", creativity: "creativity" };

    return {
      local: true,
      organization: { score: orgScore, feedback: orgFb },
      analysis: { score: anaScore, feedback: anaFb },
      delivery: { score: deliveryScore, feedback: deliveryFb },
      creativity: { score: creaScore, feedback: creaFb },
      overall_feedback: "This is an instant local estimate (no AI connected). Lowest area: " +
        names[lowestKey] + " (" + scores[lowestKey] + "/10) - work on that first. Connect AI in the speech step for examiner-level coaching."
    };
  }

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
      : "Pace not measured - practice aloud for at least 30 seconds for a pace reading.";
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
    // Only trust the pace when the run was long enough to be meaningful
    // (a click-through or a 2-second run would otherwise show a wild wpm).
    var reliablePace = state.elapsed >= 15 && words.length >= 15;
    var wpm = (reliablePace && state.elapsed > 0) ? Math.round(words.length / (state.elapsed / 60)) : 0;

    var needsProvider = global.WetalkLLM && WetalkLLM.hasConfig ? WetalkLLM.hasConfig() : false;
    // A failed AI call must never dead-end the practice flow: fall back to the
    // local heuristic so every user still gets scores and advice.
    var aiPromise = needsProvider
      ? evaluateSpeech(state.segment, transcript).catch(function () { return heuristicScores(transcript, wpm); })
      : Promise.resolve(heuristicScores(transcript, wpm));

    aiPromise.then(function (ai) {
      renderResults(ai, wpm);
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
