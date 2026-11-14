import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { SERIES, api, fmtEur, fmtNum, fmtPct, label } from './lib.js'
import { baseOptions, lineDataset } from './charts.js'

const MAX = 4
const yesNo = (v) => (v == null ? '–' : v ? 'sí' : 'no')

export default function CompareTab({ listings, onSaved }) {
  const byId = Object.fromEntries(listings.map((l) => [l.id, l]))
  const options = [...listings].sort((a, b) => b.starred - a.starred || a.title.localeCompare(b.title))
  const [picked, setPicked] = useState(() => listings.filter((l) => l.starred).slice(0, MAX).map((l) => l.id))
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!picked.length) return setHistory([])
    api(`/api/history?ids=${picked.map(encodeURIComponent).join(',')}`).then(setHistory).catch(() => setHistory([]))
  }, [picked.join(',')])

  const sel = picked.map((id) => byId[id]).filter(Boolean)
  const rows = [
    ['Precio', (l) => fmtEur(l.price)],
    ['Primer precio', (l) => fmtEur(l.first_price)],
    ['Cambio', (l) => (l.change_pct ? fmtPct(l.change_pct) : '–')],
    ['€/m²', (l) => fmtNum(l.eur_m2)],
    ['Superficie', (l) => (l.size_m2 ? `${fmtNum(l.size_m2)} m²` : '–')],
    ['Habitaciones', (l) => l.rooms ?? '–'],
    ['Planta', (l) => l.floor ?? '–'],
    ['Ascensor', (l) => yesNo(l.has_lift)],
    ['Garaje', (l) => (l.parking === 'optional' ? 'opcional' : yesNo(l.has_parking))],
    ['Inmobiliaria', (l) => l.agency ?? '–'],
    ['Días publicado', (l) => l.days_listed],
    ['Estado', (l) => (l.active ? 'en venta' : `retirado el ${l.removed_on}`)],
    ['Valoración', (l) => (l.rating ? '★'.repeat(l.rating) : '–')],
    ['Nota', (l) => l.note || '–'],
  ]

  const days = [...new Set(history.map((h) => h.day))].sort()
  const chart = {
    labels: days,
    datasets: sel.map((l, i) => {
      const byDay = Object.fromEntries(history.filter((h) => h.listing_id === l.id).map((h) => [h.day, h.price]))
      return lineDataset(l.title.slice(0, 40), days.map((d) => byDay[d] ?? null), SERIES[i], { stepped: true })
    }),
  }

  return (
    <>
      <div className="filters">
        <label className="field grow">Añadir un anuncio a la comparación (hasta {MAX})
          <select value="" disabled={picked.length >= MAX}
                  onChange={(e) => e.target.value && setPicked((p) => [...p, e.target.value])}>
            <option value="">Elegir…</option>
            {options.filter((l) => !picked.includes(l.id)).map((l) => (
              <option key={l.id} value={l.id}>{l.starred ? '★ ' : ''}{label(l)}</option>
            ))}
          </select>
        </label>
      </div>

      {!sel.length ? (
        <p className="notice">Elige anuncios arriba, o marca alguno como favorito en Notas, más abajo.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th />
                  {sel.map((l, i) => (
                    <th key={l.id}>
                      <span className="swatch" style={{ background: SERIES[i] }} />
                      <a href={`#anuncio/${encodeURIComponent(l.id)}`}>{l.title.slice(0, 40)}</a>
                      <button className="link" aria-label="Quitar de la comparación"
                              onClick={() => setPicked((p) => p.filter((x) => x !== l.id))}>×</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, f]) => (
                  <tr key={name}><th scope="row">{name}</th>{sel.map((l) => <td key={l.id}>{f(l)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Historial de precios</h2>
          <div className="chart"><Line data={chart} options={baseOptions({ yLabel: 'Precio (€)' })} /></div>
        </>
      )}

      <hr />
      <NoteEditor listings={options} onSaved={onSaved} />
    </>
  )
}

function NoteEditor({ listings, onSaved }) {
  const [id, setId] = useState('')
  const current = listings.find((l) => l.id === id)
  const [form, setForm] = useState(null)
  const [state, setState] = useState('')

  useEffect(() => {
    setForm(current ? { starred: current.starred, rating: current.rating ?? 3, note: current.note ?? '' } : null)
    setState('')
  }, [id])

  async function save(e) {
    e.preventDefault()
    setState('saving')
    try {
      await api(`/api/notes/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      })
      setState('saved')
      onSaved()
    } catch (err) {
      setState(err.message)
    }
  }

  return (
    <section>
      <h2>Notas</h2>
      <label className="field">Anuncio
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Elige un anuncio para anotar</option>
          {listings.map((l) => <option key={l.id} value={l.id}>{l.starred ? '★ ' : ''}{label(l)}</option>)}
        </select>
      </label>
      {form && (
        <form className="note-form" onSubmit={save}>
          <label className="chip">
            <input type="checkbox" checked={form.starred} onChange={(e) => setForm({ ...form, starred: e.target.checked })} /> ★ Favorito
          </label>
          <label className="field">Valoración: {form.rating}
            <input type="range" min="1" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} />
          </label>
          <label className="field">Nota
            <textarea rows="4" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <div>
            <button type="submit" className="primary" disabled={state === 'saving'}>Guardar</button>
            {state && state !== 'saving' && <span className={state === 'saved' ? 'muted' : 'warn'}> {state === 'saved' ? 'Guardado' : state}</span>}
          </div>
        </form>
      )}
    </section>
  )
}
