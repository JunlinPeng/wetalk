# Wetalk Web - Architecture

Wetalk is a **static, dependency-light multi-page web app** deployed to GitHub
Pages. There is no build step: plain HTML, CSS and classic-script JavaScript
served straight from the repository root. The optional backend is **Supabase**
(Auth + Postgres + Edge Functions).

With no Supabase configuration the app runs in **Preview mode**: accounts and
works are stored in the browser so the site is always deployable and demoable.

## Runtime configuration

`js/config.js` exposes `window.WETALK_CONFIG`:

```js
{ supabaseUrl, supabaseAnonKey, aiProxyUrl, siteUrl }
```

Only public values belong here. Empty values mean Preview mode. The
`service_role` key and the DeepSeek API key are Supabase secrets and must never
appear in any file served to the browser.

## Shared modules

Loaded in this order where needed: config.js -> vendor/supabase.js -> auth.js ->
store.js / works.js / llm.js -> page script.

| Module | Global | Responsibility |
| --- | --- | --- |
| `js/config.js` | `WETALK_CONFIG` | public runtime config |
| `js/vendor/supabase.js` | `supabase` | pinned supabase-js v2 UMD (2.57.4) |
| `js/auth.js` | `WetalkAuth` | accounts, session cache, OAuth, password reset, Preview fallback |
| `js/store.js` | `WetalkStore` | profile + works sync with Supabase (no-op in Preview mode) |
| `js/works.js` | `WetalkWorks` | synchronous works API used by pages; hooks cloud sync + `wetalk:works` events |
| `js/llm.js` | `WetalkLLM` | AI routing: platform proxy -> personal key -> reject (callers fall back offline) |
| `js/planner.js` | `WetalkPlanner` | schedule + PowerPoint outline generation |
| `js/practice.js` | `WetalkPractice` | rehearsal flow and scoring |
| `js/impromptu.js` | `WetalkImpromptu` | impromptu round, timers, scoring |
| `js/ui.js` | `WetalkUI` | toast, user chip, skeletons, prefetch, page transitions |
| `js/topics.js` | `WETALK_TOPICS` | impromptu topic bank |

## Auth

`js/auth.js` chooses its mode from `js/config.js`:

- **Preview mode** - accounts and sessions in `localStorage`
  (`wetalk.accounts`, `wetalk.session`); a slim `.preview-banner` is injected
  on every page. Password reset and OAuth explain that real accounts need
  Supabase.
- **Supabase mode** - sign-up / sign-in / OAuth / reset go through Supabase
  Auth. A minimal profile is cached in `localStorage[wetalk.session]` so
  `getSession()` and `requireAuth()` stay synchronous; Supabase remains the
  source of truth and is re-checked in the background (`onAuthStateChange`),
  clearing stale cached sessions.

Contract used by pages and other modules:

```
getSession() -> { id, username, email, provider, avatar } | null   // sync cache
requireAuth() -> boolean      // sync; redirects to signin.html?next=<page>
isPreviewMode() -> boolean
createAccount({ email, username, password }) -> Promise<{ ok, error?, needsConfirmation? }>
authenticate(email, password) -> Promise<{ ok, error? }>
signOut() / oauthSignIn(provider) / resetPassword(email) / updatePassword(pw)
getClient() -> SupabaseClient | null
getAccessToken() -> Promise<string | null>
onChange(callback) -> void
```

## Works and cloud sync

`WetalkWorks.getWorks()` always reads the synchronous local cache
(`localStorage[wetalk.works]`), so pages render instantly and work offline.
`archive()` / `remove()` update the cache and fire-and-forget to
`WetalkStore`, which upserts/deletes rows in `public.works` when a real
Supabase session exists. `WetalkWorks.refresh()` pulls remote rows and merges
them by `id` using the newest `updatedAt`; every change dispatches a
`wetalk:works` DOM event so lists re-render.

## AI routing

`WetalkLLM.chat(messages, opts)` tries, in order:

1. **Platform proxy** - when `aiProxyUrl` is configured and the visitor has a
   real Supabase session. The browser sends its access token to the
   `ai-feedback` Edge Function, which verifies the JWT, enforces a per-user
   daily quota in `public.ai_usage`, calls DeepSeek with a server-side secret
   and returns `{ content, remaining, limit }`.
2. **Personal key** - the account's own OpenAI-compatible provider config
   (stored in the browser), unchanged from the prototype.
3. Otherwise the promise rejects and each feature falls back to its offline
   heuristic (for example rule-based practice feedback or a local schedule
   template).

Users can opt out of the included AI with the 'Use my own key' toggle
(`config.useOwnKey` in `wetalk.llm.<username>`).

## Data model

`public.profiles` - one row per auth user (`id` uuid PK, unique `username`,
`email`, timestamps), created by a trigger on `auth.users`.

`public.works` - saved work per user (`id` client-generated text PK,
`user_id` uuid FK, `title`, `mode`, `speech`, `schedule` jsonb,
`created_at`, `updated_at`).

`public.ai_usage` - per-user per-day AI counters (`user_id`, `day`,
`requests`, `tokens`), written by the Edge Function with the service role.

All three tables have RLS enabled with owner-only policies; the browser only
ever holds the public anon key, so RLS is the security boundary. Full SQL and
setup steps live in `supabase/schema.sql` and `docs/SUPABASE_SETUP.md`.

## Deployment

GitHub Pages publishes the `main` branch (legacy branch source, repo root) on
every push. `.nojekyll` disables Jekyll so files are served verbatim. No
Actions workflow or extra token scope is needed.

Live URL: <https://junlinpeng.github.io/wetalk/>
Smoke test: `powershell -File scripts/verify_live.ps1`

## Local development and tests

```bash
python -m http.server 8080        # or powershell -File scripts/serve.ps1
node tests/run-all.js             # optional dev-only unit + e2e suite
```

Tests use the installed Microsoft Edge through `playwright-core` and a small
dependency-free static server. See `docs/TESTING.md`.

## Known limitations

- Preview-mode accounts do not sync across browsers; connect Supabase for real
  accounts.
- The landing page advertises Vericant and TOEFL modes as 'Coming soon'; only
  the topic and impromptu flows are implemented.
- Edge Function quota counting is read-then-compare-and-set: a burst of
  concurrent requests can overshoot the daily limit by the number of in-flight
  calls before subsequent calls are rejected.