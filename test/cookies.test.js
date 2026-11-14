import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySetCookies, extractCookieHeader, parseCookieHeader, toCookieHeader } from '../src/cookies.js'

test('extracts the cookie from what people paste', () => {
  assert.equal(extractCookieHeader('a=1; b=2'), 'a=1; b=2')
  assert.equal(extractCookieHeader('Cookie: a=1; b=2\n'), 'Cookie: a=1; b=2')
  assert.equal(extractCookieHeader('Host: www.idealista.com\nUser-Agent: x\nCookie: a=1; b=2\nTE: trailers'),
    'Cookie: a=1; b=2')
  assert.equal(extractCookieHeader(
    "curl 'https://www.idealista.com/' -H 'User-Agent: x' -H 'Cookie: a=1; b=2' -H 'TE: trailers'"), 'a=1; b=2')
  assert.equal(extractCookieHeader("curl 'https://www.idealista.com/' \\\n  -b 'a=1; b=2' \\\n  -H 'accept: */*'"),
    'a=1; b=2')
})

test('cookie header with JSON values', () => {
  const jar = parseCookieHeader(
    'Cookie: datadome=abc~1; g_state={"i_l":1}; contact1="{\\\'max\\\':10}"; lang=es\n')
  assert.equal(jar.get('datadome'), 'abc~1')
  assert.equal(jar.get('g_state'), '{"i_l":1}')
  assert.equal(jar.get('lang'), 'es')
  assert.deepEqual(parseCookieHeader(toCookieHeader(jar)), jar)
})

test('server-refreshed cookies replace pasted ones; expired ones are dropped', () => {
  const jar = parseCookieHeader('datadome=old; lang=es; tmp=1')
  applySetCookies(jar, [
    'datadome=new; Max-Age=31536000; Domain=.idealista.com; Path=/; Secure; SameSite=Lax',
    'tmp=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/',
  ])
  assert.deepEqual(Object.fromEntries(jar), { datadome: 'new', lang: 'es' })
})
