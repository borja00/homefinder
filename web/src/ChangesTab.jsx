import ListingsTable from './ListingsTable.jsx'
import { api } from './lib.js'
import { useEffect, useState } from 'react'

const RUN_STATUS = { complete: 'completa', truncated: 'límite de páginas', blocked: 'bloqueada', error: 'error', interrupted: 'interrumpida' }

export default function ChangesTab({ listings }) {
  const changed = listings.filter((l) => l.change)
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const fresh = listings.filter((l) => l.first_seen >= cutoff)
  const gone = listings.filter((l) => !l.active)

  return (
    <>
      <h2>Cambios de precio</h2>
      {changed.length
        ? <ListingsTable rows={changed} sort={{ key: 'change_pct', dir: 1 }} />
        : <p className="notice">Todavía no hay cambios de precio. Aparecen tras unos días de descargas.</p>}
      <div className="split">
        <section>
          <h2>Nuevos esta semana</h2>
          <ListingsTable rows={fresh} columns={['title', 'price', 'eur_m2', 'first_seen']} sort={{ key: 'first_seen', dir: -1 }} limit={100} />
        </section>
        <section>
          <h2>Retirados recientemente (probablemente vendidos)</h2>
          <ListingsTable rows={gone} columns={['title', 'price', 'days_listed', 'removed_on']} sort={{ key: 'removed_on', dir: -1 }} limit={30} />
        </section>
      </div>
      <Runs />
    </>
  )
}

function Runs() {
  const [runs, setRuns] = useState(null)
  useEffect(() => { api('/api/runs').then(setRuns).catch(() => setRuns([])) }, [])
  if (!runs?.length) return null
  return (
    <section>
      <h2>Últimas descargas</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Búsqueda</th><th>Inicio</th><th className="num">Páginas</th><th className="num">Anuncios</th><th>Estado</th></tr></thead>
          <tbody>
            {runs.slice(0, 12).map((r) => (
              <tr key={r.id}>
                <td>{r.search_name}</td>
                <td>{new Date(r.started_at).toLocaleString('es-ES')}</td>
                <td className="num">{r.pages}</td>
                <td className="num">{r.seen}</td>
                <td className={r.status === 'complete' ? '' : 'warn'}>{RUN_STATUS[r.status] ?? 'en curso'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
