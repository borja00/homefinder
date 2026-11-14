import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSearchPage } from '../src/parser.js'
import { DEFAULTS, applyFilters, floorOf, typeOf } from '../web/src/filters.js'

const today = new Date().toISOString().slice(0, 10)
const old = '2026-01-01'

// Shaped like /api/listings rows after enrich() in the dashboard.
const L = (id, over = {}) => ({
  id, title: 'Piso en X', property_type: 'Piso', price: 300000, size_m2: 90, rooms: 3, floor: '2ª planta exterior con ascensor',
  has_lift: true, has_parking: false, parking: null, tags: [], has_plan: false, professional: true,
  previous_price: null, change: 0, first_seen: old, active: true, starred: false, searches: ['s'],
  description: '', agency: null, ...over,
})

const listings = [
  L('flat'),
  L('penthouse', { title: 'Ático en X', property_type: 'Ático', floor: '7ª planta exterior con ascensor', price: 600000 }),
  L('chalet', { title: 'Chalet adosado en X', property_type: 'Chalet adosado', floor: null, rooms: 5, size_m2: 220,
    has_parking: true, parking: 'included' }),
  L('ground', { floor: 'Bajo interior sin ascensor', has_lift: false, rooms: 1, size_m2: 45, price: 150000,
    professional: false, has_plan: true }),
  L('dropped', { previous_price: 350000, has_parking: true, parking: 'optional', first_seen: today }),
  L('rented', { tags: ['Alquilada', 'Lujo'], active: false, searches: ['other'] }),
]
const ids = (patch) => applyFilters(listings, { ...DEFAULTS, ...patch }).map((l) => l.id)

test('derives type and floor level like Idealista groups them', () => {
  assert.deepEqual(listings.map(typeOf), ['piso', 'atico', 'casa', 'piso', 'piso', 'piso'])
  assert.deepEqual(listings.map(floorOf), ['middle', 'top', null, 'ground', 'middle', 'middle'])
})

test('each filter narrows as expected', () => {
  assert.deepEqual(ids({}), ['flat', 'penthouse', 'chalet', 'ground', 'dropped']) // active by default
  assert.deepEqual(ids({ status: 'All' }).length, 6)
  assert.deepEqual(ids({ types: ['atico', 'casa'] }), ['penthouse', 'chalet'])
  assert.deepEqual(ids({ minPrice: '200000', maxPrice: '400000' }), ['flat', 'chalet', 'dropped'])
  assert.deepEqual(ids({ minSize: '100' }), ['chalet'])
  assert.deepEqual(ids({ bedrooms: ['1', '4+'] }), ['chalet', 'ground'])
  assert.deepEqual(ids({ floors: ['ground', 'top'] }), ['penthouse', 'ground'])
  assert.deepEqual(ids({ lift: true, exterior: true }), ['flat', 'penthouse', 'dropped'])
  assert.deepEqual(ids({ parking: 'included' }), ['chalet'])
  assert.deepEqual(ids({ parking: 'any' }), ['chalet', 'dropped'])
  assert.deepEqual(ids({ seen: '1' }), ['dropped'])
  assert.deepEqual(ids({ priceDrop: true }), ['dropped'])
  assert.deepEqual(ids({ plan: true, privateOnly: true }), ['ground'])
  assert.deepEqual(ids({ status: 'All', luxury: true }), ['rented'])
  assert.deepEqual(ids({ status: 'All', hide: ['Alquilada'] }).includes('rented'), false)
  assert.deepEqual(ids({ status: 'All', searches: ['other'] }), ['rented'])
  assert.deepEqual(ids({ query: 'ático' }), ['penthouse'])
})

test('works on parsed cards', () => {
  const parsed = parseSearchPage(readFileSync(new URL('./fixtures/search_page.html', import.meta.url), 'utf8'))
    .map((l) => ({ ...l, active: true, searches: ['s'], first_seen: today, change: 0 }))
  const pick = (patch) => applyFilters(parsed, { ...DEFAULTS, ...patch }).map((l) => l.id)
  assert.deepEqual(pick({ types: ['atico'] }), ['104599999'])
  assert.deepEqual(pick({ priceDrop: true }), ['104512345']) // Idealista's own pricedown marker
  assert.deepEqual(pick({ hide: ['Alquilada'] }), ['104599999'])
})
