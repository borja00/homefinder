import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BlockedError, hasNextPage, pageUrl, parseSearchPage, pricePerM2 } from '../src/parser.js'

const HTML = readFileSync(new URL('./fixtures/search_page.html', import.meta.url), 'utf8')

test('parses cards', () => {
  const [a, b, ...rest] = parseSearchPage(HTML)
  assert.equal(rest.length, 0)
  assert.equal(a.id, '104512345')
  assert.equal(a.url, 'https://www.idealista.com/inmueble/104512345/')
  assert.equal(a.title, 'Piso en calle de Fuencarral, Trafalgar, Madrid')
  assert.equal(a.price, 420000)
  assert.deepEqual([a.rooms, a.size_m2], [3, 95])
  assert.equal(a.has_lift, true)
  assert.equal(a.has_parking, true)
  assert.equal(a.agency, 'Inmobiliaria Sol')
  assert.equal(a.thumbnail, 'https://img4.idealista.com/a.jpg')
  assert.equal(a.description, 'Luminoso piso reformado.')
  assert.equal(pricePerM2(a), 4421.1)
  assert.deepEqual([b.price, b.size_m2, b.has_lift], [389500, 70.5, false])
})

test('parses the card features the filters use', () => {
  const [a, b] = parseSearchPage(HTML)
  assert.equal(a.property_type, 'Piso')
  assert.equal(b.property_type, 'Ático')
  assert.deepEqual([a.parking, a.has_parking], ['included', true])
  assert.deepEqual([b.parking, b.has_parking], ['optional', true]) // "Garaje opc. 25.000 €"
  assert.equal(a.previous_price, 440000)
  assert.equal(b.previous_price, null)
  assert.deepEqual(a.tags, ['Lujo', 'Alquilada'])
  assert.deepEqual(b.tags, [])
  assert.deepEqual([a.has_plan, b.has_plan], [true, false])
  assert.deepEqual([a.professional, b.professional], [true, false])
})

test('pagination', () => {
  assert.ok(hasNextPage(HTML))
  const url = 'https://www.idealista.com/venta-viviendas/madrid/chamberi/?ordenado-por=fecha'
  assert.equal(pageUrl(url, 1), url)
  assert.equal(pageUrl(url, 3),
    'https://www.idealista.com/venta-viviendas/madrid/chamberi/pagina-3.htm?ordenado-por=fecha')
  assert.equal(pageUrl('https://www.idealista.com/x/pagina-2.htm', 4),
    'https://www.idealista.com/x/pagina-4.htm')
})

test('block page raises', () => {
  assert.throws(() => parseSearchPage('<script src="https://ct.captcha-delivery.com/c.js"></script>'),
    BlockedError)
})
