// A minimal cookie jar for one site: the Cookie header pasted from the
// browser, updated with whatever Set-Cookie headers Idealista sends back
// (e.g. a refreshed datadome cookie), so the next run reuses them.

/**
 * Accepts the Cookie header value itself, a "Cookie: ..." line, the whole
 * request headers block, or a "Copy as cURL" command (-H 'Cookie: ...' from
 * Firefox, -b '...' from Chrome), and returns just the header value.
 */
export function extractCookieHeader(input) {
  const text = input.trim()
  const curl = text.match(/(?:-H|--header)\s+(['"])cookie:\s*(.*?)\1/is) ??
    text.match(/(?:-b|--cookie)\s+(['"])(.*?)\1/s)
  if (curl) return curl[2]
  const line = text.split(/\r?\n/).find((l) => /^\s*cookie:/i.test(l))
  return line ?? text
}

export function parseCookieHeader(header) {
  const jar = new Map()
  const text = header.trim().replace(/^cookie:/i, '').trim()
  for (const part of text.split(';')) {
    const eq = part.indexOf('=')
    const name = (eq === -1 ? part : part.slice(0, eq)).trim()
    if (name) jar.set(name, eq === -1 ? '' : part.slice(eq + 1).trim())
  }
  return jar
}

export function toCookieHeader(jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** Apply a response's Set-Cookie headers to the jar. */
export function applySetCookies(jar, setCookieHeaders) {
  for (const sc of setCookieHeaders) {
    const [pair, ...attrs] = sc.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    const expired = attrs.some((a) => {
      const [k, v = ''] = a.split('=').map((s) => s.trim())
      if (k.toLowerCase() === 'max-age') return Number(v) <= 0
      if (k.toLowerCase() === 'expires') return Date.parse(v) < Date.now()
      return false
    })
    if (expired) jar.delete(name)
    else jar.set(name, value)
  }
}
