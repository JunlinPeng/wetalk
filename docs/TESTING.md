# Testing & QA - Wetalk

Automated quality gates for the static site in this repository. Two layers:

| Layer | Runner | What it proves |
| --- | --- | --- |
| Unit | Node's built-in test runner (`node --test`) | Pure browser logic: auth validation, preview-mode accounts/sessions, works archive/resume, planner JSON parsing and AI fallbacks, cloud/local works merge |
| End-to-end | `playwright-core` driving the **installed Microsoft Edge** | Static pages load cleanly and return 200, no JS/console errors, internal links resolve, accessibility smoke checks, signup/sign-out/sign-in journey, 390x844 mobile layout with no horizontal scroll, screenshots for visual review |

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
- **No network access is required.** The harness starts its own static server.

## Commands

Run everything from the repository root (`wetalk/`):

```powershell
$node = "C:\Users\Junlin Peng\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

# Full suite (unit + e2e) - the command the Lead should run before deploy
& $node tests/run-all.js

# Fast logic-only pass (about 0.2s)
& $node tests/run-all.js --unit-only

# Browser suite only
& $node tests/run-all.js --e2e-only

# One e2e spec: http | pages | links | a11y | auth | responsive | screenshots
& $node tests/e2e/run.js --only auth

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
- `pages.spec.js` - loads every page in Edge (protected pages with a seeded
  preview session) and fails on HTTP != 200, uncaught page errors, `console.error`
  output or failed subresources.
- `links.spec.js` - crawls internal links from every page and verifies targets
  answer 200 (external links are counted, not fetched).
- `a11y.spec.js` - per page: `lang`, title, viewport, heading structure, image
  `alt`, accessible names for form controls/buttons/links, duplicate ids; plus
  the Preview-mode banner on `signin.html`.
- `auth.spec.js` - signed-out visitor is redirected from `app.html` to
  `signin.html`; preview signup -> `works.html` with a cached session; sign-out
  clears the session; sign-in restores it. Selectors are adaptive (label, name,
  placeholder, type, autocomplete) so they survive markup redesigns.
- `responsive.spec.js` - mobile 390x844 must not scroll horizontally (fails with
  the widest offending elements listed); desktop 1440x900 overflow warns.
- `screenshots.spec.js` - captures every page at 1440x900 and 390x844.

## Artifacts

All gitignored (`test-results/`, `node_modules/`):

- `test-results/e2e-report.json` - machine-readable report: every check, status,
  message, browser info, per-spec timings, screenshot directory.
- `test-results/screenshots/` - `<page>-<signedin|signedout>-<desktop|mobile>.png`
  plus `auth-01-signup.png` ... `auth-05-after-signin.png` from the auth journey.
  Use these for visual review of the current tree.

## Known gaps / notes

- **Preview mode only in e2e.** The suite runs with empty `js/config.js`, so the
  Supabase cloud path is covered by unit tests with stub clients, not by a live
  project. Add a dedicated staging project if real auth/sync coverage is needed.
- **Browser noise.** Headless Edge can emit
  `Transition was aborted because of invalid state. ViewTransition opt-in disabled`
  on cross-document navigation because of the `@view-transition` CSS in
  `css/styles.css`. This is browser-generated, ignored by the harness
  (`BROWSER_NOISE`) and surfaced as a warning, not a failure.
- **Static site API probe.** `script.html`/`practice.html` call
  `WetalkLLM.importLegacyConfig()`, which fetches `/api/config` (a legacy desktop
  endpoint). On the static site that is a 404 in the browser console; tracked as
  `PENDING_REQUESTS["api/config"]` until the data workstream guards it.
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
  `loadScripts(win, ["js/config.js", "js/x.js"])` from `helpers/mock-browser`.
  Do not copy source into fixtures.
- **E2E:** add `tests/e2e/specs/<name>.spec.js` exporting
  `{ name, requiresBrowser, run(ctx) }` and register it in `tests/e2e/run.js`.
  Use `ctx.pass/fail/warn/pending/skip(name, message)`, `ctx.pages` (all root
  `.html` files), `ctx.http(path)` and the helpers in `tests/e2e/lib/harness.js`.
- If a new file is expected from another workstream, add it to
  `PENDING_FILES` with its owner so the suite stays runnable - and remove the
  entry when the file lands.
