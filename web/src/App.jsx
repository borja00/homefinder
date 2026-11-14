import { useCallback, useEffect, useState } from 'react'
import { api, enrich } from './lib.js'
import ListingsTab from './ListingsTab.jsx'
import ChangesTab from './ChangesTab.jsx'
import TrendsTab from './TrendsTab.jsx'
import CompareTab from './CompareTab.jsx'
import SettingsTab from './SettingsTab.jsx'
import SearchesTab from './SearchesTab.jsx'
import DetailPage from './DetailPage.jsx'

// [id (URL hash), label]
const TABS = [
  ['anuncios', 'Anuncios'],
  ['cambios', 'Cambios'],
  ['tendencias', 'Tendencias'],
  ['comparar', 'Comparar y notas'],
  ['busquedas', 'Búsquedas'],
  ['ajustes', 'Ajustes'],
]
const DETAIL = '#anuncio/'
const detailFromHash = () => (location.hash.startsWith(DETAIL) ? decodeURIComponent(location.hash.slice(DETAIL.length)) : null)
const lastTab = () => {
  try { return sessionStorage.getItem('homefinder.tab') } catch { return null }
}
const fromHash = () => TABS.find(([id]) => `#${id}` === location.hash)?.[0] ?? lastTab() ?? TABS[0][0]

export default function App() {
  const [tab, setTabState] = useState(fromHash)
  const [detailId, setDetailId] = useState(detailFromHash)
  const setTab = (id) => {
    history.replaceState(null, '', `#${id}`)
    try { sessionStorage.setItem('homefinder.tab', id) } catch { /* ignore */ }
    setTabState(id)
    setDetailId(null)
  }
  useEffect(() => {
    const onHash = () => { setDetailId(detailFromHash()); if (!detailFromHash()) setTabState(fromHash()) }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  const [listings, setListings] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(() => {
    api('/api/listings').then((rows) => setListings(enrich(rows))).catch((e) => setError(e.message))
  }, [])
  useEffect(reload, [reload])

  const [cookie, setCookie] = useState(null)
  const reloadCookie = useCallback(() => { api('/api/cookie').then(setCookie).catch(() => {}) }, [])
  useEffect(reloadCookie, [reloadCookie])

  let body
  if (detailId) {
    body = <DetailPage id={detailId} onChanged={reload}
                       onBack={() => (history.length > 1 ? history.back() : setTab(tab))} />
  }
  else if (tab === 'ajustes') body = <SettingsTab cookie={cookie} onChange={setCookie} />
  else if (tab === 'busquedas') body = <SearchesTab onScrapeDone={() => { reload(); reloadCookie() }} />
  else if (error) body = <p className="notice error">No se pudieron cargar los anuncios: {error}</p>
  else if (!listings) body = <p className="notice">Cargando…</p>
  else if (!listings.length) {
    body = <p className="notice">Todavía no hay anuncios. Lanza una búsqueda desde la pestaña Búsquedas.</p>
  }
  else if (tab === 'anuncios') body = <ListingsTab listings={listings} />
  else if (tab === 'cambios') body = <ChangesTab listings={listings} />
  else if (tab === 'tendencias') body = <TrendsTab listings={listings} />
  else body = <CompareTab listings={listings} onSaved={reload} />

  return (
    <div className="page">
      <header>
        <h1>Homefinder</h1>
        <nav role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={!detailId && id === tab} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
      </header>
      {cookie && ['missing', 'blocked', 'error'].includes(cookie.status) && tab !== 'ajustes' && (
        <div className="banner" role="alert">
          <strong>{cookie.status === 'missing' ? 'No hay cookie de Idealista.' : 'La cookie de Idealista no funciona.'}</strong>{' '}
          {cookie.status !== 'missing' && cookie.message}{' '}
          No se puede descargar nada hasta que guardes una nueva.{' '}
          <button className="link-inline" onClick={() => setTab('ajustes')}>Ir a Ajustes</button>
        </div>
      )}
      <main>{body}</main>
    </div>
  )
}
