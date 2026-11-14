import { useState } from 'react'
import { fmtEur, fmtNum, fmtPct } from './lib.js'

const COLUMNS = {
  starred: { label: '★', render: (l) => (l.starred ? '★' : '') },
  title: {
    label: 'Anuncio',
    render: (l) => (
      <>
        <a href={`#anuncio/${encodeURIComponent(l.id)}`}>{l.title}</a>
        {l.tags?.map((t) => <span key={t} className="tag">{t}</span>)}
      </>
    ),
  },
  price: {
    label: 'Precio', num: true,
    render: (l) => (
      <>
        {fmtEur(l.price)}
        {l.previous_price > l.price && <div className="was" title="Precio antes de la última bajada en Idealista">antes {fmtEur(l.previous_price)}</div>}
      </>
    ),
  },
  change_pct: {
    label: 'Δ desde que apareció', num: true,
    render: (l) => <span className={l.change_pct < 0 ? 'down' : l.change_pct > 0 ? 'up' : ''}>{l.change_pct ? fmtPct(l.change_pct) : '–'}</span>,
  },
  eur_m2: { label: '€/m²', num: true, render: (l) => fmtNum(l.eur_m2) },
  size_m2: { label: 'm²', num: true, render: (l) => fmtNum(l.size_m2) },
  rooms: { label: 'Hab.', num: true, render: (l) => l.rooms ?? '–' },
  floor: { label: 'Planta', render: (l) => l.floor ?? '–' },
  days_listed: { label: 'Días publicado', num: true, render: (l) => l.days_listed },
  first_seen: { label: 'Visto por primera vez', render: (l) => l.first_seen },
  removed_on: { label: 'Retirado', render: (l) => l.removed_on ?? '–' },
  searches: { label: 'Búsqueda', render: (l) => l.searches.join(', ') },
}

const DEFAULT = ['starred', 'title', 'price', 'change_pct', 'eur_m2', 'size_m2', 'rooms', 'floor', 'days_listed', 'searches']

export default function ListingsTable({ rows, columns = DEFAULT, sort: initialSort = null, limit = 500 }) {
  const [sort, setSort] = useState(initialSort)
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key]
        if (x == null) return 1
        if (y == null) return -1
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
      })
    : rows
  const toggle = (key) => setSort((s) => ({ key, dir: s?.key === key ? -s.dir : 1 }))

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className={COLUMNS[c].num ? 'num' : ''} onClick={() => toggle(c)}
                  aria-sort={sort?.key === c ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                {COLUMNS[c].label}{sort?.key === c ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map((l) => (
            <tr key={l.id} className={l.active ? '' : 'removed'}>
              {columns.map((c) => <td key={c} className={COLUMNS[c].num ? 'num' : ''}>{COLUMNS[c].render(l)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > limit && <p className="muted">Mostrando {limit} de {sorted.length}. Afina los filtros para ver el resto.</p>}
      {!sorted.length && <p className="muted">Nada por aquí.</p>}
    </div>
  )
}
