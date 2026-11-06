# Supabase Setup

Wetalk runs with **no backend** by default: until a Supabase project is
connected, the site runs in **Preview mode** and accounts are stored in the
visitor's browser (localStorage). The live site at
<https://junlinpeng.github.io/wetalk/> ships in Preview mode and keeps working
exactly as it does today.

Connecting Supabase upgrades the app to **real accounts**:

- email + password sign-up and sign-in (Google / GitHub OAuth optional)
- password reset by email
- cloud-saved works and the AI feedback proxy (used by other modules)

You only need the **free** Supabase tier. The browser talks to Supabase with
the public **anon** key; Row Level Security (RLS) protects every row.

---

## 0. Preview mode (nothing configured)

`js/config.js` starts out with empty values:

    window.WETALK_CONFIG = {
      supabaseUrl: "",
      supabaseAnonKey: "",
      aiProxyUrl: "",
      siteUrl: ""
    };

While both `supabaseUrl` and `supabaseAnonKey` are empty:

- `WetalkAuth.isPreviewMode()` returns `true`
- every page shows a slim banner: "Preview mode - accounts are stored in this
  browser"
- sign-up / sign-in read and write `localStorage["wetalk.accounts"]`, session
  in `localStorage["wetalk.session"]`
- password reset and OAuth show a friendly "not available in Preview mode"
  message instead of pretending

No configuration is required to deploy or demo the site.

---

## 1. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> (free account).
2. Click **New project**.
3. Pick an organisation, name the project (for example `wetalk`), choose a
   strong **database password** (save it somewhere safe - you will not need it
   in the browser), and a region close to your users.
4. Click **Create new project** and wait until the dashboard is ready.

---

## 2. Run the database schema

1. In the project dashboard open **SQL Editor** (left sidebar) -> **New query**.
2. Open `supabase/schema.sql` from this repository, copy the whole file and
   paste it into the editor.
3. Click **Run** (or press Ctrl+Enter). It should finish with "Success. No rows
   returned".

The script creates:

| Table | What it stores |
| --- | --- |
| `public.profiles` | one row per account: `username` (unique), `email`, timestamps |
| `public.works` | saved speeches / schedules: `id`, `user_id`, `title`, `mode`, `speech`, `schedule` (jsonb), `updated_at` |
| `public.ai_usage` | per-user, per-day AI quota counters (`requests`, `tokens`) |

It also installs:

- RLS policies that restrict every table to its **owner only**
- `updated_at` triggers
- `handle_new_user()`: a trigger on `auth.users` that creates the matching
  `profiles` row (username comes from the sign-up form, or is derived from
  the email for OAuth users)
- `username_available(text)` RPC used by the sign-up form to warn about taken
  usernames before submitting

The script is **safe to re-run**: it uses `if not exists` /
`create or replace` and drops each trigger and policy before recreating it.
Re-run it after pulling a newer version of `schema.sql`.

---

## 3. Authentication settings

Open **Authentication** -> **Providers** in the dashboard.

### Email provider (required)

- **Enable Email provider**: on.
- **Confirm email**: your choice.
  - **ON** (recommended for production): after sign-up the visitor sees
    "Check your inbox" and must click the confirmation link before signing in.
    The app handles the confirmation event and redirects into the app.
  - **OFF**: sign-up signs the visitor in immediately.
- **Minimum password length**: `8` (the app validates 8+ characters too).

### Site URL and redirect URLs (required)

Open **Authentication** -> **URL Configuration**.

- **Site URL**: `https://junlinpeng.github.io/wetalk/`
  (or your own domain once you have one; can be changed later).
- **Redirect URLs** - add each one you use:

      https://junlinpeng.github.io/wetalk/**
      http://localhost:8080/**
      http://127.0.0.1:8080/**

  Add any other local port you use for development (for example `:8101` if
  you test on that port). The wildcard `**` at the end is required so the app
  can redirect to `signin.html` and `reset-password.html` after OAuth /
  confirmation / recovery links.

The app passes `redirectTo` values based on the current page origin, so
localhost development and the deployed site both work without code changes.

---

## 4. Paste the public keys into js/config.js

1. Open **Project Settings** -> **API** (or **Data API** / **API Keys**
   depending on dashboard version).
2. Copy:
   - **Project URL** (looks like `https://abcdefghijklmnop.supabase.co`)
   - **anon** / **public** API key (the short public key, sometimes labelled
     `anon public`)
3. Edit `js/config.js`:

       window.WETALK_CONFIG = {
         supabaseUrl: "https://abcdefghijklmnop.supabase.co",
         supabaseAnonKey: "eyJhbGciOi...your-anon-public-key...",
         aiProxyUrl: "",
         siteUrl: ""
       };

4. Commit and deploy (or just reload locally). You can also use the helper:

       powershell -File scripts/configure_supabase.ps1 -SupabaseUrl https://<ref>.supabase.co -AnonKey <anon-key> -Push


`supabaseUrl` + `supabaseAnonKey` being non-empty switches every page from
Preview mode to real Supabase Auth. `siteUrl` is optional: it overrides the
origin used for auth redirect links (only needed if emails must always return
to one canonical domain). `aiProxyUrl` is filled in when the AI feedback
proxy is deployed - see `docs/AI_PROXY_SETUP.md`.

**Never** put the `service_role` / secret key in `js/config.js` or any
file served to the browser. The anon key is public by design and safe to
commit; RLS enforces what each user can read and write.

---

## 5. Optional: Google and GitHub sign-in

These steps are only needed for the "Continue with Google / GitHub" buttons.
Email sign-up works without them.

### Google

1. In <https://console.cloud.google.com> create (or select) a project.
2. **APIs & Services** -> **OAuth consent screen**: configure an External app
   (app name "Wetalk", support email, developer email) and add your own Google
   account as a test user.
3. **APIs & Services** -> **Credentials** -> **Create credentials** ->
   **OAuth client ID** -> **Web application**.
   - Authorised JavaScript origin: `https://junlinpeng.github.io`
   - Authorised redirect URI:
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (replace `<project-ref>` with your Supabase project ref)
4. Copy the **Client ID** and **Client secret**.
5. In Supabase: **Authentication** -> **Providers** -> **Google** -> enable,
   paste the Client ID and Client secret, save.

### GitHub

1. In <https://github.com/settings/developers> -> **OAuth Apps** ->
   **New OAuth App**.
   - Application name: `Wetalk`
   - Homepage URL: `https://junlinpeng.github.io/wetalk/`
   - Authorization callback URL:
     `https://<project-ref>.supabase.co/auth/v1/callback`
2. Register the app, generate a **Client secret**.
3. In Supabase: **Authentication** -> **Providers** -> **GitHub** -> enable,
   paste the Client ID and Client secret, save.

Both providers redirect back through Supabase to `signin.html`, and the app
then sends the visitor to the page they came from (or `works.html`).

---

## 6. Verify the setup

Run the site locally (`python -m http.server 8080` in the `wetalk` folder or
`powershell -File scripts/serve.ps1`) and check:

1. The "Preview mode" banner is **gone**.
2. Sign up with a fresh email + username + password.
   - Email confirmation ON -> "Check your inbox"; click the link; you land back
     on the site signed in.
   - Email confirmation OFF -> you go straight to your works.
3. Sign out (button in the app header) and sign in again.
4. "Forgot password?" -> `reset.html` -> enter the email -> open the link ->
   `reset-password.html` -> set a new password -> sign in with it.
5. Optional OAuth: click Google / GitHub on `signin.html`, approve, and
   confirm you come back signed in.

If something fails, open the browser developer console (F12) - auth errors are
surfaced there by supabase-js and mapped to friendly messages in the UI.

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Banner still says "Preview mode" | `js/config.js` was not deployed or one of the two values is still empty. |
| "Invalid login credentials" | Wrong password, or the email is not confirmed yet (check the confirmation setting). |
| "Please confirm your email first" | Confirmation email not clicked. Resend from the Supabase dashboard or the sign-in page. |
| Confirmation / reset link goes to the wrong place | Add the origin to **Authentication -> URL Configuration -> Redirect URLs** (`http://localhost:8080/**`, `https://junlinpeng.github.io/wetalk/**`). |
| "That username is already taken" | Choose another username. The sign-up form checks with `username_available()`; the database also enforces a unique lowercase handle. |
| OAuth button shows "Unsupported provider" / redirect error | Provider not enabled in Supabase, or the callback URL is missing in the Google/GitHub console. |
| Reset link says "invalid or has expired" | Links are single-use and expire (default 24h). Request a new one. |
| Table does not exist / permission denied | `supabase/schema.sql` was not run, or was run in the wrong project. Re-run it. |
| Signed in but works do not sync | The cloud sync module requires a session; check the console for RLS errors and make sure the schema was applied. |

---

## 8. Security notes

- The **anon key is public**: it only has the privileges that RLS grants, which
  is "own rows only" for every table.
- The **service_role key must stay server-side** (Edge Functions / SQL editor).
- All user data is scoped by `auth.uid()` in the RLS policies; there is no API
  path that returns another user's rows.
- Passwords are hashed by Supabase Auth; the app never stores them.
- Preview mode is a browser-local convenience store, not a security boundary.