// Pure filter logic for the Listings tab (tested in test/filters.test.js).

export function typeOf(l) {
  const t = (l.property_type ?? l.title ?? '').toLowerCase()
  if (t.startsWith('ático')) return 'atico'
  if (t.startsWith('dúplex')) return 'duplex'
  if (/casa|chalet|villa|finca/.test(t)) return 'casa'
  return 'piso'
}

export function floorOf(l) {
  if (typeOf(l) === 'atico') return 'top'
  const f = (l.floor ?? '').toLowerCase()
  if (/bajo|entreplanta|sótano/.test(f)) return 'ground'
  if (/\d+ª planta/.test(f)) return 'middle'
  return null
}

const exteriorOf = (l) => (/exterior/i.test(l.floor ?? '') ? true : /interior/i.test(l.floor ?? '') ? false : null)
export const priceDropped = (l) => l.change < 0 || (l.previous_price != null && l.previous_price > l.price)
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

export const DEFAULTS = {
  searches: null, // null = all
  status: 'Active',
  types: [],
  minPrice: '', maxPrice: '',
  minSize: '', maxSize: '',
  bedrooms: [],
  floors: [],
  lift: false, exterior: false, parking: '', // '' | 'included' | 'any'
  seen: '',
  priceDrop: false, plan: false, privateOnly: false, luxury: false,
  hide: [],
  starred: false,
  query: '',
}
export function applyFilters(listings, f) {
  const q = f.query.trim().toLowerCase()
  const since = f.seen ? daysAgo(Number(f.seen)) : null
  return listings.filter((l) =>
    (!f.searches || l.searches.some((s) => f.searches.includes(s))) &&
    (f.status === 'All' || l.active === (f.status === 'Active')) &&
    (!f.types.length || f.types.includes(typeOf(l))) &&
    (!f.minPrice || (l.price != null && l.price >= Number(f.minPrice))) &&
    (!f.maxPrice || (l.price != null && l.price <= Number(f.maxPrice))) &&
    (!f.minSize || (l.size_m2 != null && l.size_m2 >= Number(f.minSize))) &&
    (!f.maxSize || (l.size_m2 != null && l.size_m2 <= Number(f.maxSize))) &&
    (!f.bedrooms.length || (l.rooms != null && f.bedrooms.includes(l.rooms >= 4 ? '4+' : String(l.rooms)))) &&
    (!f.floors.length || f.floors.includes(floorOf(l))) &&
    (!f.lift || l.has_lift === true) &&
    (!f.exterior || exteriorOf(l) === true) &&
    (!f.parking || (f.parking === 'included' ? l.parking === 'included' : l.has_parking)) &&
    (!since || l.first_seen >= since) &&
    (!f.priceDrop || priceDropped(l)) &&
    (!f.plan || l.has_plan === true) &&
    (!f.privateOnly || l.professional === false) &&
    (!f.luxury || l.tags?.includes('Lujo')) &&
    !f.hide.some((t) => l.tags?.includes(t)) &&
    (!f.starred || l.starred) &&
    (!q || `${l.title} ${l.description ?? ''} ${l.agency ?? ''}`.toLowerCase().includes(q)))
}
