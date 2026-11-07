/* ============================================================
   Wetalk v2 — application logic
   DeepSeek-Harness-style layout: left history sidebar + right
   workspace with three practice modes.
   ============================================================ */
(function (global) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function newId() {
    return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------------- Toast ----------------
  var toastEl = document.createElement("div");
  toastEl.className = "toast";
  document.body.appendChild(toastEl);
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, 2600);
  }

  // ---------------- Text-to-speech (question reader: TOEFL + Vericant) ----------------
  // Read-aloud modes read each question aloud while its text stays hidden.
  var ttsVoices = [];
  var speechToken = 0;
  var audioCtx = null;

  function refreshVoices() {
    if (!global.speechSynthesis) return;
    try { ttsVoices = global.speechSynthesis.getVoices() || []; } catch (e) { ttsVoices = []; }
  }

  if (global.speechSynthesis) {
    refreshVoices();
    if (typeof global.speechSynthesis.addEventListener === "function") {
      global.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    } else {
      global.speechSynthesis.onvoiceschanged = refreshVoices;
    }
  }

  function ttsAvailable() {
    return !!(global.speechSynthesis && global.SpeechSynthesisUtterance);
  }

  function pickEnglishVoice() {
    if (!ttsVoices.length) refreshVoices();
    var preferred = ["Google US English", "Microsoft Aria", "Microsoft Zira", "Microsoft Jenny", "Samantha"];
    var i, j, v;
    for (i = 0; i < preferred.length; i++) {
      for (j = 0; j < ttsVoices.length; j++) {
        if ((ttsVoices[j].name || "").indexOf(preferred[i]) !== -1) return ttsVoices[j];
      }
    }
    for (i = 0; i < ttsVoices.length; i++) {
      if ((ttsVoices[i].lang || "").toLowerCase() === "en-us") return ttsVoices[i];
    }
    for (i = 0; i < ttsVoices.length; i++) {
      if ((ttsVoices[i].lang || "").toLowerCase().indexOf("en") === 0) return ttsVoices[i];
    }
    return ttsVoices[0] || null;
  }

  function cancelSpeech() {
    speechToken++;
    if (global.speechSynthesis) { try { global.speechSynthesis.cancel(); } catch (e) {} }
  }

  // Read text aloud; returns false when speech synthesis is unavailable so the
  // caller can fall back to showing the question in text form.
  function speakQuestion(text, onEnd) {
    if (!ttsAvailable()) return false;
    refreshVoices();
    cancelSpeech();
    var token = speechToken;
    var u = new global.SpeechSynthesisUtterance(text);
    var voice = pickEnglishVoice();
    if (voice) u.voice = voice;
    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 1;
    function finish() {
      if (token !== speechToken) return;
      speechToken++;
      onEnd();
    }
    u.onend = finish;
    u.onerror = finish;
    try { global.speechSynthesis.speak(u); } catch (e) { finish(); }
    return true;
  }

  // Short chime signalling "recording started". Deliberately NOT spoken aloud:
  // a spoken cue would be picked up by the microphone and transcribed.
  function beep() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
      var t = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(1174.66, t + 0.12);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    } catch (e) { /* sound is a nice-to-have */ }
  }

  // ---------------- State ----------------
  var state = {
    mode: "home",             // home | impromptu | interview | toefl | practice | results | history
    lang: "en", diff: "random", cat: "random",
    currentPrompt: null,      // { mode, modeLabel, text, speechLang, timing, stages? }
    currentResult: null,
    viewHistoryId: null
  };

  // ---------------- Topic resolution ----------------
  function resolveImpromptuTopics() {
    var bank = global.WETALK_TOPIC_BANKS[state.lang];
    if (!bank) return [];
    function pick(c) {
      if (state.diff === "random") return (c.easy || []).concat(c.medium || [], c.hard || []);
      return c[state.diff] || [];
    }
    if (bank.categories) {
      if (state.cat === "random") {
        var all = [];
        for (var k in bank.categories) all = all.concat(pick(bank.categories[k]));
        return all;
      }
      var c = bank.categories[state.cat] || bank.categories.general;
      return pick(c);
    }
    return pick(bank.fallback);
  }

  function resolvePromptPool(mode) {
    if (mode === "impromptu") return resolveImpromptuTopics();
    if (mode === "toefl") return (global.WETALK_TOEFL.sets || []);
    return [];
  }

  function promptTextFor(mode, item) {
    if (mode === "toefl" && item && item.questions) {
      // Do not list the questions here: they are read aloud one at a time.
      return item.topic + "\n4 questions · each is read aloud · 45 seconds to answer";
    }
    return item;
  }

  // ---------------- Dropdowns ----------------
  function closeDropdowns() {
    var open = document.querySelectorAll(".dropdown.is-open");
    for (var i = 0; i < open.length; i++) open[i].classList.remove("is-open");
  }

  function renderDropdown(ddId, triggerId, menuId, iconId, valueId, items, selectedCode, onSelect) {
    var menu = $(menuId);
    var sel = items.filter(function (it) { return it.code === selectedCode; })[0] || items[0];
    $(iconId).textContent = sel.icon;
    $(valueId).textContent = sel.name;

    menu.innerHTML = "";
    items.forEach(function (item) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dropdown__option" + (item.code === sel.code ? " is-selected" : "");
      b.innerHTML = '<span class="opt-icon">' + item.icon + '</span><span>' +
        escapeHtml(item.name) + '</span><span class="opt-check">✓</span>';
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        closeDropdowns();
        if (item.code !== sel.code) onSelect(item.code);
        renderDropdown(ddId, triggerId, menuId, iconId, valueId, items, item.code, onSelect);
      });
      menu.appendChild(b);
    });

    $(triggerId).onclick = function (e) {
      e.stopPropagation();
      var dd = $(ddId);
      var wasOpen = dd.classList.contains("is-open");
      closeDropdowns();
      if (!wasOpen) dd.classList.add("is-open");
    };
  }

  document.addEventListener("click", function () { closeDropdowns(); });

  function categoriesForLang(lang) {
    if (lang === "en") return global.WETALK_CATEGORIES;
    return [
      { code: "random", icon: "🎯", name: "Random" },
      { code: "general", icon: "📚", name: "All Topics" }
    ];
  }

  function onLangSelect(code) {
    state.lang = code;
    if (state.cat !== "random" && state.cat !== "general") state.cat = "random";
    renderDropdown("ddCat", "catTrigger", "catMenu", "catIcon", "catValue",
      categoriesForLang(code), state.cat, onCatSelect);
    if (state.currentPrompt) { /* keep existing prompt until re-spin */ }
  }
  function onDiffSelect(code) { state.diff = code; }
  function onCatSelect(code) { state.cat = code; }

  // ---------------- Vericant interview script ----------------
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function buildVericantStages() {
    var V = global.WETALK_VERICANT;
    var t = V.timing;
    var imgs = V.pictures.slice();
    for (var i = imgs.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = imgs[i]; imgs[i] = imgs[j]; imgs[j] = tmp;
    }
    return [
      { section: "Introduction", text: pick(V.questions.intro), prep: t.intro.prep, speak: t.intro.speak },
      { section: "Introduction", text: pick(V.followups.intro), prep: t.followup.prep, speak: t.followup.speak, followup: true },
      { section: "Picture", text: "Look at the two pictures. Choose one and describe it in as much detail as you can — or compare the two.", image: imgs[0], image2: imgs[1], prep: t.picture.prep, speak: t.picture.speak },
      { section: "Picture", text: pick(V.followups.picture), prep: t.followup.prep, speak: t.followup.speak, followup: true },
      { section: "In-depth", text: pick(V.questions.indepth), prep: t.indepth.prep, speak: t.indepth.speak },
      { section: "In-depth", text: pick(V.followups.indepth), prep: t.followup.prep, speak: t.followup.speak, followup: true },
      { section: "Reflective", text: pick(V.questions.reflective), prep: t.reflective.prep, speak: t.reflective.speak },
      { section: "Free Speech", text: pick(V.questions.freespeech), prep: t.freespeech.prep, speak: t.freespeech.speak }
    ];
  }

  function buildVericantPreview(stages) {
    return stages.map(function (s) {
      var badge = s.followup ? ' <span class="stage-preview__followup">follow-up</span>' : "";
      return '<div class="stage-preview"><span class="stage-preview__name">' + escapeHtml(s.section) + '</span>' +
        '<span class="stage-preview__text">' + escapeHtml(s.text) + badge + '</span></div>';
    }).join("");
  }

  function spinVericant(textEl, btn, actions, framework) {
    var V = global.WETALK_VERICANT;
    var stages = buildVericantStages();

    textEl.classList.remove("is-settled", "is-placeholder");
    textEl.classList.add("topic-text--list");
    textEl.innerHTML = buildVericantPreview(stages);

    framework.innerHTML = '<div class="framework__title">Scored on the SEE rubric (0–6)</div>' +
      '<div class="framework__body">' + V.see.map(function (c) { return escapeHtml(c.name); }).join(" · ") + '</div>' +
      '<div class="framework__steps">' + V.see.map(function (c) {
        return '<span class="framework__step">' + escapeHtml(c.name) + '</span>';
      }).join("") + '</div>';
    framework.hidden = false;

    state.currentPrompt = {
      mode: "interview", modeLabel: "Vericant Interview", text: "Vericant Interview (5 sections)",
      speechLang: "en-US", timing: { combined: false, prep: 0, speak: 0 },
      meta: "🎥 Vericant · 5 sections",
      lang: state.lang, diff: state.diff, cat: state.cat,
      qType: "vericant", topic: null, stages: stages
    };

    actions.hidden = false;
    btn.disabled = false;
  }

  // ---------------- Spinning topic generator ----------------
  function spin(mode) {
    var textEl = mode === "impromptu" ? $("topicText") : (mode === "interview" ? $("interviewText") : $("toeflText"));
    var btn = mode === "impromptu" ? $("btnSpin") : (mode === "interview" ? $("btnInterviewSpin") : $("btnToeflSpin"));
    var actions = mode === "impromptu" ? $("practiceActions") : (mode === "interview" ? $("interviewActions") : $("toeflActions"));
    var meta = $("topicMeta");
    var framework = $("interviewFramework");

    if (mode === "interview") {
      spinVericant(textEl, btn, actions, framework);
      return;
    }

    var pool = resolvePromptPool(mode);

    if (!pool.length) { toast("No topics for this combination yet."); return; }

    var finalItem = pool[Math.floor(Math.random() * pool.length)];
    var finalText = promptTextFor(mode, finalItem);

    // clear prior selection state
    actions.hidden = true;
    if (meta) meta.textContent = "";
    textEl.classList.remove("is-settled", "is-placeholder");

    btn.disabled = true;
    var count = 0, interval = 55, maxRolls = 16;
    (function roll() {
      var item = pool[Math.floor(Math.random() * pool.length)];
      textEl.textContent = (mode === "toefl") ? (item.topic || "") : promptTextFor(mode, item);
      textEl.classList.add("is-rolling");
      count++;
      if (count >= maxRolls) {
        if (mode === "toefl") {
          textEl.innerHTML = escapeHtml(finalText).replace(/\n/g, "<br>");
          textEl.classList.add("topic-text--list");
        } else {
          textEl.textContent = finalText;
          textEl.classList.remove("topic-text--list");
        }
        textEl.classList.remove("is-rolling");
        textEl.classList.add("is-settled");
        setTimeout(function () { textEl.classList.remove("is-settled"); }, 500);
        btn.disabled = false;
        actions.hidden = false;

        var speechLang = "en-US";
        var timing = null;
        var modeLabel = "";
        var promptMeta = "";
        if (mode === "impromptu") {
          var L = global.WETALK_LANGUAGES.filter(function (l) { return l.code === state.lang; })[0];
          speechLang = L ? L.speech : "en-US";
          timing = { combined: true, total: 420, grace: 30 };
          modeLabel = "Impromptu Speech";
          var dName = global.WETALK_DIFFICULTIES.filter(function (d) { return d.code === state.diff; })[0].name;
          var cName = global.WETALK_CATEGORIES.filter(function (c) { return c.code === state.cat; })[0].name;
          promptMeta = L.flag + " " + L.name + " · " + dName + " · " + cName;
        } else if (mode === "toefl") {
          timing = { combined: false, prep: 0, speak: 45 };
          modeLabel = "TOEFL Oral Preparation";
          promptMeta = "📝 " + finalItem.topic + " · 4 questions · 45s each";
        }
        if (meta) meta.textContent = promptMeta;

        state.currentPrompt = {
          mode: mode, modeLabel: modeLabel, text: finalText, speechLang: speechLang,
          timing: timing, meta: promptMeta,
          lang: state.lang, diff: state.diff, cat: state.cat,
          qType: mode === "toefl" ? "set" : null,
          topic: mode === "toefl" ? finalItem.topic : null,
          questions: mode === "toefl" ? finalItem.questions : null,
          image: mode === "toefl" ? (finalItem.img || null) : null
        };
        return;
      }
      interval += 16;
      setTimeout(roll, interval);
    })();
  }

  // ---------------- Views ----------------
  function showView(name) {
    state.mode = name;
    var views = ["home", "impromptu", "interview", "toefl", "practice", "results", "history"];
    views.forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.hidden = (v !== name);
    });
  }

  function goHome() { stopSession(); showView("home"); }

  function openMode(mode) {
    stopSession();
    state.currentPrompt = null;
    state.currentResult = null;
    $("topicText").textContent = "Your topic will appear here";
    $("topicText").classList.add("is-placeholder");
    $("interviewText").textContent = "Your 5-section interview will appear here";
    $("interviewText").classList.add("is-placeholder");
    $("interviewText").classList.remove("topic-text--list");
    $("toeflText").textContent = "Your TOEFL interview set will appear here";
    $("toeflText").classList.add("is-placeholder");
    $("toeflText").classList.remove("topic-text--list");
    $("topicMeta").textContent = "";
    $("interviewFramework").hidden = true;
    $("practiceActions").hidden = true;
    $("interviewActions").hidden = true;
    $("toeflActions").hidden = true;
    showView(mode);
  }

  // ---------------- Practice session ----------------
  var session = null;
  var recognition = null;
  var recognitionRetries = 0;
  var restartPending = false;
  var manualTranscript = false;

  function stopSession() {
    if (session && session.tickId) { clearInterval(session.tickId); session.tickId = null; }
    cancelSpeech();
    stopRecognition();
    session = null;
    var dot = $("recDot");
    if (dot) dot.hidden = true;
    var pv = $("view-practice");
    if (pv) pv.classList.remove("practice--readaloud");
  }

  function beginPractice() {
    var p = state.currentPrompt;
    if (!p) return;
    manualTranscript = false;

    var isSeq = false;
    var stages = null;
    if (p.mode === "toefl" && p.questions && p.questions.length > 1) {
      isSeq = true;
      stages = p.questions.map(function (q) {
        return { text: q, prep: p.timing.prep, speak: p.timing.speak, image: p.image || null };
      });
    } else if (p.mode === "interview" && p.stages && p.stages.length > 1) {
      isSeq = true;
      stages = p.stages.slice();
    }

    session = {
      combined: p.timing.combined,
      total: p.timing.total || 0,
      grace: p.timing.grace || 0,
      prepSec: stages ? stages[0].prep : (p.timing.prep || 0),
      speakSec: stages ? stages[0].speak : (p.timing.speak || 0),
      phase: "idle",
      remaining: p.timing.combined ? p.timing.total : (stages ? stages[0].prep : p.timing.prep),
      running: false,
      tickId: null,
      lastTs: 0,
      transcript: "",
      interim: "",
      speakStart: 0,
      isSeq: isSeq,
      mode: p.mode,
      topic: p.topic || null,
      questions: stages,
      qIndex: 0,
      transcripts: [],
      speakSecs: [],
      totalSpeakSec: 0,
      ttsOk: true
    };

    $("practiceModeLabel").textContent = p.modeLabel;
    resetTranscriptUI();

    var isReadAloud = p.mode === "toefl" || p.mode === "interview";
    var practiceView = $("view-practice");
    if (practiceView) practiceView.classList.toggle("practice--readaloud", isReadAloud);
    $("btnReplay").hidden = true;
    $("recDot").hidden = true;

    showView("practice");
    renderCurrentQuestion();

    if (isReadAloud) {
      // Read-aloud modes drive themselves: read the question aloud, then record automatically.
      $("btnStartPrep").hidden = true;
      $("btnStartSpeaking").hidden = true;
      $("btnFinish").hidden = true;
      startQuestionReadAloud();
      return;
    }

    $("btnStartPrep").hidden = false;
    $("btnStartSpeaking").hidden = true;
    $("btnFinish").hidden = true;
    $("timerPhase").textContent = "Ready";
    $("timerTime").textContent = fmt(session.remaining);
    $("timerTime").classList.remove("is-warning", "is-critical");
    $("timerHint").textContent = "Press “Start Prep” to begin.";
  }

  function currentQuestion() {
    return session.isSeq ? session.questions[session.qIndex].text : state.currentPrompt.text;
  }

  function renderPracticeImages() {
    var box = $("practiceImages");
    if (!box) return;
    var st = session && session.isSeq ? session.questions[session.qIndex] : null;
    if (st && (st.image || st.image2)) {
      var alt = session.mode === "toefl" ? "Picture for the question" : "Picture A";
      box.innerHTML = (st.image ? '<img src="' + escapeHtml(st.image) + '" alt="' + alt + '">' : "") +
        (st.image2 ? '<img src="' + escapeHtml(st.image2) + '" alt="Picture B">' : "");
      box.hidden = false;
    } else {
      box.innerHTML = "";
      box.hidden = true;
    }
  }

  function renderCurrentQuestion() {
    var stepEl = $("practiceStep");
    if (session.isSeq) {
      stepEl.hidden = false;
      var st = session.questions[session.qIndex];
      stepEl.textContent = st.section
        ? (st.section + (st.followup ? " · Follow-up" : "") + "  ·  " + (session.qIndex + 1) + " of " + session.questions.length)
        : ("Question " + (session.qIndex + 1) + " of " + session.questions.length + (session.topic ? " · " + session.topic : ""));
    } else {
      stepEl.hidden = true;
    }
    renderPracticeImages();
    var promptEl = $("practicePrompt");
    if (isReadAloudMode()) {
      // Never reveal the question text while it is being read aloud; only fall
      // back to showing it when text-to-speech is unavailable.
      if (session.ttsOk === false && session.questions) {
        promptEl.innerHTML = escapeHtml(session.questions[session.qIndex].text);
      } else {
        promptEl.textContent = "🎧 Listen to the question…";
      }
    } else {
      promptEl.innerHTML = escapeHtml(currentQuestion()).replace(/\n/g, "<br>");
    }
    updateFinishLabel();
  }

  function resetTranscriptUI() {
    $("transcriptBox").textContent = "Your spoken words will appear here as you speak.";
    $("transcriptBox").hidden = false;
    $("transcriptManual").hidden = true;
    $("transcriptManual").value = "";
    $("transcriptStatus").textContent = "idle";
    $("transcriptStatus").classList.remove("is-listening");
  }

  function updateFinishLabel() {
    var btn = $("btnFinish");
    if (session.isSeq && session.qIndex < session.questions.length - 1) {
      btn.textContent = "Next →";
    } else {
      btn.textContent = "Finish";
    }
  }

  function startTicker() {
    stopTicker();
    session.lastTs = Date.now();
    session.tickId = setInterval(tick, 100);
  }
  function stopTicker() { if (session && session.tickId) { clearInterval(session.tickId); session.tickId = null; } }

  function startPrep() {
    if (!session || session.phase !== "idle") return;
    session.phase = "prep";
    session.remaining = session.combined ? session.total : session.prepSec;
    session.running = true;
    startTicker();
    $("btnStartPrep").hidden = true;
    $("btnStartSpeaking").hidden = false;
    $("btnFinish").hidden = false;
    $("timerPhase").textContent = "Prep";
    $("timerHint").textContent = session.combined ? "Prepare, then press “Start Speaking” when ready (7:00 shared clock)." : "Prepare your answer.";
  }

  function startSpeaking() {
    if (!session) return;
    if (isReadAloudMode() && session.phase === "listening") { beginRecording(); return; }
    if (session.phase !== "prep" && session.phase !== "ready") return;
    session.phase = "speaking";
    if (!session.combined) {
      session.remaining = session.speakSec;
      session.running = true;
      startTicker();
    }
    session.speakStart = Date.now();
    renderTimer();
    $("btnStartSpeaking").hidden = true;
    $("timerPhase").textContent = "Speaking";
    $("timerHint").textContent = "Speak now.";
    startRecognition();
  }

  // True for modes whose questions are read aloud (TOEFL + Vericant).
  function isReadAloudMode() {
    return !!session && (session.mode === "toefl" || session.mode === "interview");
  }

  // ---- Read-aloud flow: read the question aloud, then record the answer ----
  function startQuestionReadAloud() {
    if (!isReadAloudMode() || !session.isSeq) return;
    session.phase = "listening";
    session.running = false;
    session.remaining = session.speakSec;
    session.speakStart = 0;
    stopTicker();

    renderCurrentQuestion();
    updateFinishLabel();

    $("btnStartPrep").hidden = true;
    $("btnStartSpeaking").hidden = true;
    $("btnFinish").hidden = true;
    $("btnReplay").hidden = false;
    $("recDot").hidden = true;
    $("timerPhase").textContent = "Listening";
    $("timerTime").textContent = fmt(session.speakSec);
    $("timerTime").classList.remove("is-warning", "is-critical");
    $("timerHint").textContent = "The question is being read aloud — the text stays hidden.";
    $("transcriptStatus").textContent = "waiting";
    $("transcriptStatus").classList.remove("is-listening");
    $("transcriptBox").textContent = "The question is being read aloud. Recording starts automatically when it finishes.";

    var text = session.questions[session.qIndex].text;
    if (!speakQuestion(text, beginRecording)) {
      // No speech synthesis: reveal the question and let the user start manually.
      session.ttsOk = false;
      renderCurrentQuestion();
      $("btnStartSpeaking").hidden = false;
      $("btnReplay").hidden = true;
      $("timerPhase").textContent = "Ready";
      $("timerHint").textContent = "Text-to-speech is unavailable — read the question above, then press “Start Speaking”.";
      $("transcriptBox").textContent = "Read the question above, then press “Start Speaking”.";
    }
  }

  function beginRecording() {
    if (!isReadAloudMode() || session.phase !== "listening") return;
    session.phase = "speaking";
    session.remaining = session.speakSec;
    session.running = true;
    startTicker();
    session.speakStart = Date.now();
    renderTimer();

    if (session.ttsOk !== false) $("practicePrompt").textContent = "🎤 Answer out loud";
    $("btnReplay").hidden = true;
    $("btnFinish").hidden = false;
    $("recDot").hidden = false;
    $("timerPhase").textContent = "Recording";
    $("timerHint").textContent = "Wetalk is now recording — speak now.";
    $("transcriptStatus").textContent = "listening";
    $("transcriptStatus").classList.add("is-listening");
    $("transcriptBox").textContent = "Listening… your words will appear here.";
    beep();
    toast("Wetalk is now recording — speak now.");
    startRecognition();
  }

  function replayQuestion() {
    if (!isReadAloudMode() || session.phase !== "listening") return;
    var text = session.questions[session.qIndex].text;
    if (!speakQuestion(text, beginRecording)) {
      session.ttsOk = false;
      renderCurrentQuestion();
      $("btnReplay").hidden = true;
      $("btnStartSpeaking").hidden = false;
      $("timerPhase").textContent = "Ready";
      $("timerHint").textContent = "Text-to-speech is unavailable — read the question above, then press “Start Speaking”.";
      $("transcriptBox").textContent = "Read the question above, then press “Start Speaking”.";
    }
  }

  function tick() {
    if (!session || !session.running) return;
    var now = Date.now();
    var dt = (now - session.lastTs) / 1000;
    session.lastTs = now;
    session.remaining -= dt;

    if (session.combined) {
      if (session.remaining <= 0) {
        if (session.phase === "speaking") $("timerPhase").textContent = "Grace";
        if (session.remaining <= -session.grace) { completeQuestion(); return; }
      }
    } else {
      if (session.phase === "prep" && session.remaining <= 0) {
        session.remaining = 0;
        session.running = false;
        session.phase = "ready";
        stopTicker();
        $("timerPhase").textContent = "Ready";
        $("timerHint").textContent = "Prep done — press “Start Speaking”.";
      } else if (session.phase === "speaking" && session.remaining <= 0) {
        completeQuestion();
        return;
      }
    }
    renderTimer();
  }

  function renderTimer() {
    var t = $("timerTime");
    t.textContent = fmt(session.remaining);
    t.classList.remove("is-warning", "is-critical");
    if (session.remaining <= 10) t.classList.add("is-critical");
    else if (session.remaining <= 30) t.classList.add("is-warning");
  }

  function completeQuestion() {
    if (!session) return;
    session.running = false;
    stopTicker();
    cancelSpeech();
    $("recDot").hidden = true;
    var speakSec = session.speakStart ? (Date.now() - session.speakStart) / 1000 : 0;
    session.totalSpeakSec += speakSec;
    stopRecognition();

    var text = getTranscript();
    if (session.isSeq) {
      session.transcripts[session.qIndex] = text;
      session.speakSecs[session.qIndex] = speakSec;
      if (session.qIndex < session.questions.length - 1) {
        session.qIndex++;
        var next = session.questions[session.qIndex];
        session.prepSec = next.prep;
        session.speakSec = next.speak;
        session.transcript = "";
        session.interim = "";
        session.phase = "idle";
        session.remaining = session.prepSec;
        session.speakStart = 0;
        resetTranscriptUI();
        renderCurrentQuestion();
        if (isReadAloudMode()) {
          // Auto-advance: the next question is read aloud right away.
          startQuestionReadAloud();
          return;
        }
        $("btnStartPrep").hidden = false;
        $("btnStartSpeaking").hidden = true;
        $("btnFinish").hidden = true;
        $("timerPhase").textContent = "Ready";
        $("timerTime").textContent = fmt(session.remaining);
        $("timerTime").classList.remove("is-warning", "is-critical");
        $("timerHint").textContent = "Press “Start Prep” to begin.";
        return;
      }
      text = session.transcripts.join(" ").trim();
    }
    session.finalTranscript = text;
    if (session.mode === "interview") {
      evaluateVericant();
    } else if (session.mode === "toefl") {
      evaluateToefl();
    } else {
      evaluate(text, session.totalSpeakSec);
    }
  }

  // ---------------- Transcription ----------------
  function getTranscript() {
    var manual = $("transcriptManual").value || "";
    var live = ((session.transcript || "") + " " + (session.interim || "")).trim();
    return live || manual.trim();
  }

  function buildRecognition() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) return null;
    var r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = (state.currentPrompt && state.currentPrompt.speechLang) || "en-US";
    r.onresult = function (e) {
      if (recognition !== r) return;
      recognitionRetries = 0;
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) session.transcript += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      session.interim = interim;
      $("transcriptBox").textContent = session.transcript + interim;
    };
    r.onerror = function (ev) {
      if (recognition !== r) return;
      var err = ev && ev.error ? ev.error : "";
      if (err === "not-allowed" || err === "service-not-allowed") {
        enableManualTranscript();
        return;
      }
      // Recoverable (no-speech, aborted, network, audio-capture) — retry.
      restartRecognition();
    };
    r.onend = function () {
      if (recognition !== r) return;
      if (session && session.phase === "speaking" && session.running) restartRecognition();
    };
    return r;
  }

  function restartRecognition() {
    if (manualTranscript) return;
    if (!session || session.phase !== "speaking" || !session.running) return;
    if (recognitionRetries >= 5) { enableManualTranscript(); return; }
    if (restartPending) return;
    restartPending = true;
    recognitionRetries++;
    setTimeout(function () {
      restartPending = false;
      if (!session || session.phase !== "speaking" || !session.running) return;
      if (recognition) { try { recognition.abort(); } catch (e) {} }
      recognition = buildRecognition();
      if (!recognition) { enableManualTranscript(); return; }
      try { recognition.start(); } catch (e) { enableManualTranscript(); }
    }, 150);
  }

  function startRecognition() {
    recognitionRetries = 0;
    recognition = buildRecognition();
    if (!recognition) { enableManualTranscript(); return; }
    try { recognition.start(); } catch (e) { enableManualTranscript(); return; }
    $("transcriptStatus").textContent = "listening";
    $("transcriptStatus").classList.add("is-listening");
  }

  function stopRecognition() {
    if (recognition) { try { recognition.stop(); } catch (e) {} recognition = null; }
    recognitionRetries = 0;
    var st = $("transcriptStatus");
    if (st) { st.textContent = "idle"; st.classList.remove("is-listening"); }
  }

  function enableManualTranscript() {
    manualTranscript = true;
    $("transcriptBox").hidden = true;
    $("transcriptManual").hidden = false;
    var st = $("transcriptStatus");
    st.textContent = "type your answer";
    st.classList.remove("is-listening");
  }

  // ---------------- Evaluation ----------------
  function tokenize(text) {
    return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  }

  function countMarkers(words, list) {
    var joined = " " + words.join(" ") + " ";
    var n = 0;
    list.forEach(function (m) {
      var idx = joined.indexOf(" " + m + " ");
      while (idx !== -1) { n++; idx = joined.indexOf(" " + m + " ", idx + 1); }
    });
    return n;
  }

  // Shared marker lists for the heuristic scorers.
  var MARKERS = {
    org: ["first", "second", "third", "finally", "firstly", "next", "then", "lastly", "to start", "in conclusion", "in summary", "overall", "to begin", "to sum up"],
    ana: ["because", "therefore", "this means", "as a result", "however", "on the other hand", "for example", "for instance", "consequently", "the reason", "so that", "in order to"],
    fillers: ["um", "uh", "like", "you know", "basically", "actually", "so yeah", "hmm", "er", "kind of", "sort of", "i mean"],
    devices: ["imagine", "what if", "picture this", "metaphor", "just like", "think about", "consider this", "for a moment"]
  };

  function scoreSpeech(text, speakingSec) {
    var words = tokenize(text);
    var wordCount = words.length;
    var duration = Math.max(1, Math.round(speakingSec));
    var wpm = duration > 0 ? Math.round(wordCount / (duration / 60)) : 0;

    var orgCount = countMarkers(words, MARKERS.org);
    var anaCount = countMarkers(words, MARKERS.ana);
    var fillerCount = countMarkers(words, MARKERS.fillers);
    var deviceCount = countMarkers(words, MARKERS.devices);

    function clamp(n) { return Math.max(1, Math.min(5, n)); }

    var unique = {};
    words.forEach(function (w) { unique[w] = 1; });
    var diversity = wordCount ? Object.keys(unique).length / wordCount : 0;

    var organization = wordCount ? clamp(2 + Math.min(3, Math.floor(orgCount / 2))) : 1;
    var analysis = wordCount ? clamp(2 + Math.min(3, Math.floor(anaCount / 2)) + (wordCount >= 60 ? 1 : 0)) : 1;
    var fillerRatio = wordCount ? fillerCount / wordCount : 0;
    var delivery = wordCount ? clamp(5 - Math.floor(fillerRatio * 40)) : 2;
    if (!wordCount) delivery = 2;
    var creativity = wordCount ? clamp(2 + Math.min(3, deviceCount) + (diversity > 0.55 ? 1 : 0) + (diversity > 0.7 ? 1 : 0)) : 2;
    if (!wordCount) creativity = 2;

    var overall = Math.round((organization + analysis + delivery + creativity) / 4);

    var tipMap = {
      organization: [ "Give your answer a clear shape: open with your main point, then signpost with “first… second… finally”.", "Strong structure. Keep signposting transitions so your listener always knows where you are." ],
      analysis: [ "Go deeper: explain WHY it matters. Use “because”, “for example” and “this means”.", "Good depth. Push further by considering counterarguments and trade-offs." ],
      delivery: [ "Slow down and cut filler words like “um” and “like” — pause instead of filling the silence.", "Confident delivery. Watch pacing and use short pauses for emphasis." ],
      creativity: [ "Add a fresh angle: a personal story, a metaphor, or a “what if” to make it memorable.", "Creative and memorable. Keep the originality without losing clarity." ]
    };

    var tips = global.WETALK_CRITERIA.map(function (c) {
      var score = { organization: organization, analysis: analysis, delivery: delivery, creativity: creativity }[c.key];
      return { key: c.key, name: c.name, score: score, text: score <= 3 ? tipMap[c.key][0] : tipMap[c.key][1] };
    });

    if (!text) {
      tips.unshift({ key: "note", name: "No transcript", score: 0, text: "We couldn't capture any words. Allow the microphone or type your answer next time to get a full evaluation." });
    }

    return {
      scores: { organization: organization, analysis: analysis, delivery: delivery, creativity: creativity, overall: overall },
      stats: { wordCount: wordCount, wpm: wpm, duration: duration, fillers: fillerCount },
      tips: tips
    };
  }

  // TOEFL Speaking rubric scorer: Delivery, Language Use, Topic Development.
  // Criteria are scored 1-5; the per-question overall uses 0.5 steps.
  function scoreSpeechToefl(text, speakingSec) {
    var words = tokenize(text);
    var wordCount = words.length;
    var duration = Math.max(1, Math.round(speakingSec));
    var wpm = duration > 0 ? Math.round(wordCount / (duration / 60)) : 0;

    var orgCount = countMarkers(words, MARKERS.org);
    var anaCount = countMarkers(words, MARKERS.ana);
    var fillerCount = countMarkers(words, MARKERS.fillers);

    function clamp(n) { return Math.max(1, Math.min(5, n)); }

    var unique = {};
    var totalChars = 0;
    words.forEach(function (w) { unique[w] = 1; totalChars += w.length; });
    var diversity = wordCount ? Object.keys(unique).length / wordCount : 0;
    var avgWordLen = wordCount ? totalChars / wordCount : 0;

    var fillerRatio = wordCount ? fillerCount / wordCount : 0;
    var delivery = wordCount ? clamp(5 - Math.floor(fillerRatio * 40)) : 2;
    var language = wordCount
      ? clamp(2 + (diversity > 0.5 ? 1 : 0) + (diversity > 0.65 ? 1 : 0) + (avgWordLen > 4.3 ? 1 : 0))
      : 1;
    var topicDev = wordCount
      ? clamp(2 + Math.min(3, Math.floor((orgCount + anaCount) / 3)) + (wordCount >= 45 ? 1 : 0))
      : 1;

    var overall = Math.round(((delivery + language + topicDev) / 3) * 2) / 2;

    var tipMap = {
      delivery: [
        "Delivery: slow down and replace fillers (um, like) with short pauses. Aim for a steady 110-150 wpm.",
        "Delivery is solid: clear pace and few fillers. Keep using pauses for emphasis."
      ],
      language: [
        "Language Use: widen your vocabulary and use fuller sentence structures (conditionals, relative clauses) instead of short fragments.",
        "Language Use is strong: varied vocabulary and sentence forms. Keep precision high under time pressure."
      ],
      topic: [
        "Topic Development: answer directly, then add one reason and one concrete example. Signpost with “first… because… for example…”, and aim for 45+ words.",
        "Topic Development is strong: complete and supported. Push for a deeper example or a brief contrast to stand out."
      ]
    };

    var tipCriteria = global.WETALK_TOEFL_CRITERIA || [];
    var tips = tipCriteria.map(function (c) {
      var score = { delivery: delivery, language: language, topic: topicDev }[c.key];
      return { key: c.key, name: c.name, score: score, text: score <= 3 ? tipMap[c.key][0] : tipMap[c.key][1] };
    });
    if (!text) {
      tips.unshift({ key: "note", name: "No transcript", score: 0, text: "We couldn't capture any words. Allow the microphone or type your answer next time to get a full evaluation." });
    }

    return {
      scores: { delivery: delivery, language: language, topic: topicDev, overall: overall },
      stats: { wordCount: wordCount, wpm: wpm, duration: duration, fillers: fillerCount },
      tips: tips
    };
  }

  function evaluate(text, speakingSec) {
    var s = scoreSpeech(text, speakingSec);
    state.currentResult = {
      id: newId(),
      mode: state.currentPrompt.mode,
      modeLabel: state.currentPrompt.modeLabel,
      title: state.currentPrompt.text,
      meta: state.currentPrompt.meta,
      lang: state.currentPrompt.lang,
      diff: state.currentPrompt.diff,
      cat: state.currentPrompt.cat,
      qType: state.currentPrompt.qType,
      startedAt: Date.now(),
      scores: { organization: s.scores.organization, analysis: s.scores.analysis, delivery: s.scores.delivery, creativity: s.scores.creativity, overall: s.scores.overall, max: 5 },
      stats: s.stats,
      transcript: text,
      criteria: global.WETALK_CRITERIA,
      tips: s.tips
    };
    renderResults();
  }

  function makeSummaryTip(per, maxScore, step) {
    if (!per.length) return null;
    var best = per[0], worst = per[0];
    per.forEach(function (p) {
      if (p.scores.overall > best.scores.overall) best = p;
      if (p.scores.overall < worst.scores.overall) worst = p;
    });
    var factor = step === 0.1 ? 10 : 2;
    var avg = Math.round((per.reduce(function (a, p) { return a + p.scores.overall; }, 0) / per.length) * factor) / factor;
    function labelFor(p, i) { return p.label || ("Question " + (i + 1)); }
    return {
      key: "summary", name: "Overview", score: avg,
      text: "Strongest: " + labelFor(best, per.indexOf(best)) + " (" + fmtScore(best.scores.overall, maxScore) + "/" + maxScore + "). Weakest: " +
        labelFor(worst, per.indexOf(worst)) + " (" + fmtScore(worst.scores.overall, maxScore) + "/" + maxScore + ") — spend your practice time there."
    };
  }

  function evaluateToefl() {
    var qs = state.currentPrompt.questions || [];
    var per = [];
    var agg = { delivery: 0, language: 0, topic: 0 };
    var totalWords = 0, totalFillers = 0, totalDuration = 0;
    var n = session.transcripts.length;
    for (var i = 0; i < n; i++) {
      var answer = session.transcripts[i] || "";
      var s = scoreSpeechToefl(answer, session.speakSecs[i] || 0);
      per.push({
        q: qs[i] || ("Question " + (i + 1)),
        scores: s.scores,
        stats: s.stats,
        tips: s.tips,
        transcript: answer,
        aiFeedback: null
      });
      agg.delivery += s.scores.delivery;
      agg.language += s.scores.language;
      agg.topic += s.scores.topic;
      totalWords += s.stats.wordCount;
      totalFillers += s.stats.fillers;
      totalDuration += s.stats.duration;
    }
    if (!n) n = 1;
    var overallSum = 0;
    per.forEach(function (p) { overallSum += p.scores.overall; });
    // Final score: out of 5 in 0.5 steps.
    var overall = Math.round((overallSum / n) * 2) / 2;
    function halfAvg(total) { return Math.round((total / n) * 2) / 2; }
    var summaryTip = makeSummaryTip(per, 5, 0.5);

    state.currentResult = {
      id: newId(),
      mode: state.currentPrompt.mode,
      modeLabel: state.currentPrompt.modeLabel,
      title: state.currentPrompt.topic || state.currentPrompt.text,
      meta: state.currentPrompt.meta,
      lang: state.currentPrompt.lang,
      diff: state.currentPrompt.diff,
      cat: state.currentPrompt.cat,
      qType: state.currentPrompt.qType,
      startedAt: Date.now(),
      scores: {
        delivery: halfAvg(agg.delivery),
        language: halfAvg(agg.language),
        topic: halfAvg(agg.topic),
        overall: overall,
        max: 5
      },
      stats: { wordCount: totalWords, wpm: totalDuration > 0 ? Math.round(totalWords / (totalDuration / 60)) : 0, duration: totalDuration, fillers: totalFillers },
      transcript: session.transcripts.join("\n\n").trim(),
      criteria: global.WETALK_TOEFL_CRITERIA,
      tips: summaryTip ? [summaryTip] : [],
      aiOverall: null,
      questions: per
    };
    renderResults();
  }

  // ---------------- Vericant SEE evaluation ----------------
  // Heuristic SEE scoring for one answer. Returns { scores, stats, tips }.
  function scoreSpeechVericant(text, speakingSec) {
    var words = tokenize(text);
    var wordCount = words.length;
    var duration = Math.max(1, Math.round(speakingSec));
    var wpm = duration > 0 ? Math.round(wordCount / (duration / 60)) : 0;

    var orgMarkers = ["first", "second", "third", "finally", "firstly", "next", "then", "lastly", "to start", "in conclusion", "in summary", "overall", "to begin", "to sum up"];
    var anaMarkers = ["because", "therefore", "this means", "as a result", "however", "on the other hand", "for example", "for instance", "consequently", "the reason", "so that", "in order to"];
    var fillers = ["um", "uh", "like", "you know", "basically", "actually", "so yeah", "hmm", "er", "kind of", "sort of", "i mean"];
    var pronouns = ["i", "my", "me", "mine", "we", "our", "us"];
    var opinion = ["i think", "i believe", "i feel", "in my opinion", "i would", "for me", "to me"];

    var orgCount = countMarkers(words, orgMarkers);
    var anaCount = countMarkers(words, anaMarkers);
    var fillerCount = countMarkers(words, fillers);
    var pronounCount = countMarkers(words, pronouns);
    var opinionCount = countMarkers(words, opinion);

    var unique = {};
    words.forEach(function (w) { unique[w] = 1; });
    var diversity = wordCount ? Object.keys(unique).length / wordCount : 0;

    var longCount = 0;
    words.forEach(function (w) { if (w.length >= 7) longCount++; });
    var longRatio = wordCount ? longCount / wordCount : 0;

    var sentences = (text || "").split(/[.!?]+/).filter(function (s) { return s.trim().length > 0; });
    var avgSentenceLen = sentences.length ? wordCount / sentences.length : 0;
    var fillerRatio = wordCount ? fillerCount / wordCount : 0;

    function clamp06(n) { return Math.max(0, Math.min(6, n)); }
    function flag(c) { return c ? 1 : 0; }

    var range = wordCount ? clamp06(2 + flag(diversity > 0.5) + flag(diversity > 0.65) + flag(longRatio > 0.10) + flag(longRatio > 0.18)) : 0;
    var accuracy = wordCount ? clamp06(3 + flag(avgSentenceLen >= 5 && avgSentenceLen <= 28) + flag(fillerRatio < 0.06) - flag(fillerRatio > 0.10) + flag(wordCount >= 40) + flag(sentences.length >= 1)) : 0;
    var fluency = wordCount ? clamp06(2 + flag(wpm >= 110 && wpm <= 170) + flag(fillerRatio < 0.03) - flag(fillerRatio > 0.08) + flag(duration >= 30) + flag(avgSentenceLen >= 7)) : 0;
    var interaction = wordCount ? clamp06(1 + flag(pronounCount >= 2) + flag(pronounCount >= 5) + flag(opinionCount >= 1) + flag(wordCount >= 60) + flag(wordCount >= 120)) : 0;
    var coherence = wordCount ? clamp06(2 + flag(orgCount >= 2) + flag(orgCount >= 4) + flag(anaCount >= 2) + flag(anaCount >= 4)) : 0;

    var overall = Math.round(((range + accuracy + fluency + interaction + coherence) / 5) * 10) / 10;

    function tier(s) { return s <= 2 ? "grow" : (s <= 3 ? "refine" : "praise"); }

    var tipMap = {
      range: {
        grow: "Your words were mostly simple — only " + Math.round(diversity * 100) + "% of them were distinct. Swap common words for sharper ones (\"very good\" → \"excellent\", \"nice\" → \"memorable\").",
        refine: "You used " + Math.round(diversity * 100) + "% distinct words. Stretch your vocabulary further with precise, specific words instead of general ones.",
        praise: "Strong, varied vocabulary (" + Math.round(diversity * 100) + "% distinct, " + Math.round(longRatio * 100) + "% longer words). Keep choosing words that carry exact meaning."
      },
      accuracy: {
        grow: "Your sentences " + (sentences.length ? "averaged " + Math.round(avgSentenceLen) + " words" : "were hard to follow") + ". Aim for complete, standard sentences with a clear subject and verb.",
        refine: "Mostly clear grammar. Watch tense consistency and subject–verb agreement, and avoid stringing clauses into run-ons.",
        praise: "Clean, well-formed sentences. A human rater would hear standard, controlled grammar here."
      },
      fluency: {
        grow: "You spoke at ~" + wpm + " wpm" + (wpm > 170 ? " — too fast." : (wpm < 110 ? " — a bit slow." : ".")) + " Aim for a steady 130–160 wpm and pause instead of using fillers.",
        refine: (wpm >= 110 && wpm <= 170)
          ? "Good pace (~" + wpm + " wpm). Smooth out remaining hesitations and \"um\"s by pausing instead."
          : "Pace was ~" + wpm + " wpm. Work toward a steady 130–160 wpm rhythm and reduce fillers.",
        praise: "Fluent and well-paced (~" + wpm + " wpm) with few fillers. This is the rhythm interviewers want to hear."
      },
      interaction: {
        grow: "Your answer felt general. The interviewer learns about YOU — bring in \"I\", your own experiences, and your reactions.",
        refine: "You engaged (" + pronounCount + " first-person references). Go further: state your own view and react to the question directly.",
        praise: "Strong personal engagement — you clearly shared your own experience and perspective."
      },
      coherence: {
        grow: "Give your answer a clear path: signpost with \"first… then… so…\" and end with a one-line takeaway.",
        refine: "Clear structure — add one more signpost (\"secondly\", \"finally\") and restate your main point at the end.",
        praise: "Well organized and reasoned, with clear transitions and a focused main idea."
      }
    };

    var see = global.WETALK_SEE_CRITERIA || global.WETALK_VERICANT.see;
    var scores = { range: range, accuracy: accuracy, fluency: fluency, interaction: interaction, coherence: coherence, overall: overall };

    var tips = see.map(function (c) {
      var s = scores[c.key];
      return { key: c.key, name: c.name, score: s, text: tipMap[c.key][tier(s)] };
    });

    if (!text) {
      tips.unshift({ key: "note", name: "No transcript", score: 0, text: "We couldn't capture any words. Allow the microphone or type your answer next time to get a full evaluation." });
    }

    return {
      scores: scores,
      stats: { wordCount: wordCount, wpm: wpm, duration: duration, fillers: fillerCount },
      tips: tips
    };
  }

  // Every Vericant section (and each follow-up) is scored on its own, then
  // combined into the official SEE format: five criteria and an overall score
  // out of 6, reported to one decimal place.
  function evaluateVericant() {
    var stages = session.questions || [];
    var per = [];
    var totals = { range: 0, accuracy: 0, fluency: 0, interaction: 0, coherence: 0 };
    var totalWords = 0, totalFillers = 0, totalDuration = 0;
    var n = session.transcripts.length;
    for (var i = 0; i < n; i++) {
      var answer = session.transcripts[i] || "";
      var st = stages[i] || {};
      var s = scoreSpeechVericant(answer, session.speakSecs[i] || 0);
      per.push({
        q: st.text || ("Question " + (i + 1)),
        label: st.section ? (st.section + (st.followup ? " · Follow-up" : "")) : null,
        scores: s.scores,
        stats: s.stats,
        tips: s.tips,
        transcript: answer,
        aiFeedback: null
      });
      totals.range += s.scores.range;
      totals.accuracy += s.scores.accuracy;
      totals.fluency += s.scores.fluency;
      totals.interaction += s.scores.interaction;
      totals.coherence += s.scores.coherence;
      totalWords += s.stats.wordCount;
      totalFillers += s.stats.fillers;
      totalDuration += s.stats.duration;
    }
    if (!n) n = 1;
    function oneDecimal(total) { return Math.round((total / n) * 10) / 10; }
    var overallSum = 0;
    per.forEach(function (p) { overallSum += p.scores.overall; });
    var summaryTip = makeSummaryTip(per, 6, 0.1);
    var see = global.WETALK_SEE_CRITERIA || global.WETALK_VERICANT.see;

    state.currentResult = {
      id: newId(),
      mode: state.currentPrompt.mode,
      modeLabel: state.currentPrompt.modeLabel,
      title: state.currentPrompt.text,
      meta: state.currentPrompt.meta,
      lang: state.currentPrompt.lang,
      diff: state.currentPrompt.diff,
      cat: state.currentPrompt.cat,
      qType: state.currentPrompt.qType,
      startedAt: Date.now(),
      scores: {
        range: oneDecimal(totals.range),
        accuracy: oneDecimal(totals.accuracy),
        fluency: oneDecimal(totals.fluency),
        interaction: oneDecimal(totals.interaction),
        coherence: oneDecimal(totals.coherence),
        overall: oneDecimal(overallSum),
        max: 6
      },
      stats: { wordCount: totalWords, wpm: totalDuration > 0 ? Math.round(totalWords / (totalDuration / 60)) : 0, duration: totalDuration, fillers: totalFillers },
      transcript: session.transcripts.join("\n\n").trim(),
      criteria: see,
      tips: summaryTip ? [summaryTip] : [],
      aiOverall: null,
      questions: per
    };

    renderResults();
  }

  function buildScoreRowsHTML(scores, criteria, maxScore) {
    return criteria.map(function (c) {
      var s = scores[c.key];
      var pct = Math.round((s / maxScore) * 100);
      return '<div class="score-row"><div class="score-row__name">' + escapeHtml(c.name) + '</div>' +
        '<div class="score-row__track"><div class="score-row__fill" data-w="' + pct + '"></div></div>' +
        '<div class="score-row__val">' + fmtScore(s, maxScore) + '</div></div>';
    }).join("");
  }

  function tipHTML(t) {
    var icon = t.key === "note" ? "⚠️" : (t.score <= 3 ? "🌱" : "✅");
    return '<div class="tip"><span class="tip__icon">' + icon + '</span><span><strong>' +
      escapeHtml(t.name) + ':</strong> ' + escapeHtml(t.text) + '</span></div>';
  }

  function animateScoreRows(root) {
    if (!root) return;
    setTimeout(function () {
      var fills = root.querySelectorAll(".score-row__fill");
      for (var i = 0; i < fills.length; i++) fills[i].style.width = fills[i].getAttribute("data-w") + "%";
    }, 60);
  }

  // Official SEE level bands: Proficient 4–6, Intermediate 3, Beginner 1–2.
  function seeBand(overall) {
    if (overall >= 4) return "Proficient";
    if (overall >= 3) return "Intermediate";
    if (overall >= 1) return "Beginner";
    return "";
  }

  // Vericant's official SEE report always shows one decimal place (e.g. 4.0).
  function fmtScore(value, maxScore) {
    var n = Number(value);
    if (isNaN(n)) return String(value);
    return maxScore === 6 ? n.toFixed(1) : String(value);
  }

  function renderResults() {
    var r = state.currentResult;
    var criteria = r.criteria || global.WETALK_CRITERIA;
    var maxScore = (r.scores && r.scores.max) || 5;
    var isMulti = r.questions && r.questions.length;
    var isToefl = r.mode === "toefl";
    var band = maxScore === 6 ? seeBand(r.scores.overall) : "";

    $("resultsPrompt").innerHTML = escapeHtml(r.title).replace(/\n/g, "<br>");
    $("overallBadge").textContent = fmtScore(r.scores.overall, maxScore);
    var overallLabelEl = $("overallLabel");
    if (overallLabelEl) overallLabelEl.textContent = band ? "Overall score (SEE, 0–6) · " + band : "Overall score";
    $("overallMeta").textContent = r.modeLabel + " · spoke ~" + r.stats.duration + "s · " +
      r.stats.wordCount + " words · " + r.stats.wpm + " wpm" +
      (r.stats.fillers ? " · " + r.stats.fillers + " filler words" : "") +
      (maxScore === 6 ? " · SEE scale (0–6)" : "") +
      (isToefl ? " · TOEFL rubric (1–5, 0.5 steps)" : "");

    var aiOverallEl = $("aiOverall");
    if (aiOverallEl) {
      if (r.aiOverall) {
        aiOverallEl.className = "ai-overall";
        aiOverallEl.innerHTML = '<div class="ai-overall__title">🤖 AI Examiner — Overall</div>' +
          '<div class="ai-overall__body">' + escapeHtml(r.aiOverall) + '</div>';
        aiOverallEl.hidden = false;
      } else if (isMulti) {
        aiOverallEl.className = "ai-overall is-loading";
        aiOverallEl.textContent = "Generating AI examiner summary…";
        aiOverallEl.hidden = false;
      } else {
        aiOverallEl.className = "ai-overall";
        aiOverallEl.hidden = true;
      }
    }

    $("scoresList").innerHTML = buildScoreRowsHTML(r.scores, criteria, maxScore);
    $("tipsList").innerHTML = (r.tips || []).map(tipHTML).join("");

    var qList = $("questionsList");
    if (isMulti) {
      qList.innerHTML = r.questions.map(function (q, i) {
        var aiBlock = "";
        if (isMulti) {
          aiBlock = q.aiFeedback
            ? '<div class="qcard__ai"><div class="qcard__ai-title">🤖 AI Feedback</div>' +
              '<div class="qcard__ai-body">' + escapeHtml(q.aiFeedback) + '</div></div>'
            : '<div class="qcard__ai is-loading" id="ai-q-' + i + '">Generating AI feedback…</div>';
        }
        return '<div class="qcard">' +
          '<div class="qcard__head">' +
            '<span class="qcard__num">' + escapeHtml(q.label || ("Question " + (i + 1))) + '</span>' +
            '<span class="qcard__score">' + fmtScore(q.scores.overall, maxScore) + ' / ' + maxScore + '</span>' +
          '</div>' +
          '<div class="qcard__prompt">' + escapeHtml(q.q) + '</div>' +
          '<div class="scores">' + buildScoreRowsHTML(q.scores, criteria, maxScore) + '</div>' +
          '<div class="tips">' + (q.tips || []).map(tipHTML).join("") + '</div>' +
          '<div class="qcard__transcript"><strong>Your answer:</strong> ' + escapeHtml(q.transcript || "(no answer captured)") + '</div>' +
          aiBlock +
        '</div>';
      }).join("");
      qList.hidden = false;
    } else {
      qList.innerHTML = "";
      qList.hidden = true;
    }

    var wrap = $("resultsTranscriptWrap");
    if (wrap) wrap.hidden = isMulti;
    $("resultsTranscript").textContent = r.transcript || "(no transcript captured)";

    animateScoreRows($("view-results"));
    showView("results");
    if (isMulti && !r.aiOverall) requestAiFeedback(r);
  }

  // ---------------- AI feedback (included AI via the Wetalk account) ----------------
  var API_KEY_STORAGE = "wetalk.v2.apiKey";
  var AI_FEEDBACK_TIMEOUT = 30000;

  function openSettings() {
    var status = $("aiStatus");
    if (status) {
      var platform = !!(global.WetalkLLM && WetalkLLM.isPlatformMode && WetalkLLM.isPlatformMode());
      var personal = !!(global.WetalkLLM && WetalkLLM.hasPersonalKey && WetalkLLM.hasPersonalKey());
      if (platform) {
        status.textContent = "AI feedback is included with your account. " +
          (WetalkLLM.quotaSummary ? WetalkLLM.quotaSummary() : "");
      } else if (personal) {
        status.textContent = "AI feedback is using the API key saved on this device.";
      } else {
        status.textContent = "AI feedback is unavailable right now - the rule-based coaching tips still work.";
      }
    }
    $("settingsModal").hidden = false;
  }
  function closeSettings() { $("settingsModal").hidden = true; }

  function requestAiFeedback(result) {
    if (!result || !result.questions || !result.questions.length || result.aiOverall) return;
    if (result.mode !== "toefl" && result.mode !== "interview") return;
    var isInterview = result.mode === "interview";
    var questions = result.questions.map(function (q, i) {
      return { index: i + 1, prompt: q.q, label: isInterview ? (q.label || "") : "", transcript: q.transcript, stats: q.stats, scores: q.scores };
    });
    if (!global.WetalkV2AI || typeof global.WetalkV2AI.requestFeedback !== "function") {
      applyAiFeedback(result, { error: "unavailable" });
      return;
    }
    global.WetalkV2AI.requestFeedback({
      rubric: isInterview ? "vericant" : "toefl",
      topic: result.title || "",
      questions: questions
    }).then(function (data) {
      applyAiFeedback(result, data);
    }).catch(function (err) {
      applyAiFeedback(result, { error: (err && (err.code || err.message)) || "network" });
    });
  }

  function applyAiFeedback(result, data) {
    // A late reply must never overwrite the results page of a newer session,
    // but it should still be persisted for this result (the user may already
    // have saved it and be looking at its history page).
    var isCurrent = result === state.currentResult;
    var qs = (data && data.questions) || [];
    var ok = data && !data.error && qs.length;

    if (!ok) {
      if (!isCurrent) return;
      var code = data && data.error;
      var reason = code === "quota_exceeded"
        ? "Daily AI limit reached - you can keep practising and the rule-based tips above still apply. AI feedback resets tomorrow (UTC)."
        : (code === "unauthorized" || code === "no_config")
          ? "AI feedback needs a signed-in account - sign in again to enable the included AI. The rule-based tips above still apply."
          : "AI feedback is unavailable right now (network or AI error). The rule-based tips above still apply.";
      result.questions.forEach(function (q, i) {
        var el = $("ai-q-" + i);
        if (el) { el.className = "qcard__ai qcard__note"; el.textContent = reason; }
      });
      var failOv = $("aiOverall");
      if (failOv) { failOv.className = "ai-overall"; failOv.hidden = true; }
      if (code === "quota_exceeded") toast("Daily AI limit reached - using rule-based tips.");
      return;
    }

    result.questions.forEach(function (q, i) {
      var text = (qs[i] && qs[i].feedback) || "";
      q.aiFeedback = text || null;
      if (!isCurrent) return;
      var el = $("ai-q-" + i);
      if (!el) return;
      if (!text) {
        el.className = "qcard__ai qcard__note";
        el.textContent = "No AI feedback was returned for this question. The rule-based tips above still apply.";
        return;
      }
      el.className = "qcard__ai";
      el.innerHTML = '<div class="qcard__ai-title">🤖 AI Feedback</div>' +
        '<div class="qcard__ai-body">' + escapeHtml(text) + '</div>';
    });
    if (data.overall) result.aiOverall = data.overall;
    if (isCurrent) {
      var ov = $("aiOverall");
      if (ov && data.overall) {
        ov.className = "ai-overall";
        ov.innerHTML = '<div class="ai-overall__title">🤖 AI Examiner — Overall</div>' +
          '<div class="ai-overall__body">' + escapeHtml(data.overall) + '</div>';
        ov.hidden = false;
      } else if (ov) {
        ov.className = "ai-overall";
        ov.hidden = true;
      }
    }
    // If the user already saved this session, refresh the stored copy (and the
    // history page itself if that is what they are currently viewing).
    var stored = getHistory();
    for (var j = 0; j < stored.length; j++) {
      if (stored[j] && stored[j].id === result.id) {
        stored[j] = result;
        saveHistory(stored);
        if (state.mode === "history" && state.viewHistoryId === result.id) openHistory(result.id);
        break;
      }
    }
  }

  // ---------------- History ----------------
  var HISTORY_KEY = "wetalk.v2.history";

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) {}
    // Mirror the change to the signed-in account's cloud history.
    try {
      if (global.WetalkV2Cloud && typeof global.WetalkV2Cloud.onLocalChange === "function") {
        global.WetalkV2Cloud.onLocalChange(list);
      }
    } catch (e) {}
  }

  var MODE_ICON = { impromptu: "🎤", interview: "🎥", toefl: "🗣️" };
  var MODE_NAME = { impromptu: "Impromptu", interview: "Vericant", toefl: "TOEFL" };

  function renderHistory() {
    var list = getHistory();
    var el = $("historyList");
    if (!list.length) {
      el.innerHTML = '<div class="sidebar__empty">No practice yet.<br />Start your first session.</div>';
      return;
    }
    el.innerHTML = "";
    list.forEach(function (item) {
      var b = document.createElement("button");
      b.className = "history-item" + (state.viewHistoryId === item.id ? " is-active" : "");
      b.type = "button";
      var icon = MODE_ICON[item.mode] || "🎤";
      var score = item.scores && item.scores.overall != null ? item.scores.overall : null;
      b.innerHTML = '<span class="history-item__icon">' + icon + '</span>' +
        '<span class="history-item__body">' +
          '<span class="history-item__title">' + escapeHtml(item.title) + '</span>' +
          '<span class="history-item__meta">' +
            '<span>' + (MODE_NAME[item.mode] || item.mode) + '</span>' +
            '<span>' + formatDate(item.startedAt) + '</span>' +
            (score != null ? '<span class="history-item__score">' + fmtScore(score, item.scores.max || 5) + '/' + (item.scores.max || 5) + '</span>' : '') +
          '</span>' +
        '</span>';
      b.addEventListener("click", function () { openHistory(item.id); });
      el.appendChild(b);
    });
  }

  function formatDate(ms) {
    var d = new Date(ms);
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return "Today " + hm;
    var md = d.toLocaleDateString([], { month: "short", day: "numeric" });
    return md + " " + hm;
  }

  function openHistory(id) {
    stopSession();
    var item = getHistory().filter(function (w) { return w.id === id; })[0];
    if (!item) return;
    state.viewHistoryId = id;
    showView("history");
    $("historyTitle").innerHTML = escapeHtml(item.title).replace(/\n/g, "<br>");
    $("historySub").textContent = item.modeLabel + " · " + formatDate(item.startedAt);

    var detail = $("historyDetail");
    var rows = '<div class="history-meta-card">';
    if (item.meta) rows += '<div class="hm-row"><span class="hm-k">Settings</span><span class="hm-v">' + escapeHtml(item.meta) + '</span></div>';
    rows += '<div class="hm-row"><span class="hm-k">Duration</span><span class="hm-v">~' + item.stats.duration + 's</span></div>';
    rows += '<div class="hm-row"><span class="hm-k">Words</span><span class="hm-v">' + item.stats.wordCount + '</span></div>';
    rows += '<div class="hm-row"><span class="hm-k">Pace</span><span class="hm-v">' + item.stats.wpm + ' wpm</span></div>';
    rows += '</div>';

    var maxScore = (item.scores && item.scores.max) || 5;
    var criteria = item.criteria || global.WETALK_CRITERIA;
    var band = maxScore === 6 ? seeBand(item.scores.overall) : "";
    var overall = '<div class="overall"><div class="overall__badge">' + fmtScore(item.scores.overall, maxScore) + '</div>' +
      '<div class="overall__label">Overall score (' + (maxScore === 6 ? "SEE, 0–6" : "1–5") + ')' + (band ? ' · ' + band : '') + '</div></div>';
    var aiOverall = item.aiOverall
      ? '<div class="ai-overall"><div class="ai-overall__title">🤖 AI Examiner — Overall</div>' +
        '<div class="ai-overall__body">' + escapeHtml(item.aiOverall) + '</div></div>'
      : "";

    var scores = '<div class="scores">' + buildScoreRowsHTML(item.scores, criteria, maxScore) + '</div>';

    var tips = item.tips && item.tips.length
      ? '<div class="tips"><div class="tips__title">Coaching tips</div>' + item.tips.map(tipHTML).join("") + '</div>'
      : "";

    var questions = "";
    var transcript = "";
    if (item.questions && item.questions.length) {
      questions = '<div class="questions">' + item.questions.map(function (q, i) {
        var aiBlock = q.aiFeedback
          ? '<div class="qcard__ai"><div class="qcard__ai-title">🤖 AI Feedback</div>' +
            '<div class="qcard__ai-body">' + escapeHtml(q.aiFeedback) + '</div></div>'
          : "";
        return '<div class="qcard">' +
          '<div class="qcard__head"><span class="qcard__num">' + escapeHtml(q.label || ("Question " + (i + 1))) + '</span>' +
          '<span class="qcard__score">' + fmtScore(q.scores.overall, maxScore) + ' / ' + maxScore + '</span></div>' +
          '<div class="qcard__prompt">' + escapeHtml(q.q) + '</div>' +
          '<div class="scores">' + buildScoreRowsHTML(q.scores, criteria, maxScore) + '</div>' +
          '<div class="tips">' + (q.tips || []).map(tipHTML).join("") + '</div>' +
          '<div class="qcard__transcript"><strong>Your answer:</strong> ' + escapeHtml(q.transcript || "(no answer captured)") + '</div>' +
          aiBlock +
        '</div>';
      }).join("") + '</div>';
    } else {
      transcript = '<div class="results__transcript"><div class="transcript__title">Your transcript</div>' +
        '<div class="transcript__box transcript__box--readonly">' + escapeHtml(item.transcript || "(no transcript)") + '</div></div>';
    }

    detail.innerHTML = rows + overall + aiOverall + scores + tips + questions + transcript;
    animateScoreRows(detail);
    renderHistory();
  }

  function saveResult() {
    var r = state.currentResult;
    if (!r) return;
    var list = getHistory();
    list.unshift(r);
    saveHistory(list.slice(0, 300));
    toast("Saved to your work.");
    openHistory(r.id);
  }

  // ---------------- Wiring ----------------
  function wire() {
    document.querySelectorAll(".mode-card").forEach(function (card) {
      card.addEventListener("click", function () { openMode(card.getAttribute("data-mode")); });
    });

    $("btnNewWork").addEventListener("click", goHome);
    $("btnHome").addEventListener("click", goHome);

    $("btnSpin").addEventListener("click", function () { spin("impromptu"); });
    $("btnInterviewSpin").addEventListener("click", function () { spin("interview"); });
    $("btnToeflSpin").addEventListener("click", function () { spin("toefl"); });

    $("btnBegin").addEventListener("click", beginPractice);
    $("btnInterviewBegin").addEventListener("click", beginPractice);
    $("btnToeflBegin").addEventListener("click", beginPractice);

    $("btnRespin").addEventListener("click", function () { spin("impromptu"); });
    $("btnInterviewRespin").addEventListener("click", function () { spin("interview"); });
    $("btnToeflRespin").addEventListener("click", function () { spin("toefl"); });

    $("btnStartPrep").addEventListener("click", startPrep);
    $("btnStartSpeaking").addEventListener("click", startSpeaking);
    $("btnFinish").addEventListener("click", completeQuestion);
    $("btnReplay").addEventListener("click", replayQuestion);

    $("btnSettings").addEventListener("click", openSettings);
    $("btnSettingsSave").addEventListener("click", closeSettings);
    $("settingsModal").addEventListener("click", function (e) {
      if (e.target === $("settingsModal")) closeSettings();
    });

    $("btnSave").addEventListener("click", saveResult);
    $("btnAgain").addEventListener("click", function () {
      var m = state.currentResult ? state.currentResult.mode : "impromptu";
      openMode(m);
    });
    $("btnHistoryBack").addEventListener("click", function () { goHome(); });
    $("btnHistoryDelete").addEventListener("click", function () {
      var id = state.viewHistoryId;
      if (!id) return;
      saveHistory(getHistory().filter(function (w) { return w.id !== id; }));
      // The sidebar is rendered from localStorage, so it has to be re-rendered
      // here as well - otherwise the deleted work stays visible in "Previous
      // Work" until some other action happens to refresh the list.
      state.viewHistoryId = null;
      renderHistory();
      toast("Deleted.");
      goHome();
    });
    $("btnClearHistory").addEventListener("click", function () {
      if (!getHistory().length) { toast("No history to clear."); return; }
      if (confirm("Clear all previous work? This cannot be undone.")) {
        saveHistory([]);
        toast("History cleared.");
        renderHistory();
      }
    });
  }

  // ---------------- Init ----------------
  function init() {
    renderDropdown("ddLang", "langTrigger", "langMenu", "langIcon", "langValue", global.WETALK_LANGUAGES, state.lang, onLangSelect);
    renderDropdown("ddDiff", "diffTrigger", "diffMenu", "diffIcon", "diffValue", global.WETALK_DIFFICULTIES, state.diff, onDiffSelect);
    renderDropdown("ddCat", "catTrigger", "catMenu", "catIcon", "catValue", categoriesForLang(state.lang), state.cat, onCatSelect);

    $("topicText").classList.add("is-placeholder");
    $("interviewText").classList.add("is-placeholder");
    $("toeflText").classList.add("is-placeholder");

    wire();
    renderHistory();
    showView("home");

    // Pull the account's cloud history (a no-op when no account is signed in).
    try {
      if (global.WetalkV2Cloud && typeof global.WetalkV2Cloud.init === "function") {
        global.WetalkV2Cloud.init().then(function () {
          renderHistory();
        }).catch(function () {});
      }
    } catch (e) {}
  }

  // Minimal API for the account/cloud integration layer.
  global.WetalkV2 = {
    getHistory: getHistory,
    saveHistory: saveHistory,
    renderHistory: renderHistory,
    toast: toast
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
