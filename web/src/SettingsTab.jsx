import { useState } from 'react'
import { api } from './lib.js'

const BADGES = {
  ok: ['ok', 'Funciona'],
  blocked: ['bad', 'Bloqueada'],
  error: ['warn', 'Comprobación fallida'],
  unvalidated: ['warn', 'Sin comprobar'],
  missing: ['bad', 'Sin cookie'],
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('es-ES') : '–')

async function send(path, method, body) {
  const resp = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
  return data
}

export default function SettingsTab({ cookie, onChange }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function run(label, fn) {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
      api('/api/cookie').then(onChange).catch(() => {})
    } finally {
      setBusy('')
    }
  }

  const saveAndValidate = (e) => {
    e.preventDefault()
    run('Guardando y comprobando…', async () => {
      onChange(await send('/api/cookie', 'PUT', { cookie: input }))
      setInput('')
      onChange(await send('/api/cookie/validate', 'POST'))
    })
  }
  const validate = () => run('Comprobando…', async () => onChange(await send('/api/cookie/validate', 'POST')))

  const [tone, text] = BADGES[cookie?.status] ?? ['warn', 'Desconocido']

  return (
    <>
      <h2>Cookie de Idealista</h2>
      <section className="card">
        {!cookie ? <p>Cargando…</p> : (
          <>
            <p className="status-line">
              <span className={`badge ${tone}`}>{text}</span>
              <span>{cookie.message}</span>
            </p>
            <dl className="facts">
              <dt>Última comprobación</dt><dd>{when(cookie.checked_at)}</dd>
              <dt>Guardada</dt><dd>{when(cookie.saved_at)}</dd>
              <dt>Cookies</dt>
              <dd>{cookie.names.length ? <>{cookie.names.length}: <span className="muted-inline">{cookie.names.join(', ')}</span></> : '–'}</dd>
            </dl>
            <button onClick={validate} disabled={!cookie.stored || !!busy}>Comprobar la cookie actual</button>
          </>
        )}
      </section>

      <h2>Guardar una cookie nueva</h2>
      <form className="card note-form wide" onSubmit={saveAndValidate}>
        <ol className="steps">
          <li>Abre <a href="https://www.idealista.com/" target="_blank" rel="noreferrer">idealista.com</a> en tu navegador y supera la comprobación si te la pide.</li>
          <li>Abre las herramientas de desarrollo → Red, recarga la página y haz clic en la primera petición a idealista.com.</li>
          <li>Clic derecho en la petición → Copiar → <strong>Copiar como cURL</strong> y pégalo abajo. (También vale copiar la cabecera <code>Cookie</code> desde la vista de cabeceras, pero activa antes «Sin procesar»/«Raw»: si no, los valores largos se cortan con «…».)</li>
        </ol>
        <textarea rows="6" value={input} onChange={(e) => setInput(e.target.value)}
                  placeholder="datadome=…; userUUID=…; …" spellCheck="false" />
        <div>
          <button type="submit" className="primary" disabled={!input.trim() || !!busy}>Guardar y comprobar</button>
          {busy && <span className="muted-inline"> {busy}</span>}
          {error && <span className="warn"> {error}</span>}
        </div>
        <p className="hint">La comprobación carga una vez la página 1 de tu primera búsqueda, como haría la descarga diaria.
          La descarga diaria también actualiza este estado cada mañana.</p>
      </form>
    </>
  )
}
