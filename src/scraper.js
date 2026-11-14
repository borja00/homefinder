// Fetch Idealista search pages over HTTP using the cookie from your own browser.
//
// Requests are spaced out with long random pauses. Nothing tries to get past
// bot detection: if Idealista answers with a block/CAPTCHA, the run stops at
// once and you paste a fresh cookie with `homefinder cookie`.

import { gunzipSync, gzipSync } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'
import * as db from './db.js'
import { applySetCookies, extractCookieHeader, parseCookieHeader, toCookieHeader } from './cookies.js'
import { BlockedError, hasNextPage, isBlocked, pageUrl, parseSearchPage } from './parser.js'
import { get } from './http.js'
import { parseDetailPage } from './detail.js'

const COOKIE_KEY = 'idealista_cookie'
const STATUS_KEY = 'idealista_cookie_status'
const COOKIE_HELP =
  'En las herramientas de desarrollo del navegador, copia la cabecera Cookie de cualquier petición a ' +
  'idealista.com y pégala en Ajustes, o pásala por la entrada estándar a `homefinder cookie`.'

/**
 * Whether the stored cookie last worked: ok | blocked | error | unvalidated.
 * Set by validation from the dashboard and by every scrape, so a cookie that
 * stops working overnight shows up in the dashboard.
 */
export async function setCookieStatus(sql, status, message) {
  const value = { status, message, checked_at: new Date().toISOString() }
  await db.setSession(sql, STATUS_KEY, JSON.stringify(value))
  return value
}

export async function cookieStatus(sql) {
  const rows = await sql`SELECT key, value, updated_at FROM session WHERE key IN (${COOKIE_KEY}, ${STATUS_KEY})`
  const cookie = rows.find((r) => r.key === COOKIE_KEY)
  const check = rows.find((r) => r.key === STATUS_KEY)
  if (!cookie) {
    return { stored: false, status: 'missing', message: 'Todavía no hay ninguna cookie de Idealista guardada.', names: [] }
  }
  return {
    stored: true,
    saved_at: cookie.updated_at,
    names: [...parseCookieHeader(cookie.value).keys()],
    ...(check ? JSON.parse(check.value) : { status: 'unvalidated', message: 'Todavía no se ha comprobado.' }),
  }
}

/** Write the refreshed jar back, unless someone stored a new cookie meanwhile. */
async function saveJar(sql, jar, original) {
  if ((await db.getSession(sql, COOKIE_KEY)) === original) {
    await db.setSession(sql, COOKIE_KEY, toCookieHeader(jar))
  }
}

function pause(cfg) {
  const [lo, hi] = cfg.delaySeconds
  return sleep((lo + Math.random() * (hi - lo)) * 1000)
}

/** A non-2xx answer that isn't a block, e.g. 404/410 for a listing that was taken down. */
export class HttpError extends Error {
  name = 'HttpError'
  constructor(status, url) {
    super(`HTTP ${status} en ${url}`)
    this.status = status
  }
}

/** GET with redirects followed by hand, so every Set-Cookie on the way lands in the jar. */
export async function fetchPage(jar, url, referer) {
  return (await fetchPageFinal(jar, url, referer)).html
}

/** Like fetchPage, also returning the URL it ended at after redirects. */
export async function fetchPageFinal(jar, url, referer) {
  for (let hop = 0; hop < 5; hop++) {
    const resp = await get(url, { referer, cookie: toCookieHeader(jar) })
    applySetCookies(jar, resp.setCookies)
    if (resp.status >= 300 && resp.status < 400 && resp.headers.location) {
      referer = url
      url = new URL(resp.headers.location, url).href
      continue
    }
    if (resp.status === 403 || resp.status === 429 || isBlocked(resp.body)) {
      throw new BlockedError(`HTTP ${resp.status} en ${url}`)
    }
    if (resp.status < 200 || resp.status >= 300) throw new HttpError(resp.status, url)
    return { html: resp.body, url }
  }
  throw new Error(`Demasiadas redirecciones en ${url}`)
}

/**
 * `resume` ({ fromPage, seen }) continues an interrupted run: start at that
 * page, and count the listings already seen today towards removal detection.
 */
async function scrapeSearch(sql, jar, cfg, search, today, resume = null) {
  const firstPage = resume?.fromPage ?? 1
  const runId = await db.startRun(sql, search.name, firstPage)
  const seen = new Set(resume?.seen ?? [])
  let pages = 0
  let status = 'truncated'
  let referer = firstPage > 1 ? pageUrl(search.url, firstPage - 1) : search.url.split('?')[0]
  try {
    for (let pageNo = firstPage; pageNo <= cfg.maxPagesPerSearch; pageNo++) {
      await pause(cfg)
      const url = pageUrl(search.url, pageNo)
      const html = await fetchPage(jar, url, referer)
      referer = url
      pages++
      if (cfg.saveRawHtml) {
        await sql`
          INSERT INTO raw_pages (fetched_on, search_name, page, html_gz)
          VALUES (${today}, ${search.name}, ${pageNo}, ${gzipSync(html)})
          ON CONFLICT (fetched_on, search_name, page) DO UPDATE SET html_gz = EXCLUDED.html_gz
        `
      }
      const listings = parseSearchPage(html)
      await sql.begin(async (tx) => {
        for (const l of listings) await db.upsertListing(tx, l, search.name, today)
      })
      for (const l of listings) seen.add(l.id)
      await sql`UPDATE runs SET pages = ${pages}, seen = ${seen.size} WHERE id = ${runId}`
      console.log(`  [${search.name}] page ${pageNo}: ${listings.length} listings`)
      if (!listings.length || !hasNextPage(html)) {
        status = 'complete'
        break
      }
    }
    if (status === 'complete') {
      const removed = await db.markRemoved(sql, search.name, seen, today)
      if (removed) console.log(`  [${search.name}] ${removed} listings no longer published`)
    }
  } catch (err) {
    status = err instanceof BlockedError ? 'blocked' : 'error'
    throw err
  } finally {
    await db.finishRun(sql, runId, pages, seen.size, status)
  }
  return status
}

/** Another scrape (the daily CronJob, or one started from the dashboard) holds the lock. */
export class ScrapeBusyError extends Error {
  name = 'ScrapeBusyError'
}

const SCRAPE_LOCK = 7_244_106 // arbitrary; migrations use 7_244_105

/** Whether any process (this one, another pod, the CronJob) is scraping right now. */
export async function scrapeLockHeld(sql) {
  // A bigint advisory key shows up in pg_locks split as classid (high 32 bits) / objid (low).
  const [{ held }] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND classid = 0 AND objid = ${SCRAPE_LOCK} AND objsubid = 1 AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    ) AS held`
  return held
}

/**
 * Returns false when Idealista blocked the run. Only one scrape runs at a time
 * across every process (a Postgres advisory lock), so a scrape started from the
 * dashboard and the daily CronJob never hit Idealista together. `onLocked` is
 * called once the lock is held and the scrape is really starting.
 */
export async function scrapeAll(sql, cfg, only, { onLocked } = {}) {
  const searches = cfg.searches.filter((s) => !only || s.name === only)
  if (!searches.length) throw new Error(only ? `No hay ninguna búsqueda llamada «${only}»` : 'No hay búsquedas configuradas')
  const header = await db.getSession(sql, COOKIE_KEY)
  if (!header) throw new Error(`No hay ninguna cookie de Idealista guardada. ${COOKIE_HELP}`)
  return withScrapeLock(sql, onLocked, () =>
    scrapeLocked(sql, cfg, searches.map((search) => ({ search })), header))
}

async function withScrapeLock(sql, onLocked, fn) {
  const lock = await sql.reserve()
  try {
    const [{ locked }] = await lock`SELECT pg_try_advisory_lock(${SCRAPE_LOCK}) AS locked`
    if (!locked) throw new ScrapeBusyError('Ya hay otra descarga en marcha.')
    try {
      // Holding the lock means nothing else is scraping: unfinished runs died
      // with their process (a stopped server, a restarted pod, a killed Job).
      await sql`UPDATE runs SET finished_at = now(), status = 'interrupted' WHERE finished_at IS NULL`
      onLocked?.()
      return await fn()
    } finally {
      await lock`SELECT pg_advisory_unlock(${SCRAPE_LOCK})`
    }
  } finally {
    lock.release()
  }
}

/**
 * Resume today's scrapes that died part-way (server stopped, pod restarted,
 * Job killed), each from the page it had reached. The server calls this on
 * start and every few minutes. Gives up on a search after
 * `resumeAttempts` interruptions in a row, and does nothing while the cookie
 * is known to be blocked (resuming would only be blocked again).
 * Returns the names of the searches it resumed.
 */
export async function recoverInterrupted(sql, cfg) {
  if (!cfg.autoResume) return []
  const header = await db.getSession(sql, COOKIE_KEY)
  if (!header) return []
  const check = await db.getSession(sql, STATUS_KEY)
  if (check && JSON.parse(check).status === 'blocked') return []

  return withScrapeLock(sql, null, async () => {
    const today = db.isoDay()
    const jobs = []
    for (const search of cfg.searches) {
      const recent = await sql`
        SELECT status, first_page, pages, started_at FROM runs
        WHERE search_name = ${search.name} ORDER BY started_at DESC LIMIT ${cfg.resumeAttempts + 1}`
      const todays = recent.filter((r) => db.isoDay(r.started_at) === today)
      const streak = todays.findIndex((r) => r.status !== 'interrupted')
      const interrupted = streak === -1 ? todays.length : streak
      if (!interrupted) continue
      if (interrupted > cfg.resumeAttempts) {
        console.log(`  [${search.name}] interrupted ${interrupted} times today; not resuming again`)
        continue
      }
      const last = todays[0]
      // Load the last page it reached again: listings shift between pages
      // as others are removed, and the overlap keeps any from being skipped.
      const fromPage = last.pages ? last.first_page + last.pages - 1 : last.first_page
      const seen = await sql`
        SELECT DISTINCT sn.listing_id FROM snapshots sn
        JOIN listing_searches ls ON ls.listing_id = sn.listing_id
        WHERE ls.search_name = ${search.name} AND sn.seen_on = ${today}`
      jobs.push({ search, resume: { fromPage, seen: seen.map((r) => r.listing_id) } })
    }
    if (jobs.length) await scrapeLocked(sql, cfg, jobs, header)
    return jobs.map((j) => j.search.name)
  })
}

async function scrapeLocked(sql, cfg, jobs, header) {
  const today = db.isoDay()
  const jar = parseCookieHeader(header)
  try {
    for (const { search, resume } of jobs) {
      console.log(resume ? `Resuming ${search.name} from page ${resume.fromPage}` : `Scraping ${search.name}`)
      let status
      try {
        status = await scrapeSearch(sql, jar, cfg, search, today, resume)
      } catch (err) {
        if (!(err instanceof BlockedError)) throw err
        await setCookieStatus(sql, 'blocked',
          `La descarga se bloqueó en «${search.name}» (${err.message}).`)
        console.log(`Blocked by Idealista (${err.message}). Stopping. Open idealista.com in your ` +
          `browser, pass any check, and store a fresh cookie. ${COOKIE_HELP}`)
        return false
      }
      if (status === 'truncated') {
        console.log(`  [${search.name}] hit max_pages_per_search; removals not detected. ` +
          'Narrow the search or raise the limit.')
      }
    }
    try {
      await fetchDetails(sql, jar, cfg, jobs.map((j) => j.search.name))
    } catch (err) {
      if (!(err instanceof BlockedError)) throw err
      await setCookieStatus(sql, 'blocked', `La descarga se bloqueó al cargar fichas de anuncios (${err.message}).`)
      console.log(`Blocked by Idealista while loading listing pages (${err.message}). Stopping.`)
      return false
    }
    await setCookieStatus(sql, 'ok', `La descarga de ${jobs.length} búsqueda(s) funcionó.`)
  } finally {
    await saveJar(sql, jar, header)
    if (cfg.saveRawHtml) {
      const pruned = await sql`
        DELETE FROM raw_pages WHERE fetched_on < CURRENT_DATE - ${cfg.rawHtmlRetentionDays}::int
      `
      if (pruned.count) console.log(`Pruned ${pruned.count} raw pages older than ${cfg.rawHtmlRetentionDays} days`)
    }
  }
  return true
}

// ---- Listing pages (/inmueble/<id>/) -------------------------------------

/** Run name the details phase is logged under in `runs`. */
export const DETAILS_RUN = '(fichas)'

/** The listing's page on the host the searches use (tests point that at a fake server). */
function detailUrl(cfg, listingUrl) {
  return new URL(new URL(listingUrl).pathname, cfg.baseUrl).href
}

/**
 * Load and store the page of one listing. Throws BlockedError; any other
 * failure is recorded on the row (status 'error' only if it never loaded) and
 * returned as { error }.
 */
async function loadDetail(sql, jar, cfg, { id, url }, referer) {
  try {
    const { html, url: final } = await fetchPageFinal(jar, detailUrl(cfg, url), referer)
    const data = parseDetailPage(html)
    // Taken-down ads say so on the page, or redirect away from /inmueble/.
    const gone = data.gone || !/\/inmueble\/\d+/.test(new URL(final).pathname)
    await sql`
      INSERT INTO listing_details (listing_id, status, fetched_at, attempted_at, attempts, error, html_gz, data)
      VALUES (${id}, ${gone ? 'gone' : 'ok'}, now(), now(), 0, NULL, ${gzipSync(html)}, ${sql.json(data)})
      ON CONFLICT (listing_id) DO UPDATE SET
        status = EXCLUDED.status, fetched_at = now(), attempted_at = now(), attempts = 0, error = NULL,
        -- a taken-down page has nothing useful: keep what was loaded before
        html_gz = CASE WHEN EXCLUDED.status = 'gone' AND listing_details.data IS NOT NULL
                       THEN listing_details.html_gz ELSE EXCLUDED.html_gz END,
        data = CASE WHEN EXCLUDED.status = 'gone' AND listing_details.data IS NOT NULL
                    THEN listing_details.data ELSE EXCLUDED.data END`
    if (gone) await markGone(sql, id)
    return { status: gone ? 'gone' : 'ok' }
  } catch (err) {
    if (err instanceof BlockedError) throw err
    if (err instanceof HttpError && (err.status === 404 || err.status === 410)) {
      await sql`
        INSERT INTO listing_details (listing_id, status, fetched_at, attempted_at)
        VALUES (${id}, 'gone', now(), now())
        ON CONFLICT (listing_id) DO UPDATE SET status = 'gone', fetched_at = now(), attempted_at = now(),
          attempts = 0, error = NULL`
      await markGone(sql, id)
      return { status: 'gone' }
    }
    await sql`
      INSERT INTO listing_details (listing_id, status, attempted_at, attempts, error)
      VALUES (${id}, 'error', now(), 1, ${err.message})
      ON CONFLICT (listing_id) DO UPDATE SET
        attempted_at = now(), attempts = listing_details.attempts + 1, error = EXCLUDED.error,
        status = CASE WHEN listing_details.status IN ('ok', 'gone') THEN listing_details.status ELSE 'error' END`
    return { error: err.message }
  }
}

async function markGone(sql, id) {
  await sql`UPDATE listings SET active = false, removed_on = COALESCE(removed_on, ${db.isoDay()}) WHERE id = ${id} AND active`
}

/** Where a browser would be coming from: the search that found the listing. */
async function refererFor(sql, cfg, id) {
  const names = (await sql`SELECT search_name FROM listing_searches WHERE listing_id = ${id}`).map((r) => r.search_name)
  return cfg.searches.find((s) => names.includes(s.name))?.url ?? `${cfg.baseUrl}/`
}

/**
 * After a run's search pages: load the pages of its listings that don't have
 * one yet, newest first, at most `detailsPerRun`, with the usual pause before
 * each. The rest wait for the next run. Failed ones are retried after 12 h, 3
 * times at most.
 */
async function fetchDetails(sql, jar, cfg, searchNames) {
  if (!cfg.fetchDetails || cfg.detailsPerRun <= 0) return
  const pending = (limit) => sql`
    SELECT l.id, l.url FROM listings l
    LEFT JOIN listing_details d ON d.listing_id = l.id
    WHERE l.active
      AND EXISTS (SELECT 1 FROM listing_searches s WHERE s.listing_id = l.id AND s.search_name = ANY(${searchNames}))
      AND (d.listing_id IS NULL
           OR (d.status = 'error' AND d.attempts < 3 AND d.attempted_at < now() - interval '12 hours'))
    ORDER BY l.first_seen DESC, l.id
    LIMIT ${limit}`
  const queue = await pending(cfg.detailsPerRun + 1)
  if (!queue.length) return
  const todo = queue.slice(0, cfg.detailsPerRun)
  console.log(`Loading ${todo.length} listing pages${queue.length > todo.length ? ' (more wait for the next run)' : ''}`)

  const runId = await db.startRun(sql, DETAILS_RUN)
  let done = 0
  let status = queue.length > todo.length ? 'truncated' : 'complete'
  try {
    for (const item of todo) {
      await pause(cfg)
      const result = await loadDetail(sql, jar, cfg, item, await refererFor(sql, cfg, item.id))
      done++
      await sql`UPDATE runs SET pages = ${done}, seen = ${done} WHERE id = ${runId}`
      console.log(`  [${DETAILS_RUN}] ${item.id}: ${result.error ?? result.status}`)
    }
  } catch (err) {
    status = err instanceof BlockedError ? 'blocked' : 'error'
    throw err
  } finally {
    await db.finishRun(sql, runId, done, done, status)
  }
}

/** Load one listing's page now (the detail page's "Actualizar" button). */
export async function refreshDetail(sql, cfg, id) {
  const header = await db.getSession(sql, COOKIE_KEY)
  if (!header) throw new Error(`No hay ninguna cookie de Idealista guardada. ${COOKIE_HELP}`)
  const [listing] = await sql`SELECT id, url FROM listings WHERE id = ${id}`
  if (!listing) throw new Error('Anuncio desconocido.')
  const jar = parseCookieHeader(header)
  try {
    return await loadDetail(sql, jar, cfg, listing, await refererFor(sql, cfg, id))
  } catch (err) {
    if (!(err instanceof BlockedError)) throw err
    await setCookieStatus(sql, 'blocked', `Idealista bloqueó la carga de un anuncio (${err.message}).`)
    return { error: `Idealista bloqueó la petición (${err.message}). Guarda una cookie nueva en Ajustes.` }
  } finally {
    await saveJar(sql, jar, header)
  }
}

export async function storeCookie(sql, input) {
  const header = extractCookieHeader(input)
  // Cookie headers are printable ASCII. Anything else is almost always the "…"
  // dev tools put in place of the rest of a long value it didn't copy.
  const bad = header.search(/[^\x20-\x7e]/)
  if (bad !== -1) {
    const ch = header[bad]
    throw new Error(ch === '…'
      ? `La cookie está cortada: tiene «…» en el carácter ${bad + 1}, donde las herramientas de desarrollo ` +
        'la acortaron. Cópiala entera: clic derecho en la petición → Copiar → Copiar como cURL, o activa ' +
        '«Sin procesar»/«Raw» en las cabeceras antes de copiar.'
      : `La cookie tiene un carácter que una cabecera Cookie no puede llevar («${ch}», en el carácter ${bad + 1}). ` +
        'Cópiala de nuevo, mejor con clic derecho en la petición → Copiar → Copiar como cURL.')
  }
  const jar = parseCookieHeader(header)
  if (!jar.size) throw new Error('No se ha encontrado ninguna cookie en lo pegado.')
  await db.setSession(sql, COOKIE_KEY, toCookieHeader(jar))
  await setCookieStatus(sql, 'unvalidated', 'Guardada, todavía sin comprobar.')
  return jar.size
}

/** Load one page (a configured search, ideally) with the stored cookie and record the outcome. */
export async function validateCookie(sql, url) {
  const header = await db.getSession(sql, COOKIE_KEY)
  if (!header) return cookieStatus(sql)
  const jar = parseCookieHeader(header)
  try {
    const html = await fetchPage(jar, url, 'https://www.idealista.com/')
    const n = parseSearchPage(html).length
    await saveJar(sql, jar, header)
    await setCookieStatus(sql, 'ok', `Se cargó ${url}: ${n} anuncios en la página.`)
  } catch (err) {
    if (err instanceof BlockedError) {
      await setCookieStatus(sql, 'blocked', `Idealista bloqueó la petición (${err.message}).`)
    } else {
      await setCookieStatus(sql, 'error', `No se pudo comprobar la cookie: ${err.message}`)
    }
  }
  return cookieStatus(sql)
}

/** Rebuild listings/snapshots from stored raw HTML (e.g. after fixing selectors). */
export async function reparse(sql) {
  let pages = 0
  const cursor = sql`
    SELECT to_char(fetched_on, 'YYYY-MM-DD') AS day, search_name, page, html_gz
    FROM raw_pages ORDER BY fetched_on, search_name, page
  `.cursor(10)
  for await (const rows of cursor) {
    for (const row of rows) {
      let listings
      try {
        listings = parseSearchPage(gunzipSync(row.html_gz).toString('utf8'))
      } catch (err) {
        if (err instanceof BlockedError) continue
        throw err
      }
      await sql.begin(async (tx) => {
        for (const l of listings) await db.upsertListing(tx, l, row.search_name, row.day)
      })
      pages++
    }
  }
  console.log(`Re-parsed ${pages} pages`)

  let details = 0
  for await (const rows of sql`SELECT listing_id, html_gz FROM listing_details WHERE html_gz IS NOT NULL`.cursor(20)) {
    for (const row of rows) {
      let data
      try {
        data = parseDetailPage(gunzipSync(row.html_gz).toString('utf8'))
      } catch (err) {
        if (err instanceof BlockedError) continue
        throw err
      }
      await sql`UPDATE listing_details SET data = ${sql.json(data)} WHERE listing_id = ${row.listing_id}`
      details++
    }
  }
  console.log(`Re-parsed ${details} listing pages`)
}
