// Fixed categorical order (validated palette); colour follows the entity, never its rank.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

/** Stable: sorted names map to fixed slots, so filtering never repaints survivors. */
export function colorMap(names) {
  return Object.fromEntries([...names].sort().map((n, i) => [n, SERIES[i % SERIES.length]]))
}

const eur = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' })
export const fmtEur = (v) => (v == null || Number.isNaN(v) ? '–' : `${eur.format(v)} €`)
export const fmtNum = (v) => (v == null || Number.isNaN(v) ? '–' : eur.format(v))
export const fmtPct = (v) => (v == null || Number.isNaN(v) ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)} %`)

export function median(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

const DAY = 86_400_000

/** Adds the derived columns the views use. */
export function enrich(rows) {
  return rows.map((r) => {
    const change = r.price != null && r.first_price != null ? r.price - r.first_price : null
    return {
      ...r,
      eur_m2: r.price && r.size_m2 ? Math.round(r.price / r.size_m2) : null,
      change,
      change_pct: change != null && r.first_price ? (100 * change) / r.first_price : null,
      days_listed: Math.round((Date.parse(r.last_seen) - Date.parse(r.first_seen)) / DAY),
    }
  })
}

export async function api(path, options) {
  const resp = await fetch(path, options)
  if (!resp.ok) throw new Error(`${options?.method ?? 'GET'} ${path}: HTTP ${resp.status}`)
  return resp.status === 204 ? null : resp.json()
}

export function label(l) {
  return l.price != null ? `${l.title} · ${fmtEur(l.price)}` : l.title
}
