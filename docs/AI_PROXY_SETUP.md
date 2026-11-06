# AI feedback proxy - setup guide

This guide deploys the **ai-feedback** Supabase Edge Function and turns on the
"AI included with your account" mode in Wetalk. Until it is deployed (and
`js/config.js` has `aiProxyUrl` set) the site keeps working in Preview mode:
users can bring their own OpenAI-compatible API key and every AI feature has
an offline fallback.

Files involved:

| File | Purpose |
| --- | --- |
| `supabase/functions/ai-feedback/index.ts` | Deno Edge Function: JWT check, daily quota, DeepSeek call |
| `supabase/schema.sql` | `public.ai_usage` quota table (+ profiles/works) |
| `js/config.js` | public config; `aiProxyUrl` turns platform mode on |
| `js/llm.js` | browser client: platform mode first, personal key second |
| `js/store.js` / `js/works.js` | cloud works sync (uses the same Supabase project) |

## 1. Prerequisites

- A Supabase project (free tier is fine) with Auth enabled.
- The schema from `supabase/schema.sql` applied once (Dashboard -> SQL Editor ->
  New query -> paste -> Run). This creates `public.ai_usage(user_id, day,
  requests, tokens)`; the function refuses to run without it.
- A DeepSeek API key (<https://platform.deepseek.com>). **This key stays on the
  server as a Supabase secret - never put it in `js/config.js`.**
- The Supabase CLI installed and logged in:

  ```powershell
  supabase login
  supabase link --project-ref <your-project-ref>
  ```

## 2. Set the server secrets

```powershell
# Required: the AI provider key (server side only)
supabase secrets set DEEPSEEK_API_KEY=sk-your-deepseek-key

# Optional: daily requests per user, default 20
supabase secrets set DAILY_AI_LIMIT=20
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to Edge Functions automatically - do not set them yourself.

## 3. Deploy the function

```powershell
supabase functions deploy ai-feedback
```

Keep the default JWT verification enabled: the platform requires a signed-in
user, and the function also verifies the token itself. Deploying with
`--no-verify-jwt` is *not* supported by this client.

The function URL is:

```
https://<your-project-ref>.supabase.co/functions/v1/ai-feedback
```

## 4. Point the web app at the function

Edit `js/config.js` (safe to commit - public values only):

```js
window.WETALK_CONFIG = {
  supabaseUrl: "https://<your-project-ref>.supabase.co",
  supabaseAnonKey: "<the public anon key>",
  aiProxyUrl: "https://<your-project-ref>.supabase.co/functions/v1/ai-feedback",
  siteUrl: ""
};
```

Commit + push to `main` (GitHub Pages) or, in the desktop app, reboot the
local server. As soon as `aiProxyUrl`, `supabaseUrl` and `supabaseAnonKey` are
set and a user is signed in, `WetalkLLM.isPlatformMode()` returns true:

- `script.html` shows **"AI included with your account - N of 20 requests left
  today"** and hides the personal-key panel behind a secondary **"Use my own
  key"** toggle.
- Speech generation, schedule generation, the PPT outline and practice
  feedback all call the Edge Function. No browser-held AI key is needed.
- The personal key stays available as an opt-out (for example when the daily
  quota is exhausted).

## 5. How the daily quota works

- Unit: one **successful AI answer** = one request. Validation failures
  (400/413), quota rejections (429) and provider failures (502) do not consume
  quota.
- Counter table: `public.ai_usage(user_id, day, requests, tokens)`, keyed by the
  **UTC date** (`day`), so the quota resets at 00:00 UTC.
- Limit: `DAILY_AI_LIMIT`, default `20`, read at call time (change the secret and
  redeploy / restart the function to take effect).
- Concurrency: the counter is updated with a compare-and-set update
  (`WHERE requests = <value read>`) with up to 3 retries, so two simultaneous
  answers cannot both count the same row. The pre-call check is a read, so in a
  burst a user can overshoot the limit by at most the number of concurrent
  requests; the next call is rejected.
- Response (success): `{ "content": "...", "remaining": 19, "limit": 20 }`.
- Response (limit reached), HTTP 429:
  `{ "error": "quota_exceeded", "message": "Daily AI limit reached - using offline scoring.", "limit": 20, "remaining": 0 }`.
- The browser caches `remaining` in `localStorage["wetalk.aiQuota"]` (keyed by
  UTC day) and shows it in the script/schedule/practice pages.

Other error JSON (all CORS-enabled):

| HTTP | `error` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | body is not JSON or messages are malformed |
| 401 | `unauthorized` | missing/expired session token |
| 413 | `bad_request` | more than 12000 input characters |
| 429 | `quota_exceeded` | daily limit reached |
| 500 | `upstream` | server config or `ai_usage` table unavailable |
| 502 | `upstream` | DeepSeek unreachable / provider error |
| 503 | `no_key` | `DEEPSEEK_API_KEY` secret is missing |

Request limits enforced by the function: `temperature` clamped to 0..0.7,
`max_tokens` clamped to 1..1200, model fixed to `deepseek-chat`,
45 s DeepSeek request timeout.

## 6. Test with curl

Get a user access token (use a real account in your project):

```bash
SUPABASE_URL="https://<your-project-ref>.supabase.co"
ANON_KEY="<public anon key>"

ACCESS_TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"test-password"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

Call the function:

```bash
curl -i -X POST "$SUPABASE_URL/functions/v1/ai-feedback" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Reply with the single word: ok"}],"temperature":0.3,"max_tokens":20}'
```

Expected: `HTTP/1.1 200` and
`{"content":"ok","remaining":19,"limit":20}` (the exact content depends on the
model). Call it `DAILY_AI_LIMIT` more times to see the 429 quota response.

Negative checks:

```bash
# 401 - no token
curl -i -X POST "$SUPABASE_URL/functions/v1/ai-feedback" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# 204 CORS preflight
curl -i -X OPTIONS "$SUPABASE_URL/functions/v1/ai-feedback" \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, apikey, content-type"

# 413 - oversized input (> 12000 characters)
curl -i -X POST "$SUPABASE_URL/functions/v1/ai-feedback" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$(python -c 'print(\"a\"*13000)')\"}]}"
```

Watch the logs while testing:

```powershell
supabase functions logs ai-feedback
```

## 7. Rollback

1. Delete `aiProxyUrl` (and optionally the Supabase values) from `js/config.js`,
   commit and push. The site instantly returns to Preview mode with personal
   keys and offline fallbacks.
2. Optional: `supabase functions delete ai-feedback`.
3. Optional: `supabase secrets unset DEEPSEEK_API_KEY` to revoke the key from
   the server. Rotate the DeepSeek key in the provider dashboard as well.

No user data is lost: works are cached in `localStorage["wetalk.works"]` and
remain in `public.works` for signed-in users.

## 8. Troubleshooting

- **Always 401**: the user is not signed in, or the request lacks
  `Authorization: Bearer <access token>`. Sign in again - tokens expire after
  about an hour.
- **`no_key` (503)**: run `supabase secrets set DEEPSEEK_API_KEY=...` and
  redeploy. Secrets are injected per deployment.
- **`upstream` (500)**: the `ai_usage` table is missing - run
  `supabase/schema.sql` in the SQL editor.
- **CORS error in the browser**: redeploy the function; the preflight response
  must allow the `authorization, apikey, content-type` headers.
- **Quota does not reset**: rows are keyed by UTC date. Check the `day` column
  and the browser's `wetalk.aiQuota` cache (it is ignored after the UTC day
  changes).
- **Need to reset one user's quota today**: delete their row for today in
  `public.ai_usage` from the SQL editor.
