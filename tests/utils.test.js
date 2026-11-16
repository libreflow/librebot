const test = require('node:test')
const assert = require('node:assert')
const { Vec3 } = require('vec3')

const { versionAtLeast, isNight, findGroundBelow } = require('../src/utils')

test('versionAtLeast : comparaisons de versions', () => {
  assert.strictEqual(versionAtLeast('1.21.4', '1.21.2'), true)
  assert.strictEqual(versionAtLeast('1.21.2', '1.21.2'), true)
  assert.strictEqual(versionAtLeast('1.21.2', '1.21.3'), false)
  assert.strictEqual(versionAtLeast('1.20.6', '1.21'), false)
  assert.strictEqual(versionAtLeast('26.1', '1.21.2'), true)
  assert.strictEqual(versionAtLeast('26.1', '26.2'), false)
  assert.strictEqual(versionAtLeast(null, '1.21'), false)
})

test('isNight : bornes 13000–23000', () => {
  assert.strictEqual(isNight({ time: { timeOfDay: 13000 } }), true)
  assert.strictEqual(isNight({ time: { timeOfDay: 18000 } }), true)
  assert.strictEqual(isNight({ time: { timeOfDay: 23000 } }), true)
  assert.strictEqual(isNight({ time: { timeOfDay: 12999 } }), false)
  assert.strictEqual(isNight({ time: { timeOfDay: 5000 } }), false)
  assert.strictEqual(isNight({}), false)
})

test('findGroundBelow : trouve le sol et respecte maxDepth', () => {
  const bot = {
    entity: { position: new Vec3(10, 64, 10) },
    blockAt: (p) => p.y === 60 ? { boundingBox: 'solid', name: 'stone' } : { boundingBox: 'empty', name: 'air' }
  }
  assert.strictEqual(findGroundBelow(bot), 61)
  assert.strictEqual(findGroundBelow(bot, 2), 0) // trop profond pour maxDepth=2
  const vide = { entity: { position: new Vec3(0, 64, 0) }, blockAt: () => null }
  assert.strictEqual(findGroundBelow(vide), 0)
})
