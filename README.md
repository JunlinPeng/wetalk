# Wetalk

Wetalk is an AI speech coach for students: write a speech, get a personalised
practice schedule, rehearse with timers, and receive AI feedback on delivery,
organisation, analysis and creativity. It also includes an Impromptu mode with
NSDA-style prompts, Vericant-style interview practice and TOEFL speaking sets.

**Live site:** https://junlinpeng.github.io/wetalk/

## Develop locally

```bash
python -m http.server 8080
# open http://localhost:8080/
```

No build step: the site is plain HTML/CSS/JS and is deployed straight to
GitHub Pages by `.github/workflows/deploy.yml`.

## Accounts & data

Wetalk ships in **Preview mode** until a Supabase project is connected: accounts
and saved works live in the visitor's browser. To enable real sign-up, cloud
sync and the AI feedback proxy, follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)
and fill in `js/config.js`.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy

Push to `main`; GitHub Actions publishes the site to GitHub Pages.
