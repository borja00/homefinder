import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtNum } from './lib.js'

const RUN_BADGES = {
  complete: ['ok', 'Completa'],
  truncated: ['warn', 'Límite de páginas'],
  blocked: ['bad', 'Bloqueada'],
  error: ['bad', 'Error'],
  interrupted: ['warn', 'Interrumpida'],
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('es-ES') : '–')

function minutes(from, to = Date.now()) {
  const m = Math.round((new Date(to) - new Date(from)) / 60_000)
  return m < 1 ? '<1 min' : `${m} min`
}

export default function SearchesTab({ onScrapeDone }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState('')
  const wasRunning = useRef(false)

  const load = useCallback(() => api('/api/searches').then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  // Poll while a scrape runs; when it ends, refresh listings and the cookie status.
  const running = data?.running
  useEffect(() => {
    if (running) {
      wasRunning.current = true
      const t = setInterval(load, 5000)
      return () => clearInterval(t)
    }
    if (wasRunning.current) {
      wasRunning.current = false
      onScrapeDone()
    }
  }, [running?.id, load])

  async function scrape(name) {
    setStarting(name)
    setError('')
    try {
      const resp = await fetch(`/api/searches/${encodeURIComponent(name)}/scrape`, { method: 'POST' })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setStarting('')
    }
  }

  if (!data) return <p className="notice">{error || 'Cargando…'}</p>
  if (data.error) return <p className="notice error">No se pudo leer la configuración de búsquedas: {data.error}</p>

  return (
    <>
      <h2>Búsquedas</h2>
      <p className="hint">
        La descarga diaria las recorre todas. «Descargar ahora» descarga una búsqueda en el momento, esperando
        25–60 s antes de cada página como la descarga diaria, así que una búsqueda de muchas páginas tarda varios
        minutos. Sigue en marcha en el servidor aunque salgas de esta página. Solo se hace una descarga a la vez.
        Si una descarga se corta (el servidor se paró o se reinició), el servidor la retoma solo en menos de
        5 minutos desde la página a la que había llegado.
      </p>
      {running && (
        <div className="banner info" role="status">
          <strong>Descargando «{running.search_name}»</strong>: {running.pages} página{running.pages === 1 ? '' : 's'},{' '}
          {fmtNum(running.seen)} anuncios hasta ahora, lleva {minutes(running.started_at)}.
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
      <div className="search-list">
        {data.searches.map((s) => {
          const run = s.last_run
          const isRunning = running?.search_name === s.name
          const [tone, label] = isRunning ? ['info', 'En curso'] : RUN_BADGES[run?.status] ?? ['muted', 'Sin descargar']
          return (
            <section key={s.name} className="card search">
              <div className="search-head">
                <h3>{s.name}</h3>
                <span className={`badge ${tone}`}>{label}</span>
              </div>
              <a className="search-url" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
              <dl className="facts">
                <dt>Anuncios</dt><dd>{fmtNum(s.active)} en venta · {fmtNum(s.total)} vistos en total</dd>
                <dt>Última descarga</dt>
                <dd>
                  {run ? <>{when(run.started_at)} · {run.pages} página{run.pages === 1 ? "" : "s"} · {fmtNum(run.seen)} anuncios
                    {run.first_page > 1 && <> · retomada desde la página {run.first_page}</>}
                    {run.finished_at && <> · tardó {minutes(run.started_at, run.finished_at)}</>}</> : '–'}
                </dd>
              </dl>
              <button onClick={() => scrape(s.name)} disabled={!!running || !!starting}>
                {starting === s.name ? 'Iniciando…' : isRunning ? 'Descargando…' : 'Descargar ahora'}
              </button>
            </section>
          )
        })}
      </div>
    </>
  )
}
