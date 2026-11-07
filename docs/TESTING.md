# Testing & QA - Wetalk

Automated quality gates for the static site in this repository. Two layers:

| Layer | Runner | What it proves |
| --- | --- | --- |
| Unit | Node's built-in test runner (`node --test`) | Pure browser logic: auth validation, Preview-mode accounts/sessions (against a stub config), configured-Supabase degradation, works archive/resume, planner JSON parsing and AI fallbacks, works-store merge, v2 cloud merge/mapping/sync |
| End-to-end | `playwright-core` driving the **installed Microsoft Edge** | Static pages load cleanly and return 200, no JS/console errors, internal links resolve, accessibility smoke checks, redirects and auth journey on the live Supabase project, the **Wetalk v2 app** (sign-in -> sidebar/modes -> impromptu topic -> settings -> AI feedback via a stubbed Edge Function -> cloud history round trip -> sign out), the legacy topic -> manual speech -> offline plan -> check-in -> practice feedback -> works journey (signed in, rows cleaned up), 390x844 mobile layout with no horizontal scroll, screenshots for visual review |

The tests are dev-only. The shipped site stays dependency-free: everything
lives under `tests/` and nothing from `node_modules` is loaded by pages.
`package.json` and the tests are not part of the runtime.

## Prerequisites

- **Node 18+**. On this machine the bundled runtime is preferred:
  `C:\Users\Junlin Peng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` (Node 24).
- **playwright-core** installed in `wetalk/` (`node_modules` is gitignored):
  ```powershell
  $node = "C:\Users\Junlin Peng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  $pnpm = "C:\Users\Junlin Peng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
  & $node $pnpm add -D playwright-core@^1.64.1 --lockfile=false
  ```
  No browsers are downloaded. The installed Edge is used:
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
  (override with `$env:WETALK_EDGE_PATH = "path\to\msedge.exe"`).
- **Live QA account (only for signed-in browser checks).** The production site
  is connected to the real Supabase project, so signed-in specs sign in through
  the real UI. The account is **never hardcoded** (this is a public repo):
  provide a disposable Supabase test account through the environment:
  `$env:WETALK_TEST_EMAIL` and `$env:WETALK_TEST_PASSWORD`. When either is
  missing, every signed-in check is reported as `SKIP` with
  "set WETALK_TEST_EMAIL / WETALK_TEST_PASSWORD to run signed-in browser tests"
  and the signed-out checks (HTTP, signup validation, redirects, stubbed signup,
  etc.) still run. Treat the account as throwaway data: the specs delete the
  rows they create.
- **Network access.** The unit and unsigned checks need no network: the harness
  starts its own static server. The signed-in e2e checks talk to the live
  Supabase project (auth + `public.sessions` / `public.works` cleanup), so they
  need internet; the AI Edge Function is always intercepted with `page.route`
  and never called for real (zero AI quota is spent).

## Commands

Run everything from the repository root (`wetalk/`):

```powershell
$node = "C:\Users\Junlin Peng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

# Disposable QA account for the signed-in checks (omit to SKIP them)
$env:WETALK_TEST_EMAIL = "qa-account@example.com"
$env:WETALK_TEST_PASSWORD = "your-disposable-test-password"

# Full suite (unit + e2e) - the command the Lead should run before deploy
& $node tests/run-all.js

# Fast logic-only pass (about 2s; no network, no browser)
& $node tests/run-all.js --unit-only

# Browser suite only
& $node tests/run-all.js --e2e-only

# One e2e spec: http | v2 | pages | links | a11y | auth | flow | responsive | screenshots
& $node tests/e2e/run.js --only v2

# Refresh the screenshots for visual review
& $node tests/run-all.js --screenshots-only

# Manual preview server (same server the e2e harness uses)
& $node tests/helpers/static-server.js --port 8104 --root .
# -> http://127.0.0.1:8104/
```

Convenience aliases when Node is on `PATH`: `npm test`, `npm run test:unit`,
`npm run test:e2e`, `npm run screenshots`, `npm run serve`.

The e2e harness refuses to fight over port 8104: if the port is busy it falls
back to a free port automatically.

## Statuses

The e2e report labels every check:

| Status | Meaning | Fails the suite? |
| --- | --- | --- |
| `PASS` | Check passed | No |
| `FAIL` | Real regression - fix before deploy | **Yes** |
| `WARN` | Quality concern worth fixing, not release-blocking (e.g. two `<h1>`s, placeholder-only labels, desktop overflow) | No |
| `PENDING` | References a file/request another workstream is still landing; listed in `tests/e2e/lib/harness.js` (`PENDING_FILES`, `PENDING_REQUESTS`). Remove the entry once the work lands. | No |
| `SKIP` | Environment cannot run the check (e.g. Edge or playwright-core missing) - reported, never silent | No |

Exit code is `0` when there are no `FAIL`s and `1` otherwise.

## Coverage

### Unit (`tests/unit/`)

- `auth.test.js` - `identifyIdentifier` (email/phone/rejections), preview-mode
  `createAccount`/`authenticate`/`signOut`, duplicate email rejection, wrong
  password, session persistence across a simulated reload, `requireAuth`
  redirect, documented session shape `{ id, username, email, provider, avatar }`,
  `isPreviewMode()`, preview banner injection.
- `works.test.js` - `getWorks` defaults + corrupt storage, `archive` snapshot and
  upsert-by-title, recency ordering, `remove`, `resume` restoring/clearing drafts.
- `planner.test.js` - `extractJSON` (plain, fenced, fenced without language tag,
  embedded in prose, nested, truncated/garbage -> `null`), offline schedule/PPT
  fallbacks, AI paths against a mocked `WetalkLLM` (parse, pad short plans,
  fall back on bad replies/failures, day-count clamp).
- `store.test.js` - `mergeWorks` (local-only, remote-only, local-newer,
  remote-newer, documented remote tie-break, ordering, invalid/duplicate rows),
  Preview-mode no-ops, `pullWorks`/`pushWork`/`deleteWork` against stub Supabase
  clients, and "never rejects" behaviour on network failure.

Tests load the real classic scripts into a fake `window` (in-memory
`localStorage`, minimal DOM) via `tests/helpers/mock-browser.js`, so they
exercise the files that ship - no copies.

### End-to-end (`tests/e2e/specs/`)

- `http.spec.js` - every `.html` returns 200, every local `href`/`src` referenced
  by a page resolves, document shell checks (doctype/charset/lang/title/viewport),
  `.nojekyll` present, heuristic secret scan of shipped `js/`. Runs without a
  browser, so it still works when Edge is unavailable.
- `pages.spec.js` - loads every page in Edge (protected pages with the real
  signed-in storage state) and fails on HTTP != 200, uncaught page errors,
  `console.error` output, failed subresources, or a protected page bouncing to
  `signin.html` although the context is signed in.
- `links.spec.js` - crawls internal links from every page and verifies targets
  answer 200 (external links are counted, not fetched).
- `a11y.spec.js` - per page: `lang`, title, viewport, heading structure, image
  `alt`, accessible names for form controls/buttons/links, duplicate ids; plus
  the Preview-mode banner contract on `signin.html` (absent with the live
  Supabase config, shown only for a Preview-mode build).
- `v2.spec.js` - the migrated **Wetalk v2 app** (`app.html`) against the live
  project: signed-out redirect to `signin.html?next=app.html`; real UI sign-in;
  sidebar brand / Previous Work / three mode cards / `#v2Username` / Sign out;
  Impromptu Generate Topic + Begin Practice; Settings AI status;
  `WetalkV2AI.requestFeedback` through `v2-ai.js` -> `llm.js` with the
  `ai-feedback` Edge Function **stubbed** (zero real AI quota); cloud history
  round trip (save -> `public.sessions` row -> localStorage wipe -> reload ->
  sidebar restored) with the test row deleted again; sign out -> `index.html`.
  The captured signed-in storage state is shared with the other specs.
- `auth.spec.js` - signed-out visitor is redirected from `app.html` to
  `signin.html?next=app.html`; signup form validation (local); a stubbed
  `/auth/v1/signup` success redirects to `app.html` (no real account created);
  real sign-in lands on `app.html`; already-signed-in visitors are forwarded
  from `signin.html`/`signup.html` to `app.html`; sign-out clears the session
  and returns to `index.html`.
- `flow.spec.js` - the legacy (unlinked but still deployed) topic -> manual
  speech -> offline schedule plan -> check-in -> practice feedback -> works
  journey, signed in for real; the `ai-feedback` Edge Function is stubbed and
  the `public.works` rows it creates are deleted afterwards.
- `responsive.spec.js` - mobile 390x844 must not scroll horizontally (fails with
  the widest offending elements listed); desktop 1440x900 overflow warns.
- `screenshots.spec.js` - captures every page at 1440x900 and 390x844.

All signed-in specs reuse ONE real UI sign-in per run through Playwright's
`storageState`; when the QA account env vars are missing they SKIP with the
reason from `AUTH_SKIP_REASON` instead of silently loading the sign-in page.

## Artifacts

All gitignored (`test-results/`, `node_modules/`):

- `test-results/e2e-report.json` - machine-readable report: every check, status,
  message, browser info, per-spec timings, screenshot directory.
- `test-results/screenshots/` - `<page>-<signedin|signedout>-<desktop|mobile>.png`
  plus `auth-01-signup.png` ... `auth-05-after-signin.png` from the auth journey.
  Use these for visual review of the current tree.

## Known gaps / notes

- **The e2e suite runs against the live Supabase project.** `js/config.js`
  points at production, so real auth + cloud sync are exercised end to end. The
  disposable QA account comes from `WETALK_TEST_EMAIL` / `WETALK_TEST_PASSWORD`
  (see Prerequisites); without them the signed-in checks SKIP. Specs delete the
  `public.sessions` / `public.works` rows they create, and the AI Edge Function
  is always stubbed so no real AI quota is spent.
- **Browser noise.** Headless Edge can emit
  `Transition was aborted because of invalid state. ViewTransition opt-in disabled`
  on cross-document navigation because of the `@view-transition` CSS in
  `css/styles.css`. This is browser-generated, ignored by the harness
  (`BROWSER_NOISE`) and surfaced as a warning, not a failure.
- **Static site API probe.** `script.html`/`practice.html` call
  `WetalkLLM.importLegacyConfig()`, which would fetch `/api/config` (a legacy
  desktop endpoint). `llm.js` now guards it with `isDesktopMode()` so the static
  site does not probe it; the harness keeps the pending entry as a safety net
  for old builds.
- **Phone validation** uses the compatibility regex from the original auth
  module: a leading "(" (`(555) 123-4567`) is not classified. The UI examples
  use "+1 555 123 4567" forms, which pass.
- **Accessibility is a smoke test, not a WCAG audit.** No contrast/axe engine;
  obvious structural issues fail, softer ones (heading counts, placeholder-only
  labels) warn.
- **Mock DOM limits.** Unit tests run scripts against a minimal fake DOM; if a
  module starts depending on real layout APIs, extend
  `tests/helpers/mock-browser.js` rather than adding jsdom (keeps tests
  dependency-free).
- **No visual diffing.** Screenshots are for human review; nothing compares them
  to a baseline yet.
- The harness only drives the installed Edge. On machines without Edge the
  browser specs SKIP and the suite still validates HTTP, unit logic and reports
  the skip explicitly.

## Adding tests

- **Unit:** add `tests/unit/<area>.test.js`; load shipped files with
  `loadScripts(win, ["js/x.js"])` from `helpers/mock-browser`. Do **not** load
  the real `js/config.js` - it points at the live Supabase project. Stub the
  runtime config with `loadSource(win, PREVIEW_CONFIG_SOURCE)` (empty values =
  Preview mode) or `CONFIGURED_CONFIG_SOURCE` (configured Supabase mode); see
  `tests/unit/auth.test.js`. Do not copy source into fixtures.
- **E2E:** add `tests/e2e/specs/<name>.spec.js` exporting
  `{ name, requiresBrowser, run(ctx) }` and register it in `tests/e2e/run.js`.
  Use `ctx.pass/fail/warn/pending/skip(name, message)`, `ctx.pages` (all root
  `.html` files), `ctx.http(path)` and the helpers in `tests/e2e/lib/harness.js`.
- If a new file is expected from another workstream, add it to
  `PENDING_FILES` with its owner so the suite stays runnable - and remove the
  entry when the file lands.
