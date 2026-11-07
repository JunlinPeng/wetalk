/* ============================================================
   Wetalk v2 - AI examiner feedback for the practice workspace

   The v2 app used to POST to the local server (/api/feedback) with a
   DeepSeek API key from Settings. On the web, the same TOEFL / Vericant
   examiner prompts are sent through the account's included AI
   (WetalkLLM -> Supabase Edge Function, daily quota), so visitors need
   no key of their own. Any failure simply leaves the rule-based tips in
   place.

   Contract: window.WetalkV2AI.requestFeedback({ rubric, topic, questions })
     -> Promise<{ questions: [{ feedback }], overall }>
   ============================================================ */
(function (global) {
  "use strict";

  var SYSTEM_PROMPTS = {
    toefl:
      "You are an experienced TOEFL Speaking examiner. Evaluate each student answer " +
      "against the official TOEFL Speaking rubric: Delivery (clear, fluid, well-paced " +
      "speech), Language Use (grammatical accuracy and vocabulary range), and Topic " +
      "Development (complete, coherent answer with reasons and examples). Be specific, " +
      "encouraging and actionable: quote or reference the student's own words and their " +
      "word count / pace / filler stats where useful, and name one concrete thing to " +
      "improve per answer. Reply with strict JSON only, no markdown fences, of the exact " +
      'shape {"questions":[{"feedback":"..."}],"overall":"..."} with exactly one ' +
      "feedback string (2-4 sentences) per question in the order given, and a 2-3 " +
      "sentence overall comment summarising strengths and the single highest priority " +
      "for improvement.",
    vericant:
      "You are an experienced Vericant SEE examiner who scores K-12 admissions video " +
      "interviews. Evaluate each student answer against the official SEE rubric, whose " +
      "five categories are each scored from 0 to 6: Linguistic Range (the variety and " +
      "precision of the words and expressions at the student's disposal), Grammatical " +
      "Accuracy (the student's control of grammar), Fluency (pace, clarity and speech " +
      "production), Conversational Interaction (engagement and participation, including " +
      "how well follow-up questions are handled), and Coherence (well-structured speech " +
      "that leaves no loose ends). The overall SEE score is the average of the five " +
      "categories reported to one decimal place, with level bands Proficient (4-6), " +
      "Intermediate (3) and Beginner (1-2). Be specific, encouraging and actionable: " +
      "quote or paraphrase the student's own words and mention their word count / pace " +
      "/ filler stats where useful, and name one concrete thing to improve per answer. " +
      "Reply with strict JSON only, no markdown fences, of the exact shape " +
      '{"questions":[{"feedback":"..."}],"overall":"..."} with exactly one feedback ' +
      "string (2-4 sentences) per question in the order given. Questions may be labelled " +
      "by interview section or as a follow-up, so make the section context clear. Finish " +
      "with a 2-3 sentence overall comment summarising strengths, the overall SEE level, " +
      "and the single highest priority for improvement."
  };

  function aiError(code, message) {
    var err = new Error(message || "AI feedback is unavailable.");
    err.code = code || "upstream";
    return err;
  }

  function buildUserPrompt(payload) {
    var questions = (payload && payload.questions) || [];
    var topic = String((payload && payload.topic) || "General").trim();
    var lines = ["Topic: " + topic, ""];
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i] || {};
      var transcript = String(q.transcript || "").trim().slice(0, 1200);
      var prompt = String(q.prompt || "").trim().slice(0, 600);
      var label = String(q.label || "").trim();
      var stats = q.stats || {};
      if (label) prompt = prompt + " - " + label;
      lines.push("Question " + (i + 1) + ": " + prompt);
      lines.push('Student answer: "' + (transcript || "(no transcript captured - the student may not have answered)") + '"');
      lines.push(
        "Stats: " + (stats.wordCount != null ? stats.wordCount : "?") + " words, about " +
        (stats.wpm != null ? stats.wpm : "?") + " wpm, " +
        (stats.fillers != null ? stats.fillers : "?") + " filler words."
      );
      lines.push("");
    }
    lines.push("Write examiner feedback for each of the " + questions.length + " questions in order, then the overall comment.");
    return lines.join("\n");
  }

  // Pull the first JSON object out of a model reply (fenced / bare / embedded).
  function extractJson(text) {
    text = (text || "").trim();
    if (!text) return null;
    var candidates = [];
    var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) candidates.push(fenced[1].trim());
    candidates.push(text);
    var start = text.indexOf("{");
    if (start !== -1) {
      var depth = 0, inString = false, escaped = false;
      for (var i = start; i < text.length; i++) {
        var ch = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) { candidates.push(text.slice(start, i + 1)); break; }
        }
      }
    }
    for (var c = 0; c < candidates.length; c++) {
      try {
        var parsed = JSON.parse(candidates[c]);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) { /* try the next candidate */ }
    }
    return null;
  }

  function requestFeedback(payload) {
    if (!global.WetalkLLM || typeof global.WetalkLLM.chat !== "function") {
      return Promise.reject(aiError("unavailable", "AI feedback is not available on this page."));
    }
    payload = payload || {};
    var rubric = payload.rubric === "vericant" ? "vericant" : "toefl";
    var messages = [
      { role: "system", content: SYSTEM_PROMPTS[rubric] },
      { role: "user", content: buildUserPrompt(payload) }
    ];
    return global.WetalkLLM.chat(messages, {
      temperature: 0.4,
      max_tokens: rubric === "vericant" ? 1600 : 1000
    }).then(function (content) {
      var parsed = extractJson(content);
      if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) {
        throw aiError("upstream", "The AI examiner returned an unexpected answer.");
      }
      return {
        questions: parsed.questions.map(function (item) {
          if (typeof item === "string") return { feedback: item };
          return { feedback: String((item && item.feedback) || "") };
        }),
        overall: String(parsed.overall || "")
      };
    }, function (err) {
      // Preserve the useful platform error codes for the UI.
      var code = (err && err.code) || "upstream";
      throw aiError(code, (err && err.message) || "AI feedback is unavailable.");
    });
  }

  global.WetalkV2AI = {
    requestFeedback: requestFeedback,
    buildUserPrompt: buildUserPrompt,
    extractJson: extractJson
  };
})(window);
