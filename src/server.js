// JSON API over Postgres plus the built dashboard (web/ → dist/).
// Authentication is left to the ingress (Traefik basic auth in the cluster).

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import * as db from './db.js'
import { loadConfig } from './config.js'
import {
  ScrapeBusyError, cookieStatus, refreshDetail, scrapeAll, scrapeLockHeld, storeCookie, validateCookie,
} from './scraper.js'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const VALIDATE_EVERY_MS = 20_000
const DETAIL_EVERY_MS = 10_000

/**
 * `config` is read on every request, so edits to config.yaml (the ConfigMap in
 * the cluster) show up without a restart.
 */
export function createApp(sql, { config = () => loadConfig() } = {}) {
  let lastValidation = 0
  let lastDetailFetch = 0

  // Validate against page 1 of the first configured search, the page a scrape would load first.
  const validateUrl = () => {
    try {
      return config().searches[0]?.url ?? 'https://www.idealista.com/'
    } catch {
      return 'https://www.idealista.com/'
    }
  }
  const app = express()
  app.use(express.json())

  // Checks the database too: a pod that can't reach it isn't ready.
  app.get('/healthz', async (_req, res) => {
    try {
      await sql`SELECT 1`
      res.send('ok')
    } catch {
      res.status(503).send('database unavailable')
    }
  })

  const listingRows = (id = null) => sql`
    SELECT l.*,
           COALESCE(array_agg(s.search_name ORDER BY s.search_name)
                    FILTER (WHERE s.search_name IS NOT NULL), '{}') AS searches,
           COALESCE(n.starred, false) AS starred, n.rating, n.note,
           (SELECT price FROM snapshots WHERE listing_id = l.id ORDER BY seen_on LIMIT 1) AS first_price,
           (SELECT status FROM listing_details WHERE listing_id = l.id) AS details_status
    FROM listings l
    LEFT JOIN listing_searches s ON s.listing_id = l.id
    LEFT JOIN notes n ON n.listing_id = l.id
    ${id === null ? sql`` : sql`WHERE l.id = ${id}`}
    GROUP BY l.id, n.listing_id
  `

  app.get('/api/listings', async (_req, res) => {
    res.json(await listingRows())
  })

  // One listing for its detail page: the row, its stored Idealista page data, and its price history.
  app.get('/api/listings/:id', async (req, res) => {
    const [listing] = await listingRows(req.params.id)
    if (!listing) return res.status(404).json({ error: 'Anuncio desconocido.' })
    const [detail] = await sql`
      SELECT status, fetched_at, attempted_at, attempts, error, data
      FROM listing_details WHERE listing_id = ${req.params.id}`
    const history = await sql`
      SELECT to_char(seen_on, 'YYYY-MM-DD') AS day, price FROM snapshots
      WHERE listing_id = ${req.params.id} ORDER BY seen_on`
    res.json({ listing, detail: detail ?? null, history })
  })

  // Load the listing's Idealista page again now. One real request, so rate limited.
  app.post('/api/listings/:id/details', async (req, res) => {
    const wait = lastDetailFetch + DETAIL_EVERY_MS - Date.now()
    if (wait > 0) {
      return res.status(429).json({ error: `Espera ${Math.ceil(wait / 1000)} s antes de volver a cargar un anuncio.` })
    }
    lastDetailFetch = Date.now()
    let cfg
    try {
      cfg = config()
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
    try {
      const result = await refreshDetail(sql, cfg, req.params.id)
      res.status(result.error ? 502 : 200).json(result)
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  // Per search and day: median €/m² and number of listings on the market.
  app.get('/api/trends', async (_req, res) => {
    const rows = await sql`
      SELECT to_char(sn.seen_on, 'YYYY-MM-DD') AS day, ls.search_name,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sn.price / l.size_m2)
                   FILTER (WHERE l.size_m2 > 0 AND sn.price IS NOT NULL)::numeric) AS median_eur_m2,
             count(DISTINCT sn.listing_id) AS active
      FROM snapshots sn
      JOIN listings l ON l.id = sn.listing_id
      JOIN listing_searches ls ON ls.listing_id = sn.listing_id
      GROUP BY sn.seen_on, ls.search_name
      ORDER BY sn.seen_on
    `
    res.json(rows)
  })

  app.get('/api/history', async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 10)
    const rows = ids.length
      ? await sql`
          SELECT listing_id, to_char(seen_on, 'YYYY-MM-DD') AS day, price
          FROM snapshots WHERE listing_id = ANY(${ids}::text[]) ORDER BY seen_on`
      : []
    res.json(rows)
  })

  app.get('/api/runs', async (_req, res) => {
    res.json(await sql`SELECT * FROM runs ORDER BY started_at DESC LIMIT 50`)
  })

  app.put('/api/notes/:id', async (req, res) => {
    const { starred, rating, note } = req.body ?? {}
    if (rating != null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: 'La valoración debe ser un número entero del 1 al 5.' })
    }
    const [exists] = await sql`SELECT 1 FROM listings WHERE id = ${req.params.id}`
    if (!exists) return res.status(404).json({ error: 'Anuncio desconocido.' })
    await db.saveNote(sql, req.params.id, { starred, rating, note })
    res.status(204).end()
  })

  // The cookie itself is never sent back, only its status and cookie names.
  app.get('/api/cookie', async (_req, res) => {
    res.json(await cookieStatus(sql))
  })

  app.put('/api/cookie', async (req, res) => {
    const input = req.body?.cookie
    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: 'Pega primero la cabecera Cookie.' })
    }
    try {
      await storeCookie(sql, input)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
    res.json(await cookieStatus(sql))
  })

  // One real request to Idealista, so it's rate limited.
  app.post('/api/cookie/validate', async (_req, res) => {
    const wait = lastValidation + VALIDATE_EVERY_MS - Date.now()
    if (wait > 0) {
      return res.status(429).json({ error: `Espera ${Math.ceil(wait / 1000)} s antes de volver a comprobar.` })
    }
    lastValidation = Date.now()
    res.json(await validateCookie(sql, validateUrl()))
  })

  // The configured searches with their latest run and listing counts.
  app.get('/api/searches', async (_req, res) => {
    let searches
    try {
      searches = config().searches
    } catch (err) {
      return res.json({ searches: [], error: err.message, running: null })
    }
    const lastRuns = await sql`
      SELECT DISTINCT ON (search_name) * FROM runs ORDER BY search_name, started_at DESC`
    const counts = await sql`
      SELECT s.search_name, count(*) FILTER (WHERE l.active) AS active, count(*) AS total
      FROM listing_searches s JOIN listings l ON l.id = s.listing_id GROUP BY s.search_name`
    // An unfinished run is only really running while some process holds the
    // scrape lock. Otherwise its process died (stopped server, killed Job); the
    // next scrape marks it interrupted, and until then it's shown as such.
    const lockHeld = await scrapeLockHeld(sql)
    const [running] = lockHeld
      ? await sql`SELECT * FROM runs WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1`
      : []
    const shown = (run) => (run && !run.finished_at && !lockHeld ? { ...run, status: 'interrupted' } : run)
    res.json({
      searches: searches.map((s) => {
        const c = counts.find((r) => r.search_name === s.name)
        return {
          ...s,
          active: c?.active ?? 0,
          total: c?.total ?? 0,
          last_run: shown(lastRuns.find((r) => r.search_name === s.name)) ?? null,
        }
      }),
      // Lock held but no run row yet (the pause before page 1): still busy.
      running: running ?? (lockHeld ? { search_name: '…', pages: 0, seen: 0, started_at: new Date() } : null),
    })
  })

  // Starts a scrape of one search in the background; it takes minutes because
  // of the pauses between pages. Answers once the scrape lock is held.
  app.post('/api/searches/:name/scrape', async (req, res) => {
    let cfg
    try {
      cfg = config()
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
    const outcome = await new Promise((resolve) => {
      scrapeAll(sql, cfg, req.params.name, { onLocked: () => resolve({ started: true }) })
        .then(() => resolve({ started: true }))
        .catch((err) => {
          if (err instanceof ScrapeBusyError) resolve({ code: 409, error: err.message })
          else resolve({ code: 400, error: err.message }) // ignored if the scrape had already started
          console.error(`Scrape of ${req.params.name}: ${err.message}`)
        })
    })
    if (outcome.error) return res.status(outcome.code).json({ error: outcome.error })
    res.status(202).json(outcome)
  })

  if (existsSync(DIST)) {
    app.use(express.static(DIST))
    app.get('/{*splat}', (_req, res) => res.sendFile(DIST + 'index.html'))
  }

  app.use((err, _req, res, _next) => {
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  })
  return app
}
