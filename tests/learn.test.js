const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Vec3 } = require('vec3')

process.env.LIBREBOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'librebot-learn-'))
const learn = require('../src/learn')

const fakeBot = (over = {}) => ({
  entity: { position: new Vec3(0, 64, 0) },
  entities: {},
  health: 20,
  time: { timeOfDay: 1000 },
  blockAt: () => null,
  inventory: { items: () => [] },
  ...over
})

test('phaseStrategy : 5 essais par défaut, 8 après 3 échecs', () => {
  assert.deepStrictEqual(learn.phaseStrategy('phase_test'), { attempts: 5, timeoutScale: 1 })
  learn.recordPhaseFailure('phase_test', 'err1')
  assert.strictEqual(learn.phaseStrategy('phase_test').attempts, 6)
  learn.recordPhaseFailure('phase_test', 'err2')
  learn.recordPhaseFailure('phase_test', 'err3')
  assert.strictEqual(learn.phaseStrategy('phase_test').attempts, 8)
})

test('phaseReliability : ratio ok/(ok+fail)', () => {
  learn.recordPhaseSuccess('phase_rel', 1000)
  assert.strictEqual(learn.phaseReliability('phase_rel'), 1)
  learn.recordPhaseFailure('phase_rel', 'err')
  assert.strictEqual(learn.phaseReliability('phase_rel'), 0.5)
  assert.strictEqual(learn.phaseReliability('inconnue'), null)
})

test('getFleeThreshold : augmente si mort en combat avec beaucoup de vie', () => {
  const base = learn.getFleeThreshold()
  assert.strictEqual(base, 8)
  learn.recordDeath('combat:zombie', fakeBot({ health: 10 }))
  assert.strictEqual(learn.getFleeThreshold(), 12) // min(14, 10+2)
  learn.recordDeath('chute', fakeBot({ health: 20 })) // non-combat : ignoré
  assert.strictEqual(learn.getFleeThreshold(), 12)
})

test('adjustTargets : déduit l\'inventaire, et repart des cibles de base après une mort', () => {
  const cfg = { targets: { rawIron: 48, diamonds: 32, obsidian: 14, blazeRods: 12, enderPearls: 24, enderEyes: 24 } }
  const botAvecFer = fakeBot({ inventory: { items: () => [{ name: 'raw_iron', count: 20 }] } })
  learn.adjustTargets(cfg, botAvecFer)
  assert.strictEqual(cfg.targets.rawIron, 28)
  assert.strictEqual(cfg.targets.diamonds, 32)

  // simule l'ancien bug : cibles mises à 0 quand tout était farmé, puis mort (inventaire vide)
  cfg.targets = { rawIron: 0, diamonds: 0, obsidian: 0, blazeRods: 0, enderPearls: 0, enderEyes: 0 }
  learn.adjustTargets(cfg, fakeBot())
  assert.strictEqual(cfg.targets.rawIron, 48) // recrédité depuis baseTargets
  assert.strictEqual(cfg.targets.obsidian, 14)
})

test('detectDeathCause : hostile proche, chute, inconnue', () => {
  const avecZombie = fakeBot({ entities: { 1: { name: 'zombie', position: new Vec3(2, 64, 0) } } })
  assert.strictEqual(learn.detectDeathCause(avecZombie), 'combat:zombie')
  // rien autour, sol à + de 6 blocs de vide en dessous -> chute
  assert.strictEqual(learn.detectDeathCause(fakeBot()), 'chute')
  assert.strictEqual(learn.detectDeathCause(null), 'inconnue')
})
