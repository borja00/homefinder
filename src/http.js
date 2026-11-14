// A plain HTTP/1.1 GET that sends exactly the headers we give it.
//
// Node's fetch (undici) can't be used for Idealista: it overwrites
// Sec-Fetch-Mode with "cors" whatever you pass, and a document request in cors
// mode is something no browser sends, so DataDome answers 403 at once. It also
// only offers gzip/deflate. node:http(s) leaves headers alone.

import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'

// What Firefox 146 sends for a same-site page navigation, in its order.
// Host and the per-request Referer/Cookie are slotted in by `browserHeaders`.
const FIREFOX = [
  ['User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0'],
  ['Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
  ['Accept-Language', 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3'],
  ['Accept-Encoding', 'gzip, deflate, br, zstd'],
  ['Referer', null],
  ['Connection', 'keep-alive'],
  ['Cookie', null],
  ['Upgrade-Insecure-Requests', '1'],
  ['Sec-Fetch-Dest', 'document'],
  ['Sec-Fetch-Mode', 'navigate'],
  ['Sec-Fetch-Site', 'same-origin'],
  ['Sec-Fetch-User', '?1'],
  ['Priority', 'u=0, i'],
]

export function browserHeaders({ host, referer, cookie }) {
  const values = { Referer: referer, Cookie: cookie }
  const out = [['Host', host]]
  for (const [name, value] of FIREFOX) {
    const v = value ?? values[name]
    if (v) out.push([name, v])
  }
  return out
}

function decode(body, encoding = 'identity') {
  switch (encoding.trim().toLowerCase()) {
    case 'gzip': return zlib.gunzipSync(body)
    case 'deflate': return zlib.inflateSync(body)
    case 'br': return zlib.brotliDecompressSync(body)
    case 'zstd': return zlib.zstdDecompressSync(body)
    default: return body
  }
}

/** GET `url` once (no redirects). Resolves to { status, headers, setCookies, body: string }. */
export function get(url, { referer, cookie, timeoutMs = 30_000 }) {
  const u = new URL(url)
  const lib = u.protocol === 'https:' ? https : http
  // Raw [name, value, name, value…] keeps our order and casing on the wire.
  const headers = browserHeaders({ host: u.host, referer, cookie }).flat()
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method: 'GET', headers, setHost: false, timeout: timeoutMs }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        try {
          const body = decode(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf8')
          resolve({ status: res.statusCode, headers: res.headers, setCookies: res.headers['set-cookie'] ?? [], body })
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error(`Sin respuesta tras ${timeoutMs / 1000} s: ${url}`)))
    req.on('error', reject)
    req.end()
  })
}
