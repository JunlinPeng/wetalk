/* ============================================================
   Wetalk — planner module (AI schedule + PowerPoint outline)

   Generates a day-by-day practice plan from the speech + deadline,
   and a PowerPoint outline, using the user's connected LLM provider.
   Falls back to a simple offline plan/outline if the call fails.
   ============================================================ */
(function (global) {
  "use strict";

  var BQ = String.fromCharCode(96); // backtick (avoided in source for safety)

  // ---- JSON extraction (handles prose / markdown / truncated) ----
  function extractJSON(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) {}

    var mdRe = new RegExp(BQ + BQ + BQ + "(?:json)?\\s*\\n?([\\s\\S]*?)\\n?" + BQ + BQ + BQ);
    var md = text.match(mdRe);
    if (md) { try { return JSON.parse(md[1]); } catch (e) {} }

    var start = text.indexOf("{");
    if (start !== -1) {
      var depth = 0;
      for (var i = start; i < text.length; i++) {
        var ch = text[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { break; }
          }
        }
      }
    }
    return null;
  }

  // ---- offline fallbacks ----
  function fallbackSchedule(speech, days) {
    var paragraphs = (speech || "").split(/\n\n+/).filter(function (s) { return s.trim(); });
    var plan = [];
    for (var d = 0; d < days; d++) {
      plan.push({
        day_number: d + 1,
        focus_area: d === days - 1 ? "Full Dress Rehearsal" : "Memorize and Practice",
        script_segment: paragraphs[d] ? paragraphs[d].slice(0, 500) : "Full run-through",
        tasks: [
          "Read the assigned segment aloud 3 times",
          "Practice with eye contact in front of a mirror",
          "Record yourself and review"
        ],
        estimated_minutes: 30
      });
    }
    return { daily_plan: plan };
  }

  function fallbackPPT(title, speech) {
    var sections = (speech || "").split(/\n\n+/).filter(function (s) { return s.trim(); }).slice(0, 8).map(function (s) {
      return { slide_heading: s.slice(0, 48), bullet_points: [s.slice(0, 140)] };
    });
    return {
      outline_title: title || "Presentation",
      thesis: "",
      sections: sections.length ? sections : [{ slide_heading: "Presentation", bullet_points: ["No content"] }]
    };
  }

  // ---- AI schedule ----
  function generateSchedule(title, speech, days) {
    days = Math.max(1, Math.round(days) || 1);
    // Scale the token budget with the number of days so long plans are not truncated.
    var maxTokens = Math.max(2500, Math.min(days * 100, 8000));
    var system = "You are an expert study planner who helps students prepare for presentations. Create a practical, day-by-day practice schedule.";
    var user =
      "Create a day-by-day practice plan for a student preparing a presentation.\n\n" +
      "TITLE: " + title + "\n" +
      "DAYS UNTIL PRESENTATION: " + days + "\n" +
      "FULL SCRIPT:\n---\n" + (speech || "").slice(0, 6000) + "\n---\n\n" +
      "Return ONLY valid JSON (no markdown, no extra text):\n" +
      "{\n" +
      "  \"daily_plan\": [\n" +
      "    {\"day_number\": 1, \"focus_area\": \"...\", \"script_segment\": \"...\", \"tasks\": [\"...\", \"...\"], \"estimated_minutes\": 30}\n" +
      "  ]\n" +
      "}\n\n" +
      "Rules:\n" +
      "- Create exactly " + days + " days.\n" +
      "- Split the script evenly across the days, with extra focus on opening and closing.\n" +
      "- The last day should be a full dress rehearsal.\n" +
      "- Give each day 2-4 specific, actionable tasks.";

    return WetalkLLM.chat([
      { role: "system", content: system },
      { role: "user", content: user }
    ], { max_tokens: maxTokens }).then(function (text) {
      var obj = extractJSON(text);
      if (obj && obj.daily_plan && obj.daily_plan.length) {
        // If the model returned fewer days than requested, fill the rest with
        // the offline fallback so the user always gets the full plan.
        if (obj.daily_plan.length < days) {
          var fb = fallbackSchedule(speech, days);
          for (var i = obj.daily_plan.length; i < days; i++) {
            obj.daily_plan.push(fb.daily_plan[i]);
          }
        }
        return obj;
      }
      return fallbackSchedule(speech, days);
    }).catch(function () {
      return fallbackSchedule(speech, days);
    });
  }

  // ---- AI PowerPoint outline ----
  function generatePPT(title, speech) {
    var system = "You extract the core structure from a presentation script and format it as a PowerPoint text outline.";
    var user =
      "Extract a PowerPoint text outline from this presentation script.\n\n" +
      "TITLE: " + title + "\n\n" +
      "SCRIPT:\n---\n" + (speech || "").slice(0, 6000) + "\n---\n\n" +
      "Return ONLY valid JSON (no markdown, no extra text):\n" +
      "{\n" +
      "  \"outline_title\": \"Presentation title\",\n" +
      "  \"thesis\": \"One-sentence thesis\",\n" +
      "  \"sections\": [\n" +
      "    {\"slide_heading\": \"Slide heading\", \"bullet_points\": [\"Point 1\", \"Point 2\", \"Point 3\"]}\n" +
      "  ]\n" +
      "}\n\n" +
      "Rules:\n" +
      "- Create 6-12 slides maximum, 3-5 bullet points each.\n" +
      "- Bullets should be short phrases, not full sentences.\n" +
      "- First slide = title + hook, last slide = summary + call to action.";

    return WetalkLLM.chat([
      { role: "system", content: system },
      { role: "user", content: user }
    ], { max_tokens: 2000 }).then(function (text) {
      var obj = extractJSON(text);
      if (obj && (obj.sections || obj.outline_title)) return obj;
      return fallbackPPT(title, speech);
    }).catch(function () {
      return fallbackPPT(title, speech);
    });
  }

  global.WetalkPlanner = {
    extractJSON: extractJSON,
    generateSchedule: generateSchedule,
    generatePPT: generatePPT,
    fallbackSchedule: fallbackSchedule,
    fallbackPPT: fallbackPPT
  };
})(window);
