# Wetalk Launch Kit

Everything needed to bring in the first wave of users, in execution order.
Items marked **[you]** need your own accounts — everything else is already
shipped in the repo.

Live site: https://junlinpeng.github.io/wetalk/

---

## Step 1 — Switch on analytics **[you]** (5 minutes)

1. Register a free site at <https://www.goatcounter.com> (pick a site code,
   e.g. `wetalk` → `wetalk.goatcounter.com`). No email verification delays,
   no cookies, no personal data — matches our privacy page.
2. In `index.html` and `app.html`, replace `YOUR-SITE` in the
   `data-goatcounter` attribute with your site code (one occurrence per file).
3. Commit and push. Within minutes you will see page views, referrers and
   browsers in the GoatCounter dashboard — this is how you measure every
   promotion below.

## Step 2 — Get indexed by search engines **[you]** (15 minutes)

`robots.txt` and `sitemap.xml` are already deployed.

1. **Google Search Console** — <https://search.google.com/search-console>
   Add property `https://junlinpeng.github.io/wetalk/` (verify via the
   GitHub-verified domain or HTML tag), then submit
   `https://junlinpeng.github.io/wetalk/sitemap.xml`.
2. **Bing Webmaster Tools** — <https://www.bing.com/webmasters>
   Import from Google Search Console (one click) or add the site manually and
   submit the same sitemap. Bing also feeds DuckDuckGo.
3. Check indexing a week later with `site:junlinpeng.github.io/wetalk` in
   Google.

## Step 3 — Verify the social card (1 minute)

The Open Graph card (`assets/og-card.png`) is wired into every public page.

- Preview: <https://www.opengraph.xyz/url/https%3A%2F%2Fjunlinpeng.github.io%2Fwetalk%2F>
- If you ever change the card, re-generate it with
  `python scripts/make_og_card.py` and re-check the preview.

## Step 4 — Capture a 30-second demo GIF **[you]** (30 minutes)

Posts with a demo outperform text-only posts everywhere. Record one:

1. Sign in, start an **Impromptu Speech** round (most visual mode).
2. Screen-record (Windows: `Win+G`, or ScreenToGif/ShareX) while you draw a
   topic, speak ~20 seconds, and the score + AI feedback appears.
3. Trim to 20–40 seconds, under 5 MB. Save as `docs/demo.gif` if you want it
   in the README too.

## Step 5 — Post where your users are

Three audiences, three messages. **Do not post the same text everywhere** —
each community below gets a tailored draft. Spread posts over a week, and
reply to every comment on your own posts.

### 5a. Reddit — r/TOEFL, r/ToeflPractice

> **Title:** I built a free TOEFL Speaking practice site — 4 questions, 45s each, scored on the real rubric with AI feedback
>
> I kept running out of graded TOEFL speaking practice, so I built the tool I
> wanted: four official-style questions read aloud one at a time, 45 seconds
> to answer each, then a score on the actual TOEFL rubric (Delivery, Language
> Use, Topic Development) plus AI feedback that quotes your own answer and
> names the one thing to fix first.
>
> It runs in the browser, nothing to install, free account includes the AI
> feedback and saves every attempt so you can see progress.
>
> https://junlinpeng.github.io/wetalk/
>
> Happy to answer questions — and if a question feels unlike the real test,
> tell me and I'll fix the bank.

### 5b. Reddit — r/ApplyingToCollege, r/IntlToUSA, r/ChanceMe (Vericant angle)

> **Title:** Free Vericant interview simulator — all 5 sections, timed, scored on the SEE rubric
>
> For anyone doing the Vericant interview for school admissions: I built a
> free simulator that runs the real flow — introduction, picture task,
> in-depth, reflective and free speech sections — with per-section timers and
> follow-up questions. At the end you get a SEE-style score out of 6 and AI
> feedback on your actual answers.
>
> It saved me from paying for mock interviews just to get comfortable with
> the format. Browser only, nothing to install:
> https://junlinpeng.github.io/wetalk/
>
> Feedback welcome, especially from anyone who has done the real interview.

### 5c. Reddit — r/publicspeaking, r/speechanddebate

> **Title:** Free impromptu speech practice — NSDA-style topics, 7:00 clock, scored on 4 criteria
>
> I built a browser tool for impromptu practice: draw an NSDA-style topic
> (quotations, proverbs, objects, current events — with difficulty and
> subject filters, 12 languages), prepare and speak under the 7:00 clock with
> the 30-second grace, and get scored on organisation, analysis, delivery and
> creativity. Every round is saved with AI coaching notes.
>
> Free, nothing to install: https://junlinpeng.github.io/wetalk/
>
> Coaches: if your students use it, tell me what would make it useful in
> practice rounds.

**Reddit rules that keep you unbanned:** read each sub's self-promotion
policy first; post as a genuine community member (comment on other threads
for a few days before/after); never repost the same link within a month.

### 5d. Show HN — news.ycombinator.com **[you]**

> **Title:** Show HN: Wetalk – timed speaking practice for TOEFL, admissions interviews and impromptu, scored in the browser
>
> Post Tuesday–Thursday, 8–10am US Eastern. First comment (post it yourself
> immediately): why you built it, the stack (static HTML/JS on GitHub Pages,
> Supabase auth + Postgres with RLS, DeepSeek through an edge-function proxy,
> Web Speech API for live transcription), and what's next.

### 5e. X / Twitter thread **[you]**

> 1/ I kept blanking on speaking tests, so I built Wetalk: free, timed
> speaking practice in the browser, scored on the real rubrics.
> https://junlinpeng.github.io/wetalk/
>
> 2/ Three modes: Impromptu Speech (NSDA topics, 7:00 clock), the full
> 5-section Vericant interview (SEE rubric), and TOEFL Speaking (4 questions,
> 45s each).
>
> 3/ Every round is transcribed, scored and saved. An AI examiner reads your
> transcript, quotes your own words and tells you the ONE thing to fix next.
> It's included free with the account.
>
> 4/ Nothing to install — runs on a school laptop or a phone. I'd love
> feedback from anyone preparing for TOEFL or admissions interviews. What
> should mode #4 be?

### 5f. Product Hunt launch **[you]** (do this after 5a–5e, on a Tue–Thu)

- **Tagline (60 chars):** Timed speaking practice, scored on real rubrics
- **Short description (260 chars):** Wetalk is a free browser workspace for
  spoken English: impromptu speeches under a 7:00 clock, the five-section
  Vericant admissions interview, and TOEFL speaking questions — every round
  timed, transcribed, scored on the official rubric and reviewed by an AI
  examiner.
- **First comment (post as maker):** what problem you had, who it's for
  (TOEFL takers, K-12 applicants doing Vericant, speech & debate students),
  that it's free and open about its stack, and ask: "what speaking test
  should I add next?"
- **Topics:** Education, Language Learning, Productivity
- Upload the demo GIF as the first gallery item and `assets/og-card.png` as
  the thumbnail.

## Step 6 — Directory listings **[you]** (drip over 2 weeks)

- <https://alternativeto.net> — list as an alternative to "Speechling" / "ELSA Speak"
- <https://www.saashub.com>
- <https://theresanaiforthat.com> (it has AI examiner feedback)
- <https://www.producthunt.com> (Step 5f)
- Relevant GitHub awesome lists (search "awesome toefl", "awesome language learning")

## Step 7 — Built-in growth loop (already shipped)

- Every results screen now has a **Share Result** button (native share sheet
  on phones, clipboard copy on desktop) that posts the score + site link.
  Users recruit users; you don't have to do anything.
- Watch GoatCounter referrers weekly: double down on whichever channel sends
  signups, drop the ones that don't.

## Weekly rhythm

| Day | Action |
| --- | --- |
| Mon | Check GoatCounter referrers + Search Console queries |
| Tue | One community post from Step 5 (rotate communities) |
| Wed | Reply to every comment/question on previous posts |
| Thu | Ship one improvement users asked for; mention it in the threads |
| Fri | Add one FAQ entry to the landing page from a real user question (SEO) |
