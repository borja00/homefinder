import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseDetailPage } from '../src/detail.js'
import { BlockedError } from '../src/parser.js'

const HTML = readFileSync(new URL('./fixtures/detail_page.html', import.meta.url), 'utf8')

test('parses a listing page', () => {
  const d = parseDetailPage(HTML)
  assert.equal(d.gone, false)
  assert.equal(d.title, 'Piso en venta en calle de Fuencarral')
  assert.equal(d.location, 'Trafalgar, Madrid')
  assert.deepEqual(d.address, ['Calle de Fuencarral', 'Barrio Trafalgar'])
  assert.equal(d.price, 420000)
  assert.deepEqual(d.info, ['95 m²', '3 hab.', 'Planta 4ª exterior con ascensor'])
  assert.equal(d.description, 'Luminoso piso reformado en el corazón de Trafalgar.\n\nCocina equipada y dos baños completos.')
  assert.deepEqual(d.features.map((g) => g.title), ['Características básicas', 'Edificio', 'Equipamiento', 'Certificado energético'])
  assert.deepEqual(d.features[2].items, ['Aire acondicionado', 'Terraza'])
  assert.deepEqual(d.facts, {
    bathrooms: 2, built_m2: 95, usable_m2: 82, condition: 'Segunda mano/buen estado', year_built: 1965, energy: 'E',
  })
  assert.deepEqual(d.advertiser, { name: 'Inmobiliaria Sol', private: false })
  assert.equal(d.updated, 'Anuncio actualizado el 3 de noviembre')
})

test('collects every photo once, jpg preferred, including ones only in scripts', () => {
  const ids = parseDetailPage(HTML).images.map((u) => u.match(/(\d+)\.(\w+)$/).slice(1).join('.'))
  assert.deepEqual(ids, ['111.jpg', '222.jpg', '333.jpg'])
})

test('taken-down and blocked pages', () => {
  assert.equal(parseDetailPage('<html><body><p>Este anuncio ya no está publicado</p></body></html>').gone, true)
  assert.throws(() => parseDetailPage('<script src="https://ct.captcha-delivery.com/c.js"></script>'), BlockedError)
  const empty = parseDetailPage('<html><body></body></html>')
  assert.deepEqual([empty.title, empty.description, empty.features, empty.images], [null, null, [], []])
})
