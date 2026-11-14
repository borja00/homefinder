import { useCallback, useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { api, enrich, fmtEur, fmtNum, fmtPct } from './lib.js'
import { baseOptions, lineDataset } from './charts.js'

const when = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }) : '–')
const day = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { dateStyle: 'long' }) : '–')
const yesNo = (v) => (v == null ? null : v ? 'Sí' : 'No')

export default function DetailPage({ id, onBack, onChanged }) {
  const [state, setState] = useState({ loading: true })
  const load = useCallback(() => {
    api(`/api/listings/${encodeURIComponent(id)}`)
      .then(({ listing, detail, history }) => setState({ listing: enrich([listing])[0], detail, history }))
      .catch((e) => setState({ error: e.message }))
  }, [id])
  useEffect(() => { load(); window.scrollTo(0, 0) }, [load])

  if (state.loading) return <p className="notice">Cargando…</p>
  if (state.error) {
    return (
      <>
        <button type="button" className="back" onClick={onBack}>← Volver</button>
        <p className="notice error">
          {/HTTP 404/.test(state.error) ? 'Este anuncio no está en la base de datos.' : `No se pudo cargar el anuncio: ${state.error}`}
        </p>
      </>
    )
  }

  const { listing: l, detail, history } = state
  const d = detail?.data ?? {}
  const f = d.facts ?? {}
  const images = d.images?.length ? d.images : l.thumbnail ? [l.thumbnail] : []
  const keyFacts = [
    ['Superficie', l.size_m2 ? `${fmtNum(l.size_m2)} m²` : null],
    ['Útiles', f.usable_m2 ? `${fmtNum(f.usable_m2)} m²` : null],
    ['Habitaciones', l.rooms],
    ['Baños', f.bathrooms],
    ['Planta', l.floor],
    ['Ascensor', yesNo(l.has_lift)],
    ['Garaje', l.parking === 'optional' ? 'Opcional' : yesNo(l.has_parking)],
    ['Estado', f.condition],
    ['Año', f.year_built],
    ['Certificado energético', f.energy],
  ].filter(([, v]) => v != null && v !== '')

  return (
    <article className="detail">
      <button type="button" className="back" onClick={onBack}>← Volver</button>

      <Gallery images={images} title={l.title} />

      <div className="detail-grid">
        <div className="detail-main">
          <header className="detail-head">
            <h2>{d.title ?? l.title}</h2>
            {(d.location || d.address?.length > 0) && (
              <p className="muted-inline">{d.location ?? d.address.join(', ')}</p>
            )}
            <div className="detail-price">
              <span className="big">{fmtEur(l.price)}</span>
              {l.eur_m2 && <span className="muted-inline">{fmtNum(l.eur_m2)} €/m²</span>}
              {l.previous_price > l.price && <span className="was-inline">antes {fmtEur(l.previous_price)}</span>}
              {l.change_pct ? <span className={l.change_pct < 0 ? 'down' : 'up'}>{fmtPct(l.change_pct)} desde que apareció</span> : null}
            </div>
            <div className="detail-tags">
              <span className={`badge ${l.active ? 'ok' : 'muted'}`}>{l.active ? 'En venta' : `Retirado el ${day(l.removed_on)}`}</span>
              {l.tags?.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          </header>

          {keyFacts.length > 0 && (
            <dl className="key-facts">
              {keyFacts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}

          <section>
            <h3>Evolución del precio</h3>
            <PriceChart history={history} />
          </section>

          <section>
            <h3>Descripción</h3>
            {d.description
              ? <p className="description">{d.description}</p>
              : <>
                  <p className="description">{l.description ?? 'Sin descripción.'}</p>
                  {l.description && <p className="hint">Es el resumen del listado; la descripción completa llega con la ficha.</p>}
                </>}
          </section>

          {d.features?.length > 0 && (
            <section>
              <h3>Características</h3>
              <div className="feature-groups">
                {d.features.map((g) => (
                  <div key={g.title}>
                    <h4>{g.title}</h4>
                    <ul>{g.items.map((it) => <li key={it}>{it}</li>)}</ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="detail-side">
          <section className="card">
            <h3>Anunciante</h3>
            <p>{d.advertiser?.name ?? l.agency ?? '–'}</p>
            {l.professional != null && <p className="muted-inline">{l.professional ? 'Profesional' : 'Particular'}</p>}
          </section>

          <section className="card">
            <h3>Seguimiento</h3>
            <dl className="facts">
              <dt>Visto por primera vez</dt><dd>{day(l.first_seen)}</dd>
              <dt>Visto por última vez</dt><dd>{day(l.last_seen)}</dd>
              <dt>Días publicado</dt><dd>{l.days_listed}</dd>
              <dt>Búsquedas</dt><dd>{l.searches.join(', ') || '–'}</dd>
              {d.updated && <><dt>En Idealista</dt><dd>{d.updated}</dd></>}
            </dl>
          </section>

          <NoteForm listing={l} onSaved={() => { load(); onChanged() }} />

          <DetailSource listingId={l.id} detail={detail} url={l.url} onLoaded={() => { load(); onChanged() }} />
        </aside>
      </div>
    </article>
  )
}

function Gallery({ images, title }) {
  const [i, setI] = useState(0)
  const [broken, setBroken] = useState(new Set())
  const shown = images.filter((u) => !broken.has(u))
  if (!shown.length) return <div className="gallery empty">Sin fotos</div>
  const idx = Math.min(i, shown.length - 1)
  const go = (n) => setI((idx + n + shown.length) % shown.length)
  return (
    <div className="gallery">
      <div className="gallery-main">
        {/* No referrer: Idealista's image host may refuse hotlinks from other sites. */}
        <img src={shown[idx]} alt={`${title}, foto ${idx + 1}`} referrerPolicy="no-referrer"
             onError={() => setBroken((b) => new Set(b).add(shown[idx]))} />
        {shown.length > 1 && (
          <>
            <button type="button" className="nav prev" aria-label="Foto anterior" onClick={() => go(-1)}>‹</button>
            <button type="button" className="nav next" aria-label="Foto siguiente" onClick={() => go(1)}>›</button>
            <span className="counter">{idx + 1}/{shown.length}</span>
          </>
        )}
      </div>
      {shown.length > 1 && (
        <div className="thumbs">
          {shown.map((u, n) => (
            <button key={u} type="button" aria-label={`Foto ${n + 1}`} aria-current={n === idx} onClick={() => setI(n)}>
              <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer"
                   onError={() => setBroken((b) => new Set(b).add(u))} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PriceChart({ history }) {
  if (!history.length) return <p className="muted-inline">Sin precios registrados.</p>
  const changes = history.filter((h, n) => n === 0 || h.price !== history[n - 1].price)
  const options = baseOptions({ yLabel: '€' })
  options.plugins.legend = { display: false }
  options.plugins.tooltip = { callbacks: { label: (c) => fmtEur(c.raw) } }
  options.scales.y.ticks = { ...options.scales.y.ticks, callback: (v) => fmtEur(v) }
  const data = {
    labels: history.map((h) => h.day),
    datasets: [lineDataset('Precio', history.map((h) => h.price), '#2a78d6', { stepped: true, pointRadius: 3 })],
  }
  return (
    <>
      <div className="chart small"><Line data={data} options={options} /></div>
      <p className="hint">
        {changes.length === 1
          ? `Sin cambios: ${fmtEur(history[0].price)} desde el ${day(history[0].day)} (${history.length} día${history.length === 1 ? '' : 's'} registrados).`
          : `${changes.length - 1} cambio${changes.length === 2 ? '' : 's'} de precio en ${history.length} días registrados.`}
      </p>
    </>
  )
}

function NoteForm({ listing, onSaved }) {
  const [form, setForm] = useState({ starred: listing.starred, rating: listing.rating ?? 3, note: listing.note ?? '' })
  const [state, setState] = useState('')
  async function save(e) {
    e.preventDefault()
    setState('saving')
    try {
      await api(`/api/notes/${encodeURIComponent(listing.id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      })
      setState('Guardado')
      onSaved()
    } catch (err) {
      setState(err.message)
    }
  }
  return (
    <form className="card note-form" onSubmit={save}>
      <h3>Mis notas</h3>
      <label className="check">
        <input type="checkbox" checked={form.starred} onChange={(e) => setForm({ ...form, starred: e.target.checked })} /> ★ Favorito
      </label>
      <label className="field">Valoración: {form.rating}
        <input type="range" min="1" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} />
      </label>
      <label className="field">Nota
        <textarea rows="3" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </label>
      <div>
        <button type="submit" className="primary" disabled={state === 'saving'}>Guardar</button>
        {state && state !== 'saving' && <span className="muted-inline"> {state}</span>}
      </div>
    </form>
  )
}

function DetailSource({ listingId, detail, url, onLoaded }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const resp = await fetch(`/api/listings/${encodeURIComponent(listingId)}/details`, { method: 'POST' })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok || body.error) throw new Error(body.error ?? `HTTP ${resp.status}`)
      onLoaded()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  let status
  if (!detail || (detail.status === 'error' && !detail.fetched_at)) {
    status = detail?.error
      ? <>No se pudo descargar la ficha ({detail.attempts} intento{detail.attempts === 1 ? '' : 's'}): {detail.error}</>
      : <>La ficha completa todavía no se ha descargado. Se descarga en la próxima búsqueda (las más nuevas primero), o ahora con el botón.</>
  } else if (detail.status === 'gone') {
    status = <>El anuncio ya no está publicado en Idealista (comprobado el {when(detail.fetched_at)}).</>
  } else {
    status = <>Ficha descargada de Idealista el {when(detail.fetched_at)}.</>
  }

  return (
    <section className="card">
      <h3>Datos de la ficha</h3>
      <p className="hint">{status}</p>
      {detail?.error && detail.fetched_at && <p className="hint warn">Último intento fallido: {detail.error}</p>}
      <button type="button" onClick={refresh} disabled={busy}>{busy ? 'Descargando…' : 'Actualizar desde Idealista'}</button>
      {error && <p className="hint warn">{error}</p>}
      <p className="hint"><a href={url} target="_blank" rel="noreferrer">Ver el anuncio en Idealista ↗</a></p>
    </section>
  )
}
