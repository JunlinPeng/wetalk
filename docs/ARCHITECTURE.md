# Wetalk Web - Architecture

Wetalk is a **static multi-page site** deployed to GitHub Pages with a
**Supabase** backend (Auth + Postgres + Edge Functions). There is no build step:
plain HTML, CSS and classic-script JavaScript are served straight from the
repository root.

Its two halves are:

1. **The landing + account pages** (`index.html`, `signup.html`, `signin.html`,
   `reset.html`, `reset-password.html`) - marketing, real accounts, password reset.
2. **The practice workspace** (`app.html` + `v2/`) - the Wetalk v2 app: a
   single-page workspace with three modes and a cloud-synced history sidebar.

With no Supabase configuration the whole site runs in **Preview mode**: accounts
and history live in the browser, so it is always deployable and demoable.

## Runtime configuration

`js/config.js` exposes `window.WETALK_CONFIG`:

```
{ supabaseUrl, supabaseAnonKey, aiProxyUrl, siteUrl }
```

Only public values belong here. Empty values mean Preview mode. The service-role
key and the DeepSeek key are Supabase secrets and never reach the browser.

## Frontend modules

Landing/auth pages load: `config.js` -> `vendor/supabase.js` -> `auth.js` -> `ui.js`.

The practice workspace (`app.html`) loads, in order:

`config.js` -> `vendor/supabase.js` -> `auth.js` (auth guard) -> `llm.js` ->
`ui.js` -> `v2/js/data.js` -> `v2/js/topics.js` -> `v2/js/v2-ai.js` ->
`v2/js/v2-cloud.js` -> `v2/js/app.js`.

| Module | Global | Responsibility |
| --- | --- | --- |
| `js/config.js` | `WETALK_CONFIG` | public runtime config |
| `js/auth.js` | `WetalkAuth` | accounts, session cache, OAuth, password reset, Preview fallback |
| `js/llm.js` | `WetalkLLM` | AI routing: included Edge Function proxy -> personal key -> reject |
| `js/ui.js` | `WetalkUI` | toasts, transitions, small shared helpers |
| `v2/js/app.js` | - | the v2 workspace: three modes, timers, Web Speech transcription, rubric scoring, local history, results UI |
| `v2/js/data.js` | `WETALK_*` | languages, categories, Vericant + TOEFL banks, SEE/TOEFL criteria |
| `v2/js/topics.js` | `WETALK_TOPIC_BANKS` | multilingual impromptu topic bank |
| `v2/js/v2-ai.js` | `WetalkV2AI` | TOEFL/Vericant examiner prompts -> `WetalkLLM.chat` -> parsed feedback |
| `v2/js/v2-cloud.js` | `WetalkV2Cloud` | mirror `Previous Work` to `public.sessions` (pull/push/delete) |

## Auth

`js/auth.js` chooses its mode from `js/config.js`:

- **Preview mode** - accounts and sessions in localStorage; a slim
  `.preview-banner` explains it. Used when config is empty (e.g. a fork).
- **Supabase mode** - sign-up / sign-in / OAuth / reset go through Supabase Auth.
  A minimal profile is cached in `localStorage[wetalk.session]` so
  `getSession()` and `requireAuth()` stay synchronous; Supabase remains the
  source of truth and is re-checked in the background.

`app.html` calls `WetalkAuth.requireAuth()` before rendering; signed-out visitors
are redirected to `signin.html?next=app.html`. After sign-in and signup the app
always lands on `app.html`.

Contract used by pages and modules:

```
getSession() -> { id, username, email, provider, avatar } | null   // sync cache
requireAuth() -> boolean      // sync; redirects to signin.html?next=<page>
isPreviewMode() -> boolean
createAccount({ email, username, password }) -> Promise<{ok, error?, needsConfirmation?}>
authenticate(email, password) -> Promise<{ok, error?}>
signOut() / oauthSignIn(provider) / resetPassword(email) / updatePassword(pw)
getClient() -> SupabaseClient | null
getAccessToken() -> Promise<string | null>
onChange(callback) -> void
```

## AI feedback

`v2/js/v2-ai.js` builds the TOEFL or Vericant examiner prompt from the finished
result (topic, per-question prompt, transcript and pace/filler stats) and calls
`WetalkLLM.chat(messages, {max_tokens})`. `js/llm.js` tries:

1. **Included AI** - `aiProxyUrl` + a real Supabase session; the Edge Function
   verifies the JWT, enforces the daily quota in `public.ai_usage`, calls
   DeepSeek with the server-side key and returns `{content, remaining, limit}`.
2. **Personal key** - the account's own OpenAI-compatible key, if configured.
3. Otherwise the promise rejects and the v2 UI keeps its rule-based coaching tips
   (visible in the results page and stored with the session).

Quota: 20 requests/user/UTC-day (`DAILY_AI_LIMIT`) and a global 500/day cap
(`GLOBAL_DAILY_LIMIT`), both configurable as Supabase Edge Function secrets.

## History and cloud sync

The v2 workspace writes finished sessions to `localStorage[wetalk.v2.history]`
immediately (synchronous render, offline support). `saveHistory()` also calls
`WetalkV2Cloud.onLocalChange(list)`, which debounces then:

- upserts new/changed sessions into `public.sessions`,
- deletes rows whose ids disappeared from the list,
- never throws when offline, signed out or in Preview mode.

On app start `WetalkV2Cloud.init()` pulls the account's sessions, merges them into
the local cache and re-renders the sidebar. Each row stores the full session
object as a JSON payload, so reopening a work restores scores, transcript, tips
and AI feedback.

## Data model

`public.profiles` - one row per auth user (unique `username`, `email`).

`public.sessions` - v2 practice history: `id` text PK, `user_id` uuid FK,
`mode`, `title`, `started_at`, `payload` jsonb (the full result object),
timestamps.

`public.works` - legacy prototype saved scripts/schedules (kept for the old pages;
the v2 app does not use it).

`public.ai_usage` - per-user per-day AI counter written by the Edge Function.

All tables have RLS enabled with owner-only policies; the browser only holds the
public anon/publishable key, so RLS is the security boundary.

## Deployment

GitHub Pages publishes the `main` branch (legacy branch source, repo root) on
every push. `.nojekyll` disables Jekyll. No Actions workflow or extra token scope
is needed. Smoke test: `powershell -File scripts/verify_live.ps1`.

## Legacy prototype

`topic.html`, `script.html`, `schedule.html`, `practice.html`, `checkin.html`,
`impromptu.html` and `works.html` are the first web prototype. They still ship
(and their JS modules `store.js` / `works.js` / `planner.js` / `practice.js` /
`impromptu.js` remain) but are not linked from the product. They can be removed
in a later cleanup once nothing references them.

## Known limitations

- Web Speech recognition and speech synthesis depend on the browser; when
  unavailable the app falls back to typing the answer and rule-based tips.
- Included AI depends on the Edge Function being deployed and the user being
  signed in; Preview-mode forks have no AI unless a personal key is configured.
- Free Supabase projects pause after a week of inactivity.