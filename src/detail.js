// Parse a listing's own Idealista page (/inmueble/<id>/).
//
// Written against Idealista's detail markup as known in 2026 but without a
// saved real page to check it on, so every field has fallbacks and a missing
// one just comes back null/empty. The raw HTML is stored, so after a fix
// `homefinder reparse` rebuilds every detail.

import { parse } from 'node-html-parser'
import { BlockedError, isBlocked } from './parser.js'

const clean = (s) => s?.replace(/\s+/g, ' ').trim() || null
const textOf = (n) => (n ? clean(n.textContent) : null)
const first = (root, selectors) => {
  for (const s of selectors) {
    const n = root.querySelector(s)
    if (n && textOf(n)) return n
  }
  return null
}
const toInt = (t) => {
  const d = t?.replace(/\D/g, '')
  return d ? Number.parseInt(d, 10) : null
}
const toNum = (t) => (t ? Number.parseFloat(t.replace(/\./g, '').replace(',', '.')) : null)

const GONE_MARKERS = ['ya no está publicado', 'anuncio desactivado', 'este anuncio no está disponible', 'deactivated-detail']

/** Feature lists grouped by the heading above them ("Características básicas", "Edificio", …). */
function featureGroups(root) {
  const groups = []
  const price = root.querySelectorAll('.price-features__container .flex-feature, .price-features__container p')
    .map(textOf).filter(Boolean)
  if (price.length) groups.push({ title: 'Precio', items: [...new Set(price)] })

  const container = root.querySelector('.details-property') ?? root.querySelector('#details')
  if (!container) return groups
  let current = null
  const visit = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue
      const tag = child.rawTagName?.toLowerCase()
      if (tag === 'h2' || tag === 'h3') {
        current = { title: textOf(child), items: [] }
        groups.push(current)
      } else if (tag === 'li') {
        // Energy ratings are icons: <span title="e" class="icon-energy-c-e">.
        const icons = child.querySelectorAll('[title]').map((e) => e.getAttribute('title')?.toUpperCase()).filter(Boolean)
        const t = clean([textOf(child), ...icons].filter(Boolean).join(' '))
        if (!t) continue
        if (!current) groups.push((current = { title: 'Características', items: [] }))
        current.items.push(t)
      } else {
        visit(child)
      }
    }
  }
  visit(container)
  return groups.filter((g) => g.items.length)
}

/** Photo URLs, largest variant of each, in page order. Also finds those only in inline scripts. */
function images(root, html) {
  const best = new Map()
  const size = (token) => {
    if (/WEB_DETAIL/i.test(token)) return 5000 + (/XL/i.test(token) ? 2 : /-L/i.test(token) ? 1 : 0)
    return Math.max(0, ...[...token.matchAll(/\d+/g)].map((m) => Number(m[0])))
  }
  const add = (raw) => {
    if (!raw) return
    const url = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/^\/\//, 'https://')
    const m = url.match(/^https?:\/\/img\d*\.idealista\.com\/blur\/([^/]+)\/0\/(.+?)\.(jpe?g|webp)$/i)
    if (!m || /logo|branding/i.test(m[2])) return
    const [, token, key, ext] = m
    const score = size(token) * 10 + (ext.toLowerCase() === 'webp' ? 0 : 1) // prefer jpg on a tie
    const cur = best.get(key)
    if (!cur || score > cur.score) best.set(key, { url, score, order: cur?.order ?? best.size })
  }
  for (const img of root.querySelectorAll('img, source')) {
    add(img.getAttribute('src'))
    add(img.getAttribute('data-src'))
    add(img.getAttribute('data-ondemand-img'))
    for (const part of (img.getAttribute('srcset') ?? '').split(',')) add(part.trim().split(/\s+/)[0])
  }
  for (const m of html.replace(/\\\//g, '/').matchAll(/(?:https?:)?\/\/img\d*\.idealista\.com\/blur\/[^"'\s,)\\]+?\.(?:jpe?g|webp)/gi)) add(m[0])
  const list = [...best.values()].sort((a, b) => a.order - b.order).map((v) => v.url)
  if (!list.length) {
    const og = root.querySelector('meta[property="og:image"]')?.getAttribute('content')
    if (og) list.push(og)
  }
  return list
}

function description(root) {
  const box = first(root, ['.comment .adCommentsLanguage', '.adCommentsLanguage', '.comment', '.commentsContainer'])
  if (box) {
    const paragraphs = box.querySelectorAll('p').map(textOf).filter(Boolean)
    return paragraphs.length ? paragraphs.join('\n\n') : textOf(box)
  }
  return root.querySelector('meta[name="description"]')?.getAttribute('content') ?? null
}

/** Handy single values pulled out of the feature texts. */
function facts(texts) {
  const all = texts.join(' · ')
  const m = (re) => all.match(re)
  return {
    bathrooms: toInt(m(/(\d+)\s+baños?/i)?.[1]),
    built_m2: toNum(m(/(\d[\d.,]*)\s*m²\s+construidos/i)?.[1]),
    usable_m2: toNum(m(/(\d[\d.,]*)\s*m²\s+útiles/i)?.[1]),
    condition: m(/(segunda mano\/[^·]+?|promoción de obra nueva|obra nueva)(?= ·|$)/i)?.[1]?.trim() ?? null,
    year_built: toInt(m(/construido en (\d{4})/i)?.[1]),
    energy: m(/consumo:?\s*([A-G])\b/i)?.[1]?.toUpperCase() ?? null,
  }
}

export function parseDetailPage(html) {
  if (isBlocked(html)) throw new BlockedError('Idealista devolvió una página de bloqueo/CAPTCHA')
  const root = parse(html)
  const low = html.slice(0, 200_000).toLowerCase()
  const groups = featureGroups(root)
  const info = root.querySelectorAll('.info-features > span').map(textOf).filter(Boolean)
  const advertiser = textOf(first(root, ['.professional-name .name', '.advertiser-name', '.about-advertiser-name', '.professional-name']))
  const meta = (p) => root.querySelector(`meta[property="${p}"]`)?.getAttribute('content') ?? null

  return {
    gone: GONE_MARKERS.some((m) => low.includes(m)),
    title: textOf(first(root, ['.main-info__title-main', 'h1'])) ?? meta('og:title'),
    location: textOf(root.querySelector('.main-info__title-minor')),
    address: root.querySelectorAll('#headerMap li, .header-map-list').map(textOf).filter(Boolean),
    price: toInt(textOf(first(root, ['.info-data-price', '.price-features__container .txt-bold']))),
    info,
    description: description(root),
    features: groups,
    facts: facts([...info, ...groups.flatMap((g) => g.items)]),
    images: images(root, html),
    advertiser: advertiser
      ? { name: advertiser, private: /particular/i.test(textOf(root.querySelector('.professional-name')) ?? '') }
      : null,
    updated: textOf(root.querySelector('.date-update-text')) ?? clean(html.match(/Anuncio actualizado[^<.]*/i)?.[0]),
  }
}
