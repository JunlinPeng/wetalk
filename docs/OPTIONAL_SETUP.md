# Optional production extras

Everything here is optional. The site is already live with real accounts
(email + password) and cloud-saved works.

---

## 1. Included AI for every signed-in user

> **Status on the live project: deployed 2026-11-07.** The function is live with
> `DAILY_AI_LIMIT=20` and `GLOBAL_DAILY_LIMIT=500`. The steps below are kept for
> forks / re-deployments.

The \`ai-feedback\` Edge Function keeps your AI provider key server-side and gives
each signed-in user a small daily allowance, so visitors do not need their own
API key.

### Automated (recommended)

Create a Supabase personal access token:
**Dashboard -> Account -> Access Tokens -> Generate new token** (starts with \`sbp_\`).

Then, from the repository root:

\`\`\`powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_your_token"
powershell -File scripts/deploy_ai_proxy.ps1 -Push
\`\`\`

The script reads the DeepSeek API key from the Wetalk desktop app settings
(\`%APPDATA%\TalkReady\settings.json\`), or pass \`-DeepseekKey sk-...\`. It sets the
secrets, deploys the function, writes \`aiProxyUrl\` into \`js/config.js\` and pushes.

Cost controls (change any time with \`supabase secrets set\`):

| Secret | Default | Meaning |
| --- | --- | --- |
| \`DAILY_AI_LIMIT\` | 20 | requests per user per UTC day |
| \`GLOBAL_DAILY_LIMIT\` | 500 | requests across ALL users per UTC day |

When a cap is reached the UI falls back to the built-in offline scoring, so the
site never breaks and the AI bill is bounded.

### Manual (no token sharing)

1. Supabase Dashboard -> **Edge Functions** -> **Deploy a new function** (via editor).
2. Paste the contents of \`supabase/functions/ai-feedback/index.ts\` as \`ai-feedback\`, deploy.
3. **Edge Functions -> ai-feedback -> Secrets**: add \`DEEPSEEK_API_KEY\` (and optionally the two limits).
4. Set \`aiProxyUrl\` in \`js/config.js\` to
   \`https://<project-ref>.supabase.co/functions/v1/ai-feedback\`, commit and push.

Verify: sign in on the live site -> speech page should say
"AI included with your account - N of 20 requests left today".

---

## 2. GitHub sign-in

1. Open <https://github.com/settings/developers> -> **OAuth Apps** -> **New OAuth App**.
2. Fill in:
   - **Application name:** \`Wetalk\`
   - **Homepage URL:** \`https://junlinpeng.github.io/wetalk/\`
   - **Authorization callback URL:** \`https://efhprhfonzgmpwzkzjup.supabase.co/auth/v1/callback\`
3. Register, copy the **Client ID**, then **Generate a new client secret**.
4. Configure Supabase either:

   - **Automated** (from the repo root):

     \`\`\`powershell
     $env:SUPABASE_ACCESS_TOKEN = "sbp_your_token"
     powershell -File scripts/configure_auth.ps1 -GithubClientId "Iv1.xxxx" -GithubClientSecret "xxxx"
     \`\`\`

   - **Dashboard:** Authentication -> Providers -> GitHub -> enable, paste the
     Client ID and Client Secret, save.

No site change is needed: the "Continue with GitHub" buttons already call
\`supabase.auth.signInWithOAuth({ provider: "github" })\`.

### Google (same pattern)

1. <https://console.cloud.google.com> -> create/select a project.
2. APIs & Services -> OAuth consent screen (External, app name Wetalk).
3. Credentials -> Create credentials -> OAuth client ID -> Web application.
   - Authorised JavaScript origin: \`https://junlinpeng.github.io\`
   - Authorised redirect URI: \`https://efhprhfonzgmpwzkzjup.supabase.co/auth/v1/callback\`
4. Copy Client ID + secret, then either run \`scripts/configure_auth.ps1\` with
   \`-GoogleClientId/-GoogleClientSecret\`, or paste them in
   Supabase -> Authentication -> Providers -> Google.

---

## 3. Custom email (password reset / confirmations)

Supabase's built-in mailer is rate-limited and meant for testing. Options:

- **Resend** (recommended): create a free account at <https://resend.com>,
  verify a sending domain (DNS records; a custom domain is required for sending
  to arbitrary users), then copy the SMTP credentials:
  - Host: \`smtp.resend.com\`, Port: \`465\`, User: \`resend\`, Password: your Resend API key
  - From address: e.g. \`noreply@your-domain\`
  Paste them in **Supabase -> Authentication -> SMTP Settings** (or the
  Management API), set the sender email/name, and save.
- **Brevo / other SMTP**: same fields from your provider.
- Until then, password-reset emails still work within Supabase's free limits
  (fine for low traffic).

---

## 4. Free custom domain (is-a.dev)

The plan is \`wetalk.is-a.dev\` via <https://is-a.dev> (free subdomain, GitHub PR).
Status: \`wetalk\` is still unregistered.

Steps once the domain is approved:

1. Add \`CNAME\` -> \`junlinpeng.github.io\` DNS record through the is-a.dev PR.
2. In the \`wetalk\` repo: Settings -> Pages -> Custom domain -> \`wetalk.is-a.dev\`,
   then enable **Enforce HTTPS**.
3. Update Supabase Auth URLs (Site URL + redirect list) with
   \`scripts/configure_auth.ps1 -SiteUrl https://wetalk.is-a.dev/\`.

Status: the is-a.dev application (PR #60271) was **denied** because the site is
not considered software-development-related. Alternatives:

1. **GitHub Student Developer Pack** - if you have a verified student account,
   claim the free Namecheap `.me` domain (or a `.tech` domain) and point it at
   GitHub Pages. Recommended if eligible.
2. **Buy a domain** (about USD 10-15/year) - best long-term, and it also makes
   custom email (Resend) possible.
3. **Cloudflare Pages / Netlify / Vercel free subdomain** (`wetalk.pages.dev`
   etc.) - requires an account and deploying the static site there.
4. Stay on `junlinpeng.github.io/wetalk/`.