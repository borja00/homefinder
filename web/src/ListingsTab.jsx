import { useEffect, useMemo, useState } from 'react'
import ListingsTable from './ListingsTable.jsx'
import { fmtEur, fmtNum, median } from './lib.js'
import { DEFAULTS, applyFilters, priceDropped } from './filters.js'

// The filters Idealista offers for homes for sale, as far as the result cards
// tell us. Bathrooms, condition and features like terrace or pool only appear
// on each listing's own page, which we don't load.

const PRICES = [50, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 450,
  500, 550, 600, 700, 800, 900, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000].map((k) => k * 1000)
const SIZES = [40, 60, 80, 100, 120, 140, 160, 180, 200, 250, 300, 350, 400, 500]

const TYPES = [
  ['piso', 'Pisos'],
  ['atico', 'Áticos'],
  ['duplex', 'Dúplex'],
  ['casa', 'Casas y chalets'],
]
const BEDROOMS = ['0', '1', '2', '3', '4+']
const FLOORS = [['top', 'Última planta (ático)'], ['middle', 'Plantas intermedias'], ['ground', 'Bajos']]
const SEEN = [['', 'Indiferente'], ['1', 'Últimas 24 horas'], ['2', 'Últimas 48 horas'], ['7', 'Última semana'], ['30', 'Último mes']]
const HIDE = [['Alquilada', 'Alquiladas'], ['Nuda propiedad', 'Nuda propiedad'], ['Ocupada ilegalmente', 'Ocupadas ilegalmente']]

const STORE = 'homefinder.filters'

function loadFilters() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export default function ListingsTab({ listings }) {
  const searches = useMemo(() => [...new Set(listings.flatMap((l) => l.searches))].sort(), [listings])
  const [f, setF] = useState(loadFilters)
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }))
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(f)) } catch { /* private window */ }
  }, [f])

  const view = applyFilters(listings, f)
  const chosen = f.searches ?? searches
  const changed = Object.keys(DEFAULTS).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(DEFAULTS[k])).length

  const filters = (
    <>
      <Group title="Búsqueda">
        {searches.map((s) => (
          <Check key={s} label={s} checked={chosen.includes(s)}
                 onChange={() => { const next = toggle(chosen, s); set({ searches: next.length === searches.length ? null : next }) }} />
        ))}
      </Group>
      <Group title="Estado">
        <Segmented options={[['Active', 'En venta'], ['Removed', 'Retirados'], ['All', 'Todos']]} value={f.status} onChange={(status) => set({ status })} />
      </Group>
      <Group title="Tipo de vivienda">
        {TYPES.map(([v, label]) => <Check key={v} label={label} checked={f.types.includes(v)} onChange={() => set({ types: toggle(f.types, v) })} />)}
      </Group>
      <Group title="Precio">
        <Range options={PRICES} format={fmtEur} min={f.minPrice} max={f.maxPrice}
               onChange={(minPrice, maxPrice) => set({ minPrice, maxPrice })} />
      </Group>
      <Group title="Tamaño">
        <Range options={SIZES} format={(v) => `${v} m²`} min={f.minSize} max={f.maxSize}
               onChange={(minSize, maxSize) => set({ minSize, maxSize })} />
      </Group>
      <Group title="Habitaciones">
        <div className="pills">
          {BEDROOMS.map((b) => (
            <button key={b} type="button" aria-pressed={f.bedrooms.includes(b)} onClick={() => set({ bedrooms: toggle(f.bedrooms, b) })}>
              {b === '0' ? '0 (estudios)' : b}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Planta">
        {FLOORS.map(([v, label]) => <Check key={v} label={label} checked={f.floors.includes(v)} onChange={() => set({ floors: toggle(f.floors, v) })} />)}
      </Group>
      <Group title="Características">
        <Check label="Ascensor" checked={f.lift} onChange={() => set({ lift: !f.lift })} />
        <Check label="Exterior" checked={f.exterior} onChange={() => set({ exterior: !f.exterior })} />
        <Check label="Garaje incluido" checked={f.parking === 'included'} onChange={() => set({ parking: f.parking === 'included' ? '' : 'included' })} />
        <Check label="Garaje incluido u opcional" checked={f.parking === 'any'} onChange={() => set({ parking: f.parking === 'any' ? '' : 'any' })} />
      </Group>
      <Group title="Visto por primera vez">
        <select value={f.seen} onChange={(e) => set({ seen: e.target.value })}>
          {SEEN.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </Group>
      <Group title="Otros">
        <Check label="Bajada de precio" checked={f.priceDrop} onChange={() => set({ priceDrop: !f.priceDrop })} />
        <Check label="Con plano" checked={f.plan} onChange={() => set({ plan: !f.plan })} />
        <Check label="Solo particulares" checked={f.privateOnly} onChange={() => set({ privateOnly: !f.privateOnly })} />
        <Check label="Lujo" checked={f.luxury} onChange={() => set({ luxury: !f.luxury })} />
        <Check label="Solo favoritos" checked={f.starred} onChange={() => set({ starred: !f.starred })} />
      </Group>
      <Group title="Ocultar">
        {HIDE.map(([v, label]) => <Check key={v} label={label} checked={f.hide.includes(v)} onChange={() => set({ hide: toggle(f.hide, v) })} />)}
      </Group>
    </>
  )

  return (
    <div className="listings-layout">
      <aside className="sidebar">
        <details open={window.matchMedia?.('(min-width: 900px)').matches}>
          <summary>Filtros{changed ? ` (${changed})` : ''}</summary>
          <div className="sidebar-body">
            {filters}
            <button type="button" className="clear" disabled={!changed} onClick={() => setF(DEFAULTS)}>Quitar filtros</button>
          </div>
        </details>
      </aside>

      <section className="results">
        <input type="search" className="query" placeholder="Buscar en título, descripción o inmobiliaria…" value={f.query}
               onChange={(e) => set({ query: e.target.value })} />
        <div className="tiles">
          <Tile label="Anuncios" value={fmtNum(view.length)} />
          <Tile label="Precio mediano" value={fmtEur(median(view.map((l) => l.price)))} />
          <Tile label="€/m² mediano" value={fmtNum(median(view.map((l) => l.eur_m2)))} />
          <Tile label="Con bajada de precio" value={fmtNum(view.filter(priceDropped).length)} />
        </div>
        <ListingsTable rows={view} sort={{ key: 'first_seen', dir: -1 }} />
      </section>
    </div>
  )
}

function Group({ title, children }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={onChange} /> {label}
    </label>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="pills">
      {options.map(([o, label]) => <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>{label}</button>)}
    </div>
  )
}

function Range({ options, format, min, max, onChange }) {
  return (
    <div className="range">
      <select aria-label="Mínimo" value={min} onChange={(e) => onChange(e.target.value, max)}>
        <option value="">Mín.</option>
        {options.filter((v) => !max || v <= Number(max)).map((v) => <option key={v} value={v}>{format(v)}</option>)}
      </select>
      <select aria-label="Máximo" value={max} onChange={(e) => onChange(min, e.target.value)}>
        <option value="">Máx.</option>
        {options.filter((v) => !min || v >= Number(min)).map((v) => <option key={v} value={v}>{format(v)}</option>)}
      </select>
    </div>
  )
}

function Tile({ label, value }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  )
}
