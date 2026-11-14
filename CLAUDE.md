# homefinder

Tracks Idealista (Spanish property portal) listings over time: daily scrapes of saved searches,
price history, removals, and a Spanish-language dashboard with Idealista-style filters, listing
detail pages, comparison and personal notes. Personal, light-use tool. Node 24+, Postgres, Express,
Vite + React. It was rewritten from Python in November 2026; nothing Python remains.

## Commands

```sh
docker compose up -d        # local Postgres on :5434 (DATABASE_URL in .env, loaded by the CLI)
npm run dev:api             # API on :3000, restarts on src/ or db/ changes
npm run dev                 # dashboard with hot reload on :5173, proxies /api to :3000
npm run build               # web/ -> dist/, served by `serve`
npm test                    # node:test; Postgres tests need TEST_DATABASE_URL, else skipped

node src/cli.js migrate | scrape [--search N] | recover | reparse | cookie | serve [--port P]
```

For the Postgres tests, use a throwaway container (`test/db.test.js` creates and drops its own schema):

```sh
docker run -d --rm --name homefinder-test-db -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm test
```

## Layout

- `src/cli.js`: entry point. `serve`/`scrape`/`recover`/`reparse`/`cookie` apply pending migrations
  first. `serve` also runs auto-resume 10 s after start and every 5 min.
- `src/server.js`: Express JSON API + `dist/`. `createApp(sql, { config })`; config is re-read per request.
- `src/scraper.js`: scrape runs, scrape lock, auto-resume, listing-page (detail) queue, cookie
  storage/validation.
- `src/http.js`: the HTTP client (node:http/https, Firefox headers in Firefox order, gzip/br/zstd).
- `src/parser.js`: search-result cards. `src/detail.js`: a listing's own page (`/inmueble/<id>/`).
- `src/cookies.js`: cookie jar, Set-Cookie handling, extracting the cookie from a pasted cURL/headers.
- `src/db.js`: connection (dates as `YYYY-MM-DD` strings, numeric/bigint as numbers) and upserts.
- `src/migrate.js` + `db/migrations/NNN_*.sql`: applied in order, advisory-locked, ledger by filename.
- `web/src/`: React dashboard. `App.jsx` routes by hash (`#anuncios`, `#cambios`, `#tendencias`,
  `#comparar`, `#busquedas`, `#ajustes`, `#anuncio/<id>`). `filters.js` is the pure filter logic
  (unit-tested). The UI is Spanish only; so are server messages that reach the UI.
- `test/`: node:test. `fixtures/search_page.html` is from real markup; `fixtures/detail_page.html`
  is hand-written (see below).
- `config.yaml` (git-ignored; `config.example.yaml`): searches and scraper settings.
- `data/raw/2026-10-01/`: 59 real search-result pages from the old version. Handy for parser checks
  (load into a test DB's `raw_pages` and `reparse`); not used by the app.

## How it works

- **Scrape run** (CronJob daily, "Descargar ahora" in Búsquedas, or auto-resume): per search, load
  result pages with a 25–60 s random pause before each request, upsert listings, one `snapshots` row
  per listing per day, gzipped HTML into `raw_pages` (pruned after `raw_html_retention_days`). A
  listing is marked removed only when the run loaded every page (status `complete`).
- **Listing pages**: after the search pages, the run loads `/inmueble/<id>/` for its listings that
  have no `listing_details` row yet, newest first, at most `details_per_run` (default 100), same
  pauses. Logged as a run named `(fichas)`. 404/410/"ya no está publicado" mark the listing gone.
  Failures retry after 12 h, max 3. The detail page can re-fetch one on demand (rate limited 10 s).
- **One scrape at a time** across all processes: Postgres advisory lock `7_244_106` (migrations use
  `7_244_105`). Taking it marks unfinished runs `interrupted`. "Running" in the UI means the lock is
  held, not just an unfinished run row.
- **Auto-resume**: the server resumes today's interrupted searches from the last page reached
  (reloads that page for overlap), max `resume_attempts` in a row, never while the cookie is blocked.
- **Cookie**: stored in the `session` table, pasted in Ajustes (or `cookie` on stdin); refreshed
  Set-Cookies are written back after each run. Every scrape/validation records ok/blocked status;
  the UI shows a banner when it isn't working.

## Things that will bite

- **Never use `fetch` (undici) for Idealista.** It silently rewrites `Sec-Fetch-Mode: navigate` to
  `cors`, which DataDome blocks with a 403 at once. Use `src/http.js`.
- **No getting past bot detection.** On a block/CAPTCHA the run stops and asks for a fresh cookie.
  Don't add retries, faster pauses or evasion. Keep request volume human-like.
- **Never edit an applied migration; add a new numbered one.** The ledger keys on filename, and
  `dev:api` auto-applies migrations on every restart, so even a file applied a minute ago is final
  (an edited `004` once left a local table missing columns).
- **`dev:api` restarts kill any running scrape** (auto-resume picks it up ~10 s later, but each
  restart counts against `resume_attempts`).
- **`src/detail.js` was written without a real detail page** to check against. Fields have fallbacks
  and raw HTML is stored in `listing_details.html_gz`: compare with a real stored page, fix
  selectors, then `reparse` (it rebuilds both search listings and details).
- Pasted cookies copied from dev tools' headers view are often cut off with "…"; `storeCookie`
  rejects any non-ASCII and the UI recommends "Copiar como cURL".
- A cluster egress IP (Hetzner) is likely to be blocked by DataDome more readily than a home IP.

## Deployment

`main` → GitHub Actions (tests against a Postgres service, then an arm64 image
`ghcr.io/borja00/homefinder:sha-<short>`). Manifests live in the infra repo (`../infra`,
`apps/homefinder/`, ArgoCD + Image Updater): a ConfigMap with the searches, the `scrape` CronJob
(07:17 Europe/Madrid, 4 h deadline, no retries), and the `web` Deployment (migrate initContainer,
basic auth via Traefik at homefinder.evdatum.com). Database `homefinder` on the shared Postgres;
Secrets `homefinder-db` and `homefinder-basic-auth` are created out of band (commands in the
manifest headers).
