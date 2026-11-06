/* ============================================================
   Wetalk — Impromptu Speech Evaluator (imported & rethemed)

   Recreates the desktop Impromptu Speech Evaluator's round flow:
     draw 3 topics -> choose 1 -> 7:00 combined prep+speech timer
     (30s grace) -> record -> evaluate on 4 criteria -> adaptive tips.

   AI transcription/scoring still need a backend, so the result step
   uses a lightweight client-side heuristic and is marked "preview".
   ============================================================ */
(function (global) {
  "use strict";

  var TOTAL_SECONDS = 420; // 7:00 combined prep + speech (NSDA rule)
  var GRACE_SECONDS = 30;  // 30-second grace period

  var CATEGORY_LABELS = {
    quotation: "Quotation",
    proverb: "Proverb",
    abstract_word: "Abstract Word",
    object: "Object",
    event: "Event",
    famous_person: "Famous Person",
    phrase: "Phrase",
    current_event: "Current Event"
  };

  var CATEGORY_TIPS = {
    quotation: "For quotations: explain what it means, why the author said it, and whether it still applies today.",
    proverb: "For proverbs: challenge whether the proverb is always true. Find exceptions and explore nuance.",
    abstract_word: "For abstract words: anchor them with concrete examples. Show, don't just tell.",
    object: "For objects: use them as metaphors. What does this object represent in society?",
    event: "For events: focus on the 'why' and 'so what' — not just what happened, but why it matters now.",
    famous_person: "For people: go beyond biography. What idea or value does this person represent?",
    phrase: "For phrases: unpack each word. What assumptions are embedded in this common saying?",
    current_event: "For current events: present multiple perspectives. Avoid one-sided arguments."
  };

  var CRITERIA = [
    { key: "organization", name: "Organization" },
    { key: "analysis", name: "Analysis" },
    { key: "delivery", name: "Delivery" },
    { key: "creativity", name: "Creativity" }
  ];

  var state = {
    stage: "draw",
    topics: [],
    selected: null,
    elapsed: 0,
    running: false,
    phase: "prep",      // prep | speaking | grace | finished
    startedAt: 0,
    tickId: null,
    fired: {},
    transcript: "",
    recognition: null,
    mediaRecorder: null
  };

  function $(id) { return document.getElementById(id); }

  function setStage(s) {
    state.stage = s;
    ["draw", "round", "evaluating", "results"].forEach(function (st) {
      var el = $("stage-" + st);
      if (el) el.style.display = st === s ? "" : "none";
    });
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function announce(msg) {
    if (global.WetalkAuth && WetalkAuth.toast) WetalkAuth.toast(msg);
  }

  // ---------- Topic draw ----------
  function pickTopics(count) {
    var pool = (global.WETALK_TOPICS || []).slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    var chosen = [];
    var usedCat = {};
    for (var k = 0; k < pool.length && chosen.length < count; k++) {
      var t = pool[k];
      if (!usedCat[t.category]) { usedCat[t.category] = true; chosen.push(t); }
    }
    for (var m = 0; m < pool.length && chosen.length < count; m++) {
      if (chosen.indexOf(pool[m]) === -1) chosen.push(pool[m]);
    }
    return chosen;
  }

  function drawTopics() {
    state.topics = pickTopics(3);
    var wrap = $("topicCards");
    wrap.innerHTML = "";
    state.topics.forEach(function (t, idx) {
      var btn = document.createElement("button");
      btn.className = "topic-card";
      btn.innerHTML =
        '<span class="topic-card__cat">' + (CATEGORY_LABELS[t.category] || t.category) + '</span>' +
        '<span class="topic-card__text">' + escapeHtml(t.text) + '</span>';
      btn.onclick = function () { selectTopic(idx); };
      wrap.appendChild(btn);
    });
    $("topicCards").style.display = "";
    $("drawBtn").style.display = "none";
  }

  function selectTopic(idx) {
    state.selected = state.topics[idx];
    $("chosenTopic").textContent = state.selected.text;
    $("chosenTopicCat").textContent = CATEGORY_LABELS[state.selected.category] || "";
    setStage("round");
    resetTimer();
  }

  // ---------- Timer ----------
  function resetTimer() {
    stopTicker();
    state.elapsed = 0;
    state.phase = "prep";
    state.fired = {};
    state.running = false;
    updateTimerDisplay();
    $("btnStartPrep").style.display = "";
    $("btnStartSpeaking").style.display = "none";
    $("btnStop").style.display = "none";
    stopRecording();
  }

  function startTicker() {
    stopTicker();
    state.tickId = setInterval(tick, 100);
  }

  function stopTicker() {
    if (state.tickId) { clearInterval(state.tickId); state.tickId = null; }
  }

  function startPrep() {
    if (state.running) return;
    state.running = true;
    state.startedAt = Date.now();
    startTicker();
    $("btnStartPrep").style.display = "none";
    $("btnStartSpeaking").style.display = "";
    $("btnStop").style.display = "";
  }

  function startSpeaking() {
    state.phase = "speaking";
    $("btnStartSpeaking").style.display = "none";
    updateTimerDisplay();
    startRecording();
  }

  function stopRound() {
    state.running = false;
    stopTicker();
    finishRound();
  }

  function tick() {
    if (!state.running) return;
    state.elapsed = (Date.now() - state.startedAt) / 1000;
    var remaining = TOTAL_SECONDS - state.elapsed;

    if (remaining <= 0) {
      state.phase = "grace";
    }
    if (state.elapsed > TOTAL_SECONDS + GRACE_SECONDS) {
      state.phase = "finished";
      stopTicker();
      finishRound();
      return;
    }

    fireMilestones(remaining);
    updateTimerDisplay();
  }

  function fireMilestones(remaining) {
    var keys = [300, 60, 30, 10, 5, 0];
    var labels = { 300: "5:00 remaining", 60: "1:00 remaining", 30: "30 seconds", 10: "10 seconds", 5: "5 seconds", 0: "Time's up — 30-second grace" };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (remaining <= k && !state.fired[k]) {
        state.fired[k] = true;
        announce(labels[k]);
      }
    }
  }

  function updateTimerDisplay() {
    var remaining = TOTAL_SECONDS - state.elapsed;
    var label;
    if (state.phase === "finished") {
      label = "0:00";
    } else if (remaining > 0) {
      label = fmt(remaining);
    } else {
      label = "+" + fmt(Math.abs(remaining));
    }
    $("timerDisplay").textContent = label;

    var phaseText = { prep: "Preparation", speaking: "Speaking", grace: "Grace Period", finished: "Finished" }[state.phase];
    $("phaseLabel").textContent = phaseText || "Preparation";
  }

  // ---------- Recording (optional, progressive enhancement) ----------
  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mr = new MediaRecorder(stream);
      state.mediaRecorder = mr;
      mr.ondataavailable = function (e) { if (e.data && e.data.size) { /* captured locally */ } };
      mr.start();
      startRecognition();
    }).catch(function () { /* mic denied — continue without recording */ });
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      try { state.mediaRecorder.stop(); } catch (e) {}
    }
    stopRecognition();
  }

  function startRecognition() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) return;
    try {
      var rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = function (e) {
        var txt = "";
        for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        state.transcript = txt;
      };
      rec.start();
      state.recognition = rec;
    } catch (e) {}
  }

  function stopRecognition() {
    if (state.recognition) { try { state.recognition.stop(); } catch (e) {} state.recognition = null; }
  }

  // ---------- Evaluation (demo heuristic — AI backend comes next) ----------
  function finishRound() {
    stopRecording();
    setStage("evaluating");
    setTimeout(function () {
      var result = evaluate();
      renderResults(result);
      setStage("results");
    }, 1100);
  }

  function clamp(n) { return Math.max(1, Math.min(10, Math.round(n))); }

  function evaluate() {
    var text = (state.transcript || "").trim();
    var words = text ? text.split(/\s+/) : [];
    var wc = words.length;
    var wpm = state.elapsed > 0 ? (wc / state.elapsed) * 60 : 0;

    var org = clamp(5 + (wc > 40 ? 1 : 0) + (/first|second|next|finally|in conclusion|however|therefore/i.test(text) ? 2 : 0) + (text.length > 250 ? 1 : 0));
    var ana = clamp(5 + (wc > 60 ? 1 : 0) + (/for example|because|imagine|evidence|this shows|research/i.test(text) ? 2 : 0));
    var del = clamp(wpm >= 100 && wpm <= 170 ? 7 : (wpm > 0 ? 5 : 6));
    var cre = clamp(5 + (/imagine|what if|metaphor|unlike|instead|perhaps/i.test(text) ? 2 : 0) + (wc > 20 && (new Set(words).size / wc) > 0.5 ? 1 : 0));

    var feedback = {
      organization: org >= 8 ? "Clear, well-structured with strong transitions." : org >= 6 ? "Solid structure — add clearer transitions between points." : "Build a clearer intro → body → conclusion structure.",
      analysis: ana >= 8 ? "Sharp analysis with concrete support." : ana >= 6 ? "Good analysis — back each point with a concrete example." : "Deepen analysis with specific examples and reasoning.",
      delivery: del >= 8 ? "Confident, well-paced delivery." : del >= 6 ? "Good pacing — smooth out any rushed sections." : "Slow down and pace your delivery for clarity.",
      creativity: cre >= 8 ? "Creative, original framing that stands out." : cre >= 6 ? "Nice ideas — try a more unexpected angle or hook." : "Experiment with a fresher, more original approach."
    };

    return {
      scores: { organization: org, analysis: ana, delivery: del, creativity: cre },
      overall: Math.round((org + ana + del + cre) / 4),
      feedback: feedback,
      wpm: Math.round(wpm),
      wordCount: wc,
      hasTranscript: wc > 0,
      category: state.selected ? state.selected.category : null
    };
  }

  function renderResults(res) {
    var wrap = $("criteriaList");
    wrap.innerHTML = "";
    CRITERIA.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "criteria";
      row.innerHTML =
        '<div class="criteria__head">' +
          '<span class="criteria__name">' + c.name + '</span>' +
          '<span class="criteria__score">' + res.scores[c.key] + '/10</span>' +
        '</div>' +
        '<div class="criteria__bar"><span style="width:' + (res.scores[c.key] * 10) + '%"></span></div>' +
        '<p class="criteria__fb">' + res.feedback[c.key] + '</p>';
      wrap.appendChild(row);
    });

    $("overallScore").textContent = res.overall + "/10";
    $("overallBar").style.width = (res.overall * 10) + "%";
    $("resultMeta").textContent = (res.hasTranscript ? res.wordCount + " words · ~" + res.wpm + " wpm" : "No live transcript captured") + " · demo preview";

    renderTips(res);
  }

  function renderTips(res) {
    var tips = [];
    var weakest = CRITERIA[0].key;
    var weakestVal = 10;
    CRITERIA.forEach(function (c) {
      if (res.scores[c.key] < weakestVal) { weakestVal = res.scores[c.key]; weakest = c.key; }
    });
    var weakestName = "";
    CRITERIA.forEach(function (c) { if (c.key === weakest) weakestName = c.name; });

    if (weakestVal < 7) tips.push("Focus next round: " + weakestName + " (" + weakestVal + "/10).");
    if (res.category && CATEGORY_TIPS[res.category]) tips.push(CATEGORY_TIPS[res.category]);
    if (!tips.length) tips.push("Strong round — keep practicing to stay sharp.");

    var wrap = $("tipsList");
    wrap.innerHTML = "";
    tips.slice(0, 3).forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t;
      wrap.appendChild(li);
    });
  }

  function resetToDraw() {
    stopTicker();
    stopRecording();
    state.transcript = "";
    state.selected = null;
    state.topics = [];
    state.elapsed = 0;
    state.phase = "prep";
    state.running = false;
    $("topicCards").innerHTML = "";
    $("topicCards").style.display = "none";
    $("drawBtn").style.display = "";
    setStage("draw");
  }

  // ---------- Init ----------
  function init() {
    setStage("draw");
    $("drawBtn").onclick = drawTopics;
    $("btnStartPrep").onclick = startPrep;
    $("btnStartSpeaking").onclick = startSpeaking;
    $("btnStop").onclick = stopRound;
    $("btnAgain").onclick = resetToDraw;
    $("btnHome").onclick = function () { location.href = "app.html"; };
    updateTimerDisplay();
  }

  global.WetalkImpromptu = {
    init: init,
    drawTopics: drawTopics,
    selectTopic: selectTopic,
    startPrep: startPrep,
    startSpeaking: startSpeaking,
    stopRound: stopRound
  };
})(window);
