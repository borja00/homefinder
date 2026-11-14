import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import zlib from 'node:zlib'
import { parseCookieHeader } from '../src/cookies.js'
import { fetchPage } from '../src/scraper.js'

function server(handler) {
  const s = createServer(handler).listen(0)
  return { url: `http://localhost:${s.address().port}`, close: () => s.close() }
}

test('sends browser navigation headers untouched, in order', async () => {
  let raw
  const s = server((req, res) => { raw = req.rawHeaders; res.end('<html></html>') })
  try {
    await fetchPage(parseCookieHeader('a=1; b=2'), `${s.url}/x/`, 'https://www.idealista.com/')
  } finally {
    s.close()
  }
  const names = raw.filter((_, i) => i % 2 === 0)
  const h = Object.fromEntries(names.map((n, i) => [n, raw[i * 2 + 1]]))
  // Node's fetch turns this into "cors"; that alone gets a 403 from DataDome.
  assert.equal(h['Sec-Fetch-Mode'], 'navigate')
  assert.equal(h['Accept-Encoding'], 'gzip, deflate, br, zstd')
  assert.equal(h.Cookie, 'a=1; b=2')
  assert.equal(h.Referer, 'https://www.idealista.com/')
  assert.deepEqual(names, ['Host', 'User-Agent', 'Accept', 'Accept-Language', 'Accept-Encoding', 'Referer',
    'Connection', 'Cookie', 'Upgrade-Insecure-Requests', 'Sec-Fetch-Dest', 'Sec-Fetch-Mode', 'Sec-Fetch-Site',
    'Sec-Fetch-User', 'Priority'])
})

test('decodes every encoding it offers and follows redirects with cookies', async () => {
  const page = '<html>ñandú €</html>'
  const enc = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }
  const s = server((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/final/br', 'set-cookie': 'datadome=new; Path=/' }).end()
      return
    }
    const e = req.url.split('/').pop()
    res.writeHead(200, { 'content-encoding': e, 'set-cookie': `seen_${e}=1` }).end(enc[e](page))
  })
  try {
    for (const e of Object.keys(enc)) {
      assert.equal(await fetchPage(new Map(), `${s.url}/final/${e}`, s.url), page, e)
    }
    const jar = parseCookieHeader('datadome=old')
    assert.equal(await fetchPage(jar, `${s.url}/start`, s.url), page)
    assert.deepEqual(Object.fromEntries(jar), { datadome: 'new', seen_br: '1' })
  } finally {
    s.close()
  }
})
