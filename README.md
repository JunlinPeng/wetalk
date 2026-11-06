# Wetalk

Wetalk is an AI speech coach for students. Write or generate a natural speech,
turn your deadline into a day-by-day practice plan, rehearse with timers, and get
AI feedback scored on organisation, analysis, delivery and creativity. It also
includes an NSDA-style Impromptu trainer (draw 3 prompts, 7-minute round).

**Live site:** <https://junlinpeng.github.io/wetalk/>

## Features

- **I have a topic** - AI-written speech or write it yourself, then a
  personalised schedule and daily check-ins.
- **I don't have a topic** - draw three NSDA-style prompts and run a full
  impromptu round with preparation/speaking timers and scoring.
- **AI feedback** - organisation, analysis, delivery and creativity, with
  concrete fixes instead of vague praise.
- **Previous works** - every speech, plan and score is saved so you can pick up
  where you left off.
- **AI included** - when the server-side AI proxy is configured, signed-in users
  get AI features with no API key of their own (daily quota); otherwise they can
  bring their own OpenAI-compatible key and every AI step has an offline
  fallback.

## Run locally

No build step - plain HTML/CSS/JS. Serve the folder over HTTP:

```bash
python -m http.server 8080      # open http://localhost:8080/
# or
powershell -File scripts/serve.ps1
```

## Accounts and data

Wetalk is **live in Preview mode** until a Supabase project is connected: the
site works end-to-end, but accounts and saved works live in each visitor's
browser (a slim banner says so).

Connect a free Supabase project to get real accounts (email/password, optional
Google/GitHub OAuth, password reset), cloud-saved works and row-level-security
protected data:

1. Follow **[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)** (about 5 minutes).
2. Optionally deploy the AI proxy: **[docs/AI_PROXY_SETUP.md](docs/AI_PROXY_SETUP.md)**.
3. Paste the values into `js/config.js` - or run:

   ```powershell
   powershell -File scripts/configure_supabase.ps1 -SupabaseUrl https://<project-ref>.supabase.co -AnonKey <public-anon-key> -AiProxyUrl https://<project-ref>.supabase.co/functions/v1/ai-feedback -Push
   ```

Only public values go in `js/config.js`; the `service_role` key and the
DeepSeek key stay server-side as Supabase secrets.

## Deploy

GitHub Pages serves the `main` branch directly (legacy branch source, repo
root). `.nojekyll` keeps Pages from running Jekyll. Push to `main` and the site
redeploys automatically - no Actions workflow or extra token scope required.

```powershell
powershell -File scripts/verify_live.ps1   # smoke-test the deployed site
```

## Project layout

```
index.html              marketing landing page
signup.html signin.html signup/reset pages (real Supabase auth or Preview mode)
app.html                signed-in dashboard
works.html              previous works
topic.html              I have a topic
script.html             speech editor / AI generation
schedule.html           practice plan + PowerPoint outline
checkin.html            daily check-in
practice.html           rehearsal + AI feedback
impromptu.html          impromptu round trainer
reset.html reset-password.html   password reset flow
404.html                branded not-found page
css/styles.css          design system (5-colour palette, responsive)
js/config.js            public runtime config (empty by default = Preview mode)
js/auth.js              accounts, session, OAuth, password reset
js/store.js works.js    cloud/local works sync
js/llm.js               AI routing: platform proxy -> personal key -> offline
js/planner.js           schedule + PPT generation
js/practice.js          practice session + scoring
js/impromptu.js         impromptu round
js/topics.js            multilingual impromptu topic bank
js/ui.js                shared UI helpers (toasts, user chip, transitions)
js/vendor/supabase.js   pinned supabase-js v2 UMD (2.57.4)
supabase/schema.sql     profiles / works / ai_usage + RLS + triggers
supabase/functions/     ai-feedback Edge Function (DeepSeek proxy + quota)
scripts/                serve / configure_supabase / verify_live helpers
tests/                  dev-only unit + Playwright e2e tests
docs/                   setup, architecture and testing docs
```

## Tests

Dev-only tooling; the shipped site stays dependency-free.

```powershell
# unit + e2e (needs node + locally installed playwright-core + Microsoft Edge)
node tests/run-all.js
```

59 unit tests and about 125 browser checks cover every page, the Preview-mode
auth flow, link integrity, accessibility smoke checks, responsive layouts
(390 px / 1440 px) and screenshots. See [docs/TESTING.md](docs/TESTING.md).

## Notes and limitations

- Preview mode accounts are local to one browser. Real accounts require the
  Supabase setup above.
- Vericant-style interview and TOEFL speaking modes shown on the landing page
  are marked 'Coming soon'; the two core modes (topic and impromptu) are fully
  implemented.
- AI quality and availability depend on the configured provider (DeepSeek by
  default in the platform proxy). Every AI step falls back to offline
  heuristics when no AI is available.