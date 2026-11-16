const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

process.env.LIBREBOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'librebot-storage-'))
const storage = require('../src/storage')

test('saveJson/loadJson : aller-retour', () => {
  storage.saveJson('test.json', { hello: 'world', n: 42 })
  assert.deepStrictEqual(storage.loadJson('test.json', null), { hello: 'world', n: 42 })
})

test('loadJson : fallback si le fichier est absent ou corrompu', () => {
  assert.deepStrictEqual(storage.loadJson('absent.json', { a: 1 }), { a: 1 })
  fs.writeFileSync(path.join(process.env.LIBREBOT_DATA_DIR, 'corrompu.json'), '{ pas du json')
  assert.deepStrictEqual(storage.loadJson('corrompu.json', 'fallback'), 'fallback')
})

test('saveJson : écriture atomique (pas de .tmp restant)', () => {
  storage.saveJson('atomique.json', { ok: true })
  assert.strictEqual(fs.existsSync(path.join(process.env.LIBREBOT_DATA_DIR, 'atomique.json.tmp')), false)
  assert.deepStrictEqual(storage.loadJson('atomique.json', null), { ok: true })
})

test('loadProgress/saveProgress : aller-retour sur progress.json', () => {
  assert.deepStrictEqual(storage.loadProgress(), {})
  storage.saveProgress({ done: ['bois'], home: [1, 64, 2] })
  assert.deepStrictEqual(storage.loadProgress(), { done: ['bois'], home: [1, 64, 2] })
})
