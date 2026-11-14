import postgres from 'postgres'
import { databaseUrl } from './config.js'

export function connect(url = databaseUrl(), options = {}) {
  return postgres(url, {
    onnotice: () => {},
    types: {
      // numeric (size_m2, medians) and bigint (ids, counts) come back as JS numbers.
      numeric: { to: 1700, from: [1700, 20], parse: Number, serialize: String },
      // dates stay 'YYYY-MM-DD' strings; a Date object would shift with the timezone.
      date: { to: 1082, from: [1082], parse: (v) => v, serialize: (v) => v },
    },
    transform: { undefined: null },
    ...options,
  })
}

/** ISO date (YYYY-MM-DD) of a Date in local time. */
export function isoDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function upsertListing(sql, l, searchName, day) {
  await sql`
    INSERT INTO listings (id, url, title, price, size_m2, rooms, floor, has_lift, has_parking,
                          agency, thumbnail, description, first_seen, last_seen, active, removed_on,
                          property_type, parking, tags, has_plan, professional, previous_price)
    VALUES (${l.id}, ${l.url}, ${l.title}, ${l.price}, ${l.size_m2}, ${l.rooms}, ${l.floor},
            ${l.has_lift}, ${l.has_parking}, ${l.agency}, ${l.thumbnail}, ${l.description},
            ${day}, ${day}, true, NULL,
            ${l.property_type ?? null}, ${l.parking ?? null}, ${l.tags ?? []}::text[], ${l.has_plan ?? null},
            ${l.professional ?? null}, ${l.previous_price ?? null})
    ON CONFLICT (id) DO UPDATE SET
      -- Pages may be (re)parsed out of order, so only newer data wins.
      url = EXCLUDED.url,
      title = EXCLUDED.title,
      price = CASE WHEN EXCLUDED.last_seen >= listings.last_seen THEN EXCLUDED.price ELSE listings.price END,
      previous_price = CASE WHEN EXCLUDED.last_seen >= listings.last_seen
                            THEN EXCLUDED.previous_price ELSE listings.previous_price END,
      tags = CASE WHEN EXCLUDED.last_seen >= listings.last_seen THEN EXCLUDED.tags ELSE listings.tags END,
      parking = CASE WHEN EXCLUDED.last_seen >= listings.last_seen
                     THEN EXCLUDED.parking ELSE listings.parking END,
      property_type = COALESCE(EXCLUDED.property_type, listings.property_type),
      has_plan = COALESCE(EXCLUDED.has_plan, listings.has_plan),
      professional = COALESCE(EXCLUDED.professional, listings.professional),
      size_m2 = COALESCE(EXCLUDED.size_m2, listings.size_m2),
      rooms = COALESCE(EXCLUDED.rooms, listings.rooms),
      floor = COALESCE(EXCLUDED.floor, listings.floor),
      has_lift = COALESCE(EXCLUDED.has_lift, listings.has_lift),
      has_parking = EXCLUDED.has_parking OR listings.has_parking,
      agency = COALESCE(EXCLUDED.agency, listings.agency),
      thumbnail = COALESCE(EXCLUDED.thumbnail, listings.thumbnail),
      description = COALESCE(EXCLUDED.description, listings.description),
      first_seen = LEAST(listings.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(listings.last_seen, EXCLUDED.last_seen),
      active = CASE WHEN EXCLUDED.last_seen >= listings.last_seen THEN true ELSE listings.active END,
      removed_on = CASE WHEN EXCLUDED.last_seen >= listings.last_seen THEN NULL ELSE listings.removed_on END
  `
  await sql`
    INSERT INTO snapshots (listing_id, seen_on, price) VALUES (${l.id}, ${day}, ${l.price})
    ON CONFLICT (listing_id, seen_on) DO UPDATE SET price = EXCLUDED.price
  `
  await sql`
    INSERT INTO listing_searches (listing_id, search_name) VALUES (${l.id}, ${searchName})
    ON CONFLICT DO NOTHING
  `
}

/**
 * Deactivate listings of a search that were absent from a *complete* run.
 *
 * Only call this when every result page was loaded, otherwise listings that
 * simply fell beyond max_pages would be wrongly marked as removed.
 */
export async function markRemoved(sql, searchName, seenIds, day) {
  const rows = await sql`
    UPDATE listings l SET active = false, removed_on = ${day}
    FROM listing_searches s
    WHERE s.listing_id = l.id AND s.search_name = ${searchName} AND l.active
      AND NOT (l.id = ANY(${[...seenIds]}::text[]))
    RETURNING l.id
  `
  return rows.length
}

export async function startRun(sql, searchName, firstPage = 1) {
  const [row] = await sql`
    INSERT INTO runs (search_name, first_page) VALUES (${searchName}, ${firstPage}) RETURNING id`
  return row.id
}

export async function finishRun(sql, runId, pages, seen, status) {
  await sql`
    UPDATE runs SET finished_at = now(), pages = ${pages}, seen = ${seen}, status = ${status}
    WHERE id = ${runId}
  `
}

export async function saveNote(sql, listingId, { starred, rating, note }) {
  await sql`
    INSERT INTO notes (listing_id, starred, rating, note, updated_at)
    VALUES (${listingId}, ${!!starred}, ${rating ?? null}, ${note ?? null}, now())
    ON CONFLICT (listing_id) DO UPDATE SET
      starred = EXCLUDED.starred, rating = EXCLUDED.rating,
      note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
  `
}

export async function getSession(sql, key) {
  const [row] = await sql`SELECT value FROM session WHERE key = ${key}`
  return row?.value ?? null
}

export async function setSession(sql, key, value) {
  await sql`
    INSERT INTO session (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `
}
