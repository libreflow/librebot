const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Vec3 } = require('vec3')

process.env.LIBREBOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'librebot-build-'))
const { pickMaterial, housePlan, farmLayout, wallPlan, bridgePlan } = require('../src/build')

test('pickMaterial : premier matériau présent en quantité suffisante', () => {
  assert.strictEqual(pickMaterial({ oak_planks: 40 }, ['oak_planks', 'cobblestone'], 16), 'oak_planks')
  assert.strictEqual(pickMaterial({ cobblestone: 100 }, ['oak_planks', 'cobblestone'], 16), 'cobblestone')
  assert.strictEqual(pickMaterial({ dirt: 50 }, ['oak_planks', 'cobblestone'], 16), null)
  assert.strictEqual(pickMaterial({}, ['oak_planks'], 1), null)
})

test('housePlan 5×5 : murs, porte, fenêtres, toit, équipement intérieur', () => {
  const anchor = new Vec3(10, 64, 10)
  const plan = housePlan(anchor, { size: 5, height: 3, wallBlock: 'oak_planks', roofBlock: 'cobblestone', roof: 'pyramid' })
  const byBlock = {}
  for (const e of plan.entries) byBlock[e.block] = (byBlock[e.block] ?? 0) + 1
  assert.strictEqual(byBlock.oak_planks, 42) // périmètre 16 × 3 niveaux = 48, moins porte (2) et fenêtres (4)
  assert.strictEqual(byBlock.glass, 4)
  assert.strictEqual(byBlock.cobblestone, 49) // toit 7×7
  assert.strictEqual(byBlock.chest, 1)
  assert.strictEqual(byBlock.crafting_table, 1)
  assert.strictEqual(byBlock.furnace, 1)
  assert.strictEqual(byBlock.torch, 3)
  assert.deepStrictEqual(plan.door.map((p) => [p.x, p.y, p.z]), [[12, 64, 14], [12, 65, 14]]) // porte sud, au milieu
  for (const e of plan.entries) {
    if (e.block === 'oak_planks' || e.block === 'glass') {
      assert.ok(e.pos.x >= 10 && e.pos.x <= 14 && e.pos.z >= 10 && e.pos.z <= 14, 'mur hors limites')
      assert.ok(e.pos.y >= 64 && e.pos.y <= 66, 'mur hors hauteur')
    }
  }
})

test('housePlan : toit plat (une hauteur) vs pyramide (plusieurs hauteurs)', () => {
  const anchor = new Vec3(0, 64, 0)
  const flat = housePlan(anchor, { size: 5, roof: 'flat', roofBlock: 'cobblestone' })
  const flatYs = new Set(flat.entries.filter((e) => e.block === 'cobblestone').map((e) => e.pos.y))
  assert.deepStrictEqual([...flatYs], [67])
  const pyr = housePlan(anchor, { size: 5, roof: 'pyramid', roofBlock: 'cobblestone' })
  const pyrYs = new Set(pyr.entries.filter((e) => e.block === 'cobblestone').map((e) => e.pos.y))
  assert.ok(pyrYs.size > 1)
  assert.ok(Math.max(...pyrYs) > 67)
})

test('farmLayout 9×9 : croix d\'eau, terre labourée, clôture, torches', () => {
  const layout = farmLayout(new Vec3(0, 64, 0), { w: 9, d: 9 })
  assert.strictEqual(layout.water.length, 17) // croix : 9 + 9 - 1
  assert.strictEqual(layout.farmland.length, 64) // 81 - 17
  assert.strictEqual(layout.fence.length, 32) // périmètre 9×9
  assert.strictEqual(layout.torches.length, 4)
  assert.strictEqual(layout.waterSources.length, 4)
  assert.ok(layout.water.every((p) => p.y === 63)) // fossés au niveau du sol
  assert.ok(layout.fence.every((p) => p.y === 64)) // clôture au niveau du sol
})

test('wallPlan 5×5 h=3 : périmètre complet, torches en haut', () => {
  const plan = wallPlan(new Vec3(0, 64, 0), { w: 5, d: 5, h: 3, block: 'cobblestone' })
  assert.strictEqual(plan.entries.length, 16 * 3)
  assert.ok(plan.entries.every((e) => e.pos.y >= 64 && e.pos.y <= 66))
  assert.ok(plan.torches.length > 0)
  assert.ok(plan.torches.every((t) => t.y === 67))
})

test('bridgePlan : pont aligné selon le yaw, posé sous les pieds', () => {
  const entries = bridgePlan(new Vec3(0, 64, 0), 0, 10, 'cobblestone') // yaw 0 = -Z
  assert.strictEqual(entries.length, 8) // i = 2..9
  assert.ok(entries.every((e) => e.pos.x === 0 && e.pos.y === 63 && e.pos.z < 0 && e.block === 'cobblestone'))
})
