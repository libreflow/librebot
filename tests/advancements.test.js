const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

process.env.LIBREBOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'librebot-adv-'))
const { CATALOG, byKey } = require('../src/advancements')

const STATUTS_VALIDES = new Set(['dragon', 'auto', 'partial', 'manual'])

test('catalogue : clés uniques, statuts valides, onglets renseignés', () => {
  const keys = CATALOG.map(([key]) => key)
  assert.strictEqual(new Set(keys).size, keys.length, 'clés dupliquées dans CATALOG')
  for (const [key, name, tab, status] of CATALOG) {
    assert.ok(name && name.length > 0, `nom manquant pour ${key}`)
    assert.ok(tab && tab.length > 0, `onglet manquant pour ${key}`)
    assert.ok(STATUTS_VALIDES.has(status), `statut invalide "${status}" pour ${key}`)
    assert.strictEqual(byKey[key].name, name)
  }
})

test('catalogue : couvre bien les succès (>= 100 entrées)', () => {
  assert.ok(CATALOG.length >= 100, `seulement ${CATALOG.length} entrées`)
})
