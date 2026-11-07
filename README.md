# Wetalk

Wetalk is an AI speech-practice web app for students. It has three practice
modes - Impromptu Speech, Vericant Interview and TOEFL Oral Preparation - with
timers, live speech transcription where the browser supports it, rubric-based
scores and an AI examiner for feedback. Every finished session is saved to a
cloud-synced 'Previous Work' sidebar on the left.

**Live site:** <https://junlinpeng.github.io/wetalk/>

## Practice modes

- **Impromptu Speech** - draw an NSDA-style topic (12 languages, difficulty and
  subject-field filters), prepare and speak under the 7:00 clock with a 30-second
  grace, then get scored on organisation, analysis, delivery and creativity.
- **Vericant Interview** - the five-section K-12 admissions interview flow with
  questions read aloud one at a time, per-section timers, transcripts and an SEE
  (SEE) rubric score out of 6 with AI examiner feedback.
- **TOEFL Oral Preparation** - official TOEFL Speaking question sets (four
  questions each, 45 seconds per answer) scored on Delivery, Language Use and
  Topic Development, with AI examiner feedback.
- **Previous Work** - every finished session (prompt, scores, transcript, tips,
  AI feedback) is stored in the account's cloud history and can be reopened or
  deleted from the sidebar.

## Accounts and data

The live site is connected to a Supabase project: sign-up/sign-in are real
(email + password, and GitHub sign-in when the provider is enabled), practice
history syncs to the account, and every row is protected by row-level security.
The browser only ever holds the public publishable/anon key.

AI feedback is included with the account through a Supabase Edge Function proxy
(DeepSeek server-side, no user API key) with a daily allowance (20 requests per
user per day and a global 500/day cap). Rule-based coaching tips always work,
even when AI is unavailable.

If you fork the repository without configuring Supabase, the app automatically
runs in **Preview mode**: accounts and history stay in the browser and a slim
banner says so, so the site still works end-to-end before a backend exists.

Setup guides:

- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) - connect a free Supabase project.
- [docs/AI_PROXY_SETUP.md](docs/AI_PROXY_SETUP.md) - deploy the included AI proxy.
- [docs/OPTIONAL_SETUP.md](docs/OPTIONAL_SETUP.md) - OAuth, custom email, domain.

## Run locally

No build step - plain HTML/CSS/JS. Serve the folder over HTTP so Web Speech and
localStorage behave correctly:

```bash
python -m http.server 8080
# open http://localhost:8080/ (landing) or http://localhost:8080/app.html
```

`app.html` is the practice workspace and requires a signed-in account (use
Preview mode, or connect Supabase as above).

## Project layout

```
index.html              marketing landing page
app.html                Wetalk v2 practice workspace (the app)
signup.html signin.html signup / sign-in (Supabase auth)
reset.html reset-password.html   password reset flow
404.html                branded not-found page
v2/                     Wetalk v2 app assets (css + js + data)
images/                 Vericant / TOEFL topic illustrations
js/config.js            public runtime config (empty = Preview mode)
js/auth.js              accounts, session, OAuth, password reset
js/store.js works.js    legacy cloud/local works sync
js/llm.js               AI routing: included proxy -> personal key -> offline
js/ui.js                shared UI helpers (toasts, transitions)
js/vendor/supabase.js   pinned supabase-js v2 UMD
v2/js/app.js            practice workspace logic (modes, timers, scoring, history)
v2/js/v2-ai.js          TOEFL / Vericant examiner prompts through the AI proxy
v2/js/v2-cloud.js       cloud sync for the Previous Work sidebar
supabase/schema.sql     profiles / works / sessions tables + RLS
supabase/functions/     ai-feedback Edge Function (DeepSeek proxy + quota)
supabase/migrations/    incremental SQL migrations
scripts/                serve / configure_supabase / deploy_ai_proxy / verify_live
tests/                  dev-only unit + Playwright end-to-end tests
docs/                   setup, architecture and testing docs
```

The original prototype pages from the first web version (topic.html, script.html,
schedule.html, practice.html, checkin.html, impromptu.html, works.html) are still
in the repository but are no longer linked; `app.html` is the product.

## Deploy

GitHub Pages serves the `main` branch directly (legacy branch source, repo root).
`.nojekyll` keeps Pages from running Jekyll. Push to `main` and the site redeploys
automatically.

```powershell
powershell -File scripts/verify_live.ps1   # smoke-test the deployed site
```

## Tests

Dev-only tooling; the shipped site stays dependency-free.

```powershell
# unit + e2e (needs node, playwright-core and Microsoft Edge)
node tests/run-all.js
```

See [docs/TESTING.md](docs/TESTING.md).

## Notes

- Live transcription and text-to-speech use the browser's Web Speech APIs
  (best in Edge/Chrome). When unavailable, a text box lets you type your answer
  so you can still practise and get scored.
- AI feedback needs a signed-in account; the rule-based tips always remain.
- AI quota resets on the UTC day.