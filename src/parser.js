// Parse Idealista search-result pages into listing records.
//
// Selectors reflect Idealista's markup as of 2026 and will drift; raw HTML is
// kept in the raw_pages table so `homefinder reparse` can rebuild data after
// fixing them.

import { parse } from 'node-html-parser'

export const BASE_URL = 'https://www.idealista.com'

const BLOCK_MARKERS = [
  'captcha-delivery.com',
  'geo.captcha-delivery',
  'datadome',
  'se ha detectado un uso indebido',
  'uso indebido',
]

/** Idealista served a CAPTCHA / bot-block page instead of results. */
export class BlockedError extends Error {
  name = 'BlockedError'
}

export function isBlocked(html) {
  const head = html.slice(0, 20000).toLowerCase()
  return BLOCK_MARKERS.some((m) => head.includes(m))
}

function toInt(text) {
  if (!text) return null
  const digits = text.replace(/\D/g, '')
  return digits ? Number.parseInt(digits, 10) : null
}

function toFloat(text) {
  if (!text) return null
  const m = text.match(/\d[\d.]*(?:,\d+)?/)
  return m ? Number.parseFloat(m[0].replaceAll('.', '').replace(',', '.')) : null
}

function textOf(node) {
  if (!node) return null
  const t = node.textContent.replace(/\s+/g, ' ').trim()
  return t || null
}

function parseDetails(listing, details) {
  for (const d of details) {
    const low = d.toLowerCase()
    if (low.includes('hab')) {
      listing.rooms = toInt(d)
    } else if (low.includes('m²') || low.includes('m2')) {
      listing.size_m2 = toFloat(d)
    } else if (['planta', 'bajo', 'exterior', 'interior'].some((w) => low.includes(w))) {
      listing.floor = d
      if (low.includes('con ascensor')) listing.has_lift = true
      else if (low.includes('sin ascensor')) listing.has_lift = false
    } else if (low.includes('garaje') || low.includes('parking')) {
      // "Garaje incluido", or "Garaje opc. 25.000 €" (available at extra cost).
      listing.has_parking = true
      if (listing.parking !== 'included') listing.parking = low.includes('opc') ? 'optional' : 'included'
    }
  }
}

export function parseSearchPage(html) {
  if (isBlocked(html)) throw new BlockedError('Idealista returned a block/CAPTCHA page')
  const root = parse(html)
  const listings = []
  for (const article of root.querySelectorAll('article.item[data-element-id]')) {
    const id = article.getAttribute('data-element-id')
    const link = article.querySelector('a.item-link')
    if (!id || !link) continue
    const title = textOf(link) ?? ''
    const professional = article.getAttribute('data-is-professional-ad')
    const listing = {
      id,
      url: new URL(link.getAttribute('href') ?? '', BASE_URL).href,
      title,
      property_type: title.includes(' en ') ? title.slice(0, title.indexOf(' en ')) : null,
      price: toInt(textOf(article.querySelector('.item-price'))),
      previous_price: toInt(textOf(article.querySelector('.pricedown_price'))),
      parking: null,
      tags: article.querySelectorAll('.listing-tags').map((t) => textOf(t)).filter(Boolean),
      has_plan: article.querySelector('[data-button-type="PLAN"]') !== null,
      professional: professional === 'true' ? true : professional === 'false' ? false : null,
      size_m2: null,
      rooms: null,
      floor: null,
      has_lift: null,
      has_parking: false,
      description: textOf(article.querySelector('.item-description')),
      agency: article.querySelector('.logo-branding img')?.getAttribute('alt') ?? null,
      thumbnail: null,
    }
    parseDetails(listing, article.querySelectorAll('.item-detail').map((d) => textOf(d) ?? ''))
    if (article.querySelector('.item-parking')) {
      listing.has_parking = true
      listing.parking ??= 'included'
    }
    const img = article.querySelector('img')
    if (img) listing.thumbnail = img.getAttribute('src') || img.getAttribute('data-src') || null
    listings.push(listing)
  }
  return listings
}

export function hasNextPage(html) {
  return parse(html).querySelector('.pagination li.next a') !== null
}

/** Idealista paginates as .../pagina-N.htm before the query string. */
export function pageUrl(searchUrl, page) {
  if (page <= 1) return searchUrl
  const q = searchUrl.indexOf('?')
  let base = q === -1 ? searchUrl : searchUrl.slice(0, q)
  const query = q === -1 ? '' : searchUrl.slice(q)
  base = base.replace(/pagina-\d+\.htm$/, '')
  if (!base.endsWith('/')) base += '/'
  return `${base}pagina-${page}.htm${query}`
}

export function pricePerM2(listing) {
  return listing.price && listing.size_m2 ? Math.round((listing.price / listing.size_m2) * 10) / 10 : null
}
