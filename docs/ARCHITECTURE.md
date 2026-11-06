# Wetalk Web - Architecture & Team Contract

> This document is the shared contract for the production web app. Read it
> before editing files. The app is a **static, dependency-light multi-page
> site** deployed to GitHub Pages; the backend is **Supabase** (Auth + Postgres
> + Edge Functions). With no Supabase configuration the app runs in
> **Preview mode** (browser storage only) so it is always deployable.

## Runtime configuration

`js/config.js` exposes `window.WETALK_CONFIG`:

```
{ supabaseUrl, supabaseAnonKey, aiProxyUrl, siteUrl }
```

Only public values. Empty values => Preview mode. `js/config.js` is owned by
the Lead: do not put secrets in it.

## Shared JS modules (global objects, classic scripts)

Each page loads `js/config.js` first, then the modules it needs.

| Module | Global | Responsibility |
| --- | --- | --- |
| `js/config.js` | `WETALK_CONFIG` | public config |
| `js/vendor/supabase.js` | `supabase` | pinned supabase-js v2 UMD (2.57.4) |
| `js/auth.js` | `WetalkAuth` | account/session/sign-out/oauth/reset + demo fallback |
| `js/store.js` | `WetalkStore` | cloud profile + works sync (Supabase or local) |
| `js/works.js` | `WetalkWorks` | works list API used by pages (sync, cached) |
| `js/llm.js` | `WetalkLLM` | AI chat: platform proxy, personal key, or failure |
| `js/ui.js` | `WetalkUI` | shared header/user chip, toast, transitions, helpers |

### WetalkAuth contract (keep compatible with existing pages)

```
getSession() -> { id, username, email, provider, avatar } | null   // sync, cached
requireAuth() -> boolean      // sync; redirects to signin.html when signed out
isPreviewMode() -> boolean
createAccount({ email, username, password }) -> Promise<{ok, error?, needsConfirmation?}>
authenticate(email, password) -> Promise<{ok, error?}>
signOut() -> void
oauthSignIn(provider) -> void        // "google" | "github"
resetPassword(email) -> Promise<{ok, error?}>
updatePassword(newPassword) -> Promise<{ok, error?}>
identifyIdentifier(value) -> "email" | "phone" | null   // kept for compatibility
toast(message) -> void
```

Pages call `requireAuth()` synchronously at load. `auth.js` caches a minimal
profile in `localStorage["wetalk.session"]` after sign-in and hydrates/refreshes
it in the background; Supabase remains the source of truth and RLS protects
all data.

### WetalkWorks contract (unchanged for pages)

```
getWorks() -> Work[]                    // sync, cached list
archive() -> Work | null                // snapshot current draft(s), upsert
resume(work) -> void                    // restore into working localStorage keys
remove(id) -> void
```

`Work = { id, title, mode, speech, schedule, updatedAt }`.
When a real session exists, `store.js` pushes/pulls rows in `public.works`
and merges by `updatedAt`; otherwise everything stays local.

### WetalkLLM contract

```
hasConfig() -> boolean                  // true when platform proxy OR personal key
isPlatformMode() -> boolean
chat(messages, {temperature, maxTokens}) -> Promise<string>
getProviders() / findProvider(id) / getConfig() / saveConfig(cfg) / testConnection()
```

Order: platform Edge Function proxy (signed-in, daily quota) -> personal
OpenAI-compatible key -> reject (callers fall back to heuristics).

## Data model (Supabase)

`public.profiles` (id uuid PK -> auth.users, username unique, email, created_at)
`public.works` (id text PK, user_id uuid, title, mode, speech, schedule jsonb, updated_at)
`public.ai_usage` (user_id, day, requests, tokens) - quota accounting.

All tables use RLS owner-only policies. See `supabase/schema.sql`.

## File ownership (avoid parallel-edit collisions)

| Area | Owner | Files |
| --- | --- | --- |
| Config, deploy, integrations | Lead | `js/config.js`, `.github/`, `README.md`, `docs/*.md` |
| Auth & Supabase schema | Auth workstream | `js/auth.js`, `signup.html`, `signin.html`, `reset.html`, `reset-password.html`, `supabase/schema.sql`, `js/vendor/supabase.js` |
| Cloud data + AI | Data workstream | `js/store.js`, `js/works.js`, `js/llm.js`, `supabase/functions/ai-feedback/**`, LLM settings markup inside `script.html`, `schedule.html`, `practice.html` |
| Landing/dashboard/design system | Frontend workstream | `index.html`, `app.html`, `js/ui.js`, `css/styles.css`, `404.html`, `manifest.webmanifest`, `assets/**` |
| Tests & QA | QA workstream | `tests/**`, `package.json`, `docs/TESTING.md` |

Everyone else: do not edit files outside your scope. Need a shared class or a
header change? Message the owner instead of editing their file.

## Deploy

GitHub Pages publishes straight from the `main` branch (legacy branch source,
root folder). Every push to `main` rebuilds the site:
https://junlinpeng.github.io/wetalk/

`.nojekyll` is committed so Pages serves the files verbatim (no Jekyll pass).
An Actions-based deploy can be added later by someone whose GitHub token has
the `workflow` scope.

Local preview: `python -m http.server 8080` from the repo root.