# homefinder

Track Idealista listings over time: price history, new/removed listings, €/m² trends,
and side-by-side comparison with your own notes.

It fetches your Idealista searches over HTTP with the cookie from your own browser session,
pausing 25–60 s before every request. It does **not** try to get past bot detection: if Idealista
answers with a block/CAPTCHA the run stops. Scraping is against Idealista's terms; keep it to
light personal use.

Node 24+, Postgres, and a Vite + React dashboard.

## Setup

```sh
npm install
docker compose up -d                   # local Postgres on :5434 (DATABASE_URL is in .env)
cp config.example.yaml config.yaml     # then paste your search URLs
node src/cli.js migrate
```

The CLI reads `DATABASE_URL` from `.env` (git-ignored) unless it's already set in the environment.

Then open idealista.com in your browser, open dev tools → Network, click any idealista.com
request, copy its `Cookie` request header and paste it in the dashboard's **Settings** tab, which
saves it and validates it by loading page 1 of your first search. Or from the CLI:

```sh
node src/cli.js cookie < cookie.txt    # or run it and paste, then Ctrl-D
```

The cookie lives in the database (`session` table); the scraper saves the refreshed cookies back
after each run and records whether it was blocked. When it stops working, every dashboard tab
shows a banner pointing to Settings.

## Use

```sh
node src/cli.js scrape                 # all searches (or --search NAME)
npm run build && node src/cli.js serve # dashboard + API on http://localhost:3000
npm run dev:api                        # API on :3000, restarts when src/ or db/ change
npm run dev                            # dashboard with hot reload on :5173 (proxies /api to :3000)
node src/cli.js reparse                # rebuild listings from stored HTML after fixing selectors
npm test                               # set TEST_DATABASE_URL to also run the Postgres tests
```

Run `scrape` once a day. A full run of 4 districts × up to 20 pages takes about an hour because
of the pauses. Price history builds up from daily snapshots.

## How it works

- `src/parser.js` – turns search-result pages into listings. Idealista's markup changes;
  when it does, fix the selectors here and run `reparse` (raw HTML is kept gzipped in
  `raw_pages` for `raw_html_retention_days`).
- `db/migrations/` – the schema, applied in order by `migrate` (also run on every pod start).
  `listings` (latest state), `snapshots` (price per listing per day), `runs`, `notes`
  (your stars/ratings/notes), `raw_pages`, `session` (the Idealista cookie).
- `src/server.js` – JSON API and the built dashboard (`web/` → `dist/`). No authentication of
  its own: in the cluster it sits behind Traefik basic auth.
- A listing missing from a search is marked removed only when the run loaded *every*
  result page. Keep searches narrow enough to fit in `max_pages_per_search`.

## Deployment

`main` builds `ghcr.io/borja00/homefinder:sha-<short>` (linux/arm64). The cluster manifests
are in the infra repo under `apps/homefinder`: a daily scrape CronJob and the dashboard
Deployment, both using the shared Postgres's `homefinder` database.
