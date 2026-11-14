// Needs a throwaway Postgres: TEST_DATABASE_URL=postgres://... npm test
// Every test runs in its own schema, dropped afterwards.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect, markRemoved, saveNote, upsertListing } from '../src/db.js'
import { migrate } from '../src/migrate.js'
import { createApp } from '../src/server.js'
import { recoverInterrupted, scrapeAll, setCookieStatus, storeCookie } from '../src/scraper.js'

const URL_ = process.env.TEST_DATABASE_URL
const skip = URL_ ? false : 'TEST_DATABASE_URL not set'
const schema = `test_${process.pid}`
let sql

before(async () => {
  if (skip) return
  const admin = connect(URL_, { max: 1 })
  await admin.unsafe(`CREATE SCHEMA ${schema}`)
  await admin.end()
  sql = connect(URL_, { connection: { search_path: schema } })
  await migrate(sql, () => {})
})

after(async () => {
  if (skip) return
  await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`)
  await sql.end()
})

const listing = (price, id = '1') => ({
  id, url: `https://x/${id}`, title: 'Piso', price, size_m2: 80, rooms: null, floor: null,
  has_lift: null, has_parking: false, agency: null, thumbnail: null, description: null,
})

test('price history and removal', { skip }, async () => {
  await sql`TRUNCATE listings CASCADE`
  await upsertListing(sql, listing(300000), 's', '2026-09-01')
  await upsertListing(sql, listing(250000, '2'), 's', '2026-09-01')
  await upsertListing(sql, listing(290000), 's', '2026-09-02')
  assert.equal(await markRemoved(sql, 's', new Set(['1']), '2026-09-02'), 1)

  const [one] = await sql`SELECT price, first_seen, last_seen, active FROM listings WHERE id = '1'`
  assert.deepEqual({ ...one }, { price: 290000, first_seen: '2026-09-01', last_seen: '2026-09-02', active: true })
  const prices = await sql`SELECT price FROM snapshots WHERE listing_id = '1' ORDER BY seen_on`
  assert.deepEqual(prices.map((r) => r.price), [300000, 290000])
  const [two] = await sql`SELECT active, removed_on FROM listings WHERE id = '2'`
  assert.deepEqual({ ...two }, { active: false, removed_on: '2026-09-02' })
})

test('reparsing an old page keeps the newer state', { skip }, async () => {
  await sql`TRUNCATE listings CASCADE`
  await upsertListing(sql, listing(290000), 's', '2026-09-02')
  await upsertListing(sql, listing(300000), 's', '2026-09-01')
  const [one] = await sql`SELECT price, first_seen, last_seen FROM listings`
  assert.deepEqual({ ...one }, { price: 290000, first_seen: '2026-09-01', last_seen: '2026-09-02' })
})

test('migrations are idempotent', { skip }, async () => {
  const logs = []
  await migrate(sql, (m) => logs.push(m))
  assert.deepEqual(logs, ['no pending migrations'])
})

const fakeConfig = (url) => ({
  searches: [{ name: 'local', url }],
  maxPagesPerSearch: 1, delaySeconds: [0, 0], saveRawHtml: true, rawHtmlRetentionDays: 30,
})

/** A stand-in for Idealista that serves the fixture page. */
function fakeIdealista() {
  const page = readFileSync(new URL('./fixtures/search_page.html', import.meta.url), 'utf8')
  return createServer((_req, res) => res.end(page)).listen(0)
}

test('API: cookie settings and validation', { skip }, async () => {
  // A stand-in for Idealista: serves the fixture, or a DataDome page once told to block.
  const page = readFileSync(new URL('./fixtures/search_page.html', import.meta.url), 'utf8')
  let block = false
  let seenCookie
  const idealista = createServer((req, res) => {
    seenCookie = req.headers.cookie
    res.setHeader('set-cookie', 'datadome=refreshed; Path=/')
    if (block) res.writeHead(403).end('<script src="https://ct.captcha-delivery.com/c.js"></script>')
    else res.end(page)
  }).listen(0)
  const server = createApp(sql, { config: () => fakeConfig(`http://localhost:${idealista.address().port}/search/`) }).listen(0)
  const base = `http://localhost:${server.address().port}`
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    return [r.status, await r.json()]
  }
  try {
    await sql`DELETE FROM session`
    let [code, s] = await call('GET', '/api/cookie')
    assert.equal(s.status, 'missing')

    ;[code] = await call('PUT', '/api/cookie', { cookie: '   ' })
    assert.equal(code, 400)

    // Truncated by dev tools: refused with an explanation, nothing stored.
    let err
    ;[code, err] = await call('PUT', '/api/cookie', { cookie: 'Cookie: datadome=abc; userUUID=12…' })
    assert.equal(code, 400)
    assert.match(err.error, /cortada.*carácter 34.*Copiar como cURL/s)
    ;[, s] = await call('GET', '/api/cookie')
    assert.equal(s.status, 'missing')

    ;[code, s] = await call('PUT', '/api/cookie', { cookie: "curl 'x' -H 'Cookie: datadome=old; lang=es'" })
    assert.equal(code, 200)
    assert.deepEqual([s.status, s.names], ['unvalidated', ['datadome', 'lang']])
    assert.equal(s.value, undefined) // the cookie itself never leaves the server

    ;[code, s] = await call('POST', '/api/cookie/validate')
    assert.equal(s.status, 'ok')
    assert.match(s.message, /2 anuncios/)
    assert.equal(seenCookie, 'datadome=old; lang=es')

    ;[code] = await call('POST', '/api/cookie/validate')
    assert.equal(code, 429)

    // A fresh app (no rate-limit history) sees the refreshed cookie, then a block.
    block = true
    server.close()
    const again = createApp(sql, { config: () => fakeConfig(`http://localhost:${idealista.address().port}/`) }).listen(0)
    const r = await fetch(`http://localhost:${again.address().port}/api/cookie/validate`, { method: 'POST' })
    s = await r.json()
    again.close()
    assert.equal(seenCookie, 'datadome=refreshed; lang=es')
    assert.equal(s.status, 'blocked')
  } finally {
    server.close()
    idealista.close()
  }
})

test('API: searches and scrape now', { skip }, async () => {
  await sql`TRUNCATE listings, runs CASCADE`
  await sql`DELETE FROM session`
  const idealista = fakeIdealista()
  const cfg = fakeConfig(`http://localhost:${idealista.address().port}/search/`)
  const server = createApp(sql, { config: () => cfg }).listen(0)
  const base = `http://localhost:${server.address().port}`
  const get = async () => (await fetch(`${base}/api/searches`)).json()
  const post = (name) => fetch(`${base}/api/searches/${name}/scrape`, { method: 'POST' })
  try {
    let s = await get()
    assert.deepEqual(s.searches.map((x) => [x.name, x.active, x.last_run]), [['local', 0, null]])

    let r = await post('local')
    assert.equal(r.status, 400) // no cookie yet
    assert.match((await r.json()).error, /No hay ninguna cookie de Idealista/)
    await fetch(`${base}/api/cookie`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"cookie":"a=1"}' })
    assert.equal((await post('nope')).status, 400)

    // While another process holds the scrape lock (e.g. the CronJob), it's refused.
    const other = await sql.reserve()
    await other`SELECT pg_advisory_lock(7244106)`
    r = await post('local')
    assert.equal(r.status, 409)
    assert.notEqual((await get()).running, null) // someone else is scraping: busy
    await other`SELECT pg_advisory_unlock(7244106)`
    other.release()

    // A run left unfinished by a dead process gets closed when the next scrape starts.
    await sql`INSERT INTO runs (search_name, started_at) VALUES ('local', now() - interval '1 day')`
    s = await get() // its process is gone (nobody holds the lock): not running, shown as interrupted
    assert.equal(s.running, null)
    assert.equal(s.searches[0].last_run.status, 'interrupted')
    assert.equal((await post('local')).status, 202)
    for (let i = 0; i < 50 && (s = await get()).running; i++) await new Promise((ok) => setTimeout(ok, 100))
    assert.equal(s.running, null)
    const [x] = s.searches
    assert.deepEqual([x.active, x.last_run.status, x.last_run.pages, x.last_run.seen], [2, 'truncated', 1, 2])
    const statuses = await sql`SELECT status FROM runs ORDER BY started_at`
    assert.deepEqual(statuses.map((r) => r.status), ['interrupted', 'truncated'])
  } finally {
    server.close()
    idealista.close()
  }
})

test('interrupted scrapes are resumed from the page they reached', { skip }, async () => {
  await sql`TRUNCATE listings, runs CASCADE`
  await sql`DELETE FROM session`
  const page = readFileSync(new URL('./fixtures/search_page.html', import.meta.url), 'utf8')
  const requested = []
  const idealista = createServer((req, res) => { requested.push(req.url); res.end(page) }).listen(0)
  const cfg = { ...fakeConfig(`http://localhost:${idealista.address().port}/search/`), maxPagesPerSearch: 3,
    autoResume: true, resumeAttempts: 2 }
  try {
    assert.deepEqual(await recoverInterrupted(sql, cfg), []) // no cookie: nothing to do
    await storeCookie(sql, 'a=1')
    assert.deepEqual(await recoverInterrupted(sql, cfg), []) // nothing interrupted

    // A run that died after page 2 (its process is gone, so nobody holds the lock).
    await sql`INSERT INTO runs (search_name, pages, seen) VALUES ('local', 2, 2)`
    assert.deepEqual(await recoverInterrupted(sql, cfg), ['local'])
    assert.deepEqual(requested, ['/search/pagina-2.htm', '/search/pagina-3.htm']) // page 2 again for overlap
    const runs = await sql`SELECT status, first_page, pages FROM runs ORDER BY started_at`
    assert.deepEqual(runs.map((r) => [r.status, r.first_page, r.pages]),
      [['interrupted', 1, 2], ['truncated', 2, 2]])
    assert.deepEqual(await recoverInterrupted(sql, cfg), []) // finished: nothing left

    // Interrupted too often in a row: gives up.
    await sql`INSERT INTO runs (search_name, finished_at, status) VALUES
      ('local', now(), 'interrupted'), ('local', now(), 'interrupted'), ('local', now(), 'interrupted')`
    requested.length = 0
    assert.deepEqual(await recoverInterrupted(sql, cfg), [])

    // Never while the cookie is known to be blocked.
    await sql`DELETE FROM runs`
    await sql`INSERT INTO runs (search_name, finished_at, status) VALUES ('local', now(), 'interrupted')`
    await setCookieStatus(sql, 'blocked', 'test')
    assert.deepEqual(await recoverInterrupted(sql, cfg), [])
    assert.deepEqual(await recoverInterrupted(sql, { ...cfg, autoResume: false }), [])
    assert.deepEqual(requested, [])
  } finally {
    idealista.close()
  }
})

test('a scrape loads the pages of new listings, capped per run, and the API serves them', { skip }, async () => {
  await sql`TRUNCATE listings, runs CASCADE`
  await sql`DELETE FROM session`
  const search = readFileSync(new URL('./fixtures/search_page.html', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('./fixtures/detail_page.html', import.meta.url), 'utf8')
  const requested = []
  const idealista = createServer((req, res) => {
    requested.push(req.url)
    if (req.url === '/inmueble/104512345/') res.end(detail)
    else if (req.url.startsWith('/inmueble/')) res.writeHead(404).end('not found')
    else res.end(search)
  }).listen(0)
  const base = `http://localhost:${idealista.address().port}`
  const cfg = { ...fakeConfig(`${base}/search/`), fetchDetails: true, detailsPerRun: 1, baseUrl: base }
  const details = () => sql`SELECT listing_id, status, data->>'title' AS title FROM listing_details ORDER BY listing_id`
  try {
    await storeCookie(sql, 'a=1')

    // Cap of 1: only the newest-first first one this run.
    assert.equal(await scrapeAll(sql, cfg), true)
    assert.equal(requested.filter((u) => u.startsWith('/inmueble/')).length, 1)
    let [run] = await sql`SELECT status, pages FROM runs WHERE search_name = '(fichas)'`
    assert.deepEqual([run.status, run.pages], ['truncated', 1])

    // Next run picks up the rest; the one already loaded isn't fetched again.
    assert.equal(await scrapeAll(sql, { ...cfg, detailsPerRun: 10 }), true)
    assert.deepEqual(requested.filter((u) => u.startsWith('/inmueble/')).sort(), ['/inmueble/104512345/', '/inmueble/104599999/'])
    assert.deepEqual((await details()).map((d) => ({ ...d })), [
      { listing_id: '104512345', status: 'ok', title: 'Piso en venta en calle de Fuencarral' },
      { listing_id: '104599999', status: 'gone', title: null }, // 404: taken down
    ])
    const [gone] = await sql`SELECT active FROM listings WHERE id = '104599999'`
    assert.equal(gone.active, false)

    // A third run has nothing left to load.
    requested.length = 0
    assert.equal(await scrapeAll(sql, { ...cfg, detailsPerRun: 10 }), true)
    assert.equal(requested.filter((u) => u.startsWith('/inmueble/')).length, 0)

    // The detail page's API, and loading the page again on demand.
    const server = createApp(sql, { config: () => cfg }).listen(0)
    const api = `http://localhost:${server.address().port}/api/listings/104512345`
    try {
      const body = await (await fetch(api)).json()
      assert.equal(body.listing.details_status, 'ok')
      assert.equal(body.detail.data.facts.bathrooms, 2)
      assert.ok(body.detail.fetched_at)
      assert.deepEqual(body.history.map((h) => h.price), [420000])

      const r = await fetch(`${api}/details`, { method: 'POST' })
      assert.equal(r.status, 200)
      assert.deepEqual(await r.json(), { status: 'ok' })
      assert.equal((await fetch(`${api}/details`, { method: 'POST' })).status, 429) // rate limited
      assert.equal((await fetch(`${api}x`)).status, 404)
    } finally {
      server.close()
    }
  } finally {
    idealista.close()
  }
})

test('API: listings, trends, notes', { skip }, async () => {
  await sql`TRUNCATE listings CASCADE`
  await upsertListing(sql, listing(300000), 's', '2026-09-01')
  await upsertListing(sql, listing(280000), 's', '2026-09-02')
  await saveNote(sql, '1', { starred: true, rating: 4, note: 'nice' })

  const server = createApp(sql).listen(0)
  const base = `http://localhost:${server.address().port}`
  try {
    const [l] = await (await fetch(`${base}/api/listings`)).json()
    assert.equal(l.price, 280000)
    assert.equal(l.first_price, 300000)
    assert.deepEqual(l.searches, ['s'])
    assert.equal(l.starred, true)
    assert.equal(l.size_m2, 80)

    const trends = await (await fetch(`${base}/api/trends`)).json()
    assert.deepEqual(trends.map((t) => [t.day, t.median_eur_m2, t.active]),
      [['2026-09-01', 3750, 1], ['2026-09-02', 3500, 1]])

    const bad = await fetch(`${base}/api/notes/1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"rating":9}' })
    assert.equal(bad.status, 400)
    const ok = await fetch(`${base}/api/notes/1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ starred: false, rating: 2, note: 'meh' }) })
    assert.equal(ok.status, 204)
    const [n] = await sql`SELECT starred, rating, note FROM notes`
    assert.deepEqual({ ...n }, { starred: false, rating: 2, note: 'meh' })
  } finally {
    server.close()
  }
})
