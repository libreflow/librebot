// Mock harness : placeBlockFromInventory pose la table même sous une canopée
// (repro du bug prod : dark_forest, « aucun emplacement pour poser crafting_table »)
const { Vec3 } = require('vec3')
const fs = require('fs')
const LEARN_PATH = require('path').join(__dirname, 'learning.json')
if (!fs.existsSync(LEARN_PATH)) fs.writeFileSync(LEARN_PATH, '{}')
const md = { blocksByName: { crafting_table: { id: 1234 } }, itemsByName: {}, items: [], itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const buildBot = (world) => {
  const air = { name: 'air', boundingBox: 'empty', hardness: 0, position: null }
  const blockAt = (v) => {
    const p = v.floored ? v.floored() : v
    const b = world[`${p.x},${p.y},${p.z}`] ?? air
    return { ...b, position: new Vec3(p.x, p.y, p.z) }
  }
  const placed = []
  const dug = []
  const bot = {
    version: '26.1',
    entity: { position: new Vec3(0.5, 70, 0.5), eyePosition: new Vec3(0.5, 71.62, 0.5) },
    inventory: { items: () => [{ name: 'crafting_table', count: 1 }] },
    blockAt,
    dig: async (b) => { dug.push(b.name); world[`${b.position.x},${b.position.y},${b.position.z}`] = { name: 'air', boundingBox: 'empty', hardness: 0 } },
    equip: async () => {},
    placeBlock: async (ground, face) => { placed.push(ground.position.clone().plus(face)) },
    pathfinder: { setGoal: () => {}, goto: () => Promise.resolve(), stop: () => {} },
    _librebotTablePos: null
  }
  return { bot, placed, dug, world }
}
const leaf = { name: 'oak_leaves', boundingBox: 'block', hardness: 0.2 }
const dirt = { name: 'dirt', boundingBox: 'block', hardness: 0.5 }

const main = async () => {
  const utils = require('./src/utils.js')

  // Scénario canopée : sol solide à (1,69,0) mais feuilles à y=70 et y=71
  const world = { '1,69,0': dirt, '1,70,0': leaf, '1,71,0': leaf }
  const { bot, placed, dug } = buildBot(world)
  const res = await utils.placeBlockFromInventory(bot, 'crafting_table')
  check(placed.length === 1 && placed[0].x === 1 && placed[0].y === 70, 'table posée sur le sol dégagé à (1,70,0)')
  check(dug.includes('oak_leaves'), 'les feuilles au-dessus du sol ont été minées avant la pose (passe 2)')

  // Scénario ouvert : pose directe sans digging (passe 1 conservée)
  const world2 = { '1,69,0': dirt }
  const { bot: b2, placed: p2, dug: d2 } = buildBot(world2)
  await utils.placeBlockFromInventory(b2, 'crafting_table')
  check(p2.length === 1 && d2.length === 0, 'terrain dégagé : pose directe en passe 1, aucun minage')

  // Scénario infranchissable : sol entouré de pierre, pas d'air/soft
  const world3 = { '1,70,0': { name: 'stone', boundingBox: 'block', hardness: 1.5 } }
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    world3[`${dx},70,${dz}`] ??= { name: 'stone', boundingBox: 'block', hardness: 1.5 }
    world3[`${dx},71,${dz}`] ??= { name: 'stone', boundingBox: 'block', hardness: 1.5 }
  }
  world3['1,69,0'] = dirt
  const { bot: b3 } = buildBot(world3)
  let threw = false
  try { await utils.placeBlockFromInventory(b3, 'crafting_table') } catch (e) { threw = e.message.includes('aucun emplacement') }
  check(threw, 'mur de pierre autour : échec explicite conservé (pas de pose à travers)')

  // Scénario cave luxuriante : aucun emplacement idéal (sol hors de portée/LOS bloquée),
  // mais du sol solide sous les pieds → passe 3 : sauter et poser sous soi
  const world4 = { '0,69,0': dirt }
  const placed4 = []
  const b4 = Object.assign(buildBot(world4).bot, {
    setControlState: (st, on) => { b4._states = b4._states || {}; b4._states[st] = on },
    placeBlock: async (ground, face) => {
      const at = ground.position.clone().plus(face)
      placed4.push(at)
      world4[`${at.x},${at.y},${at.z}`] = { name: 'crafting_table', boundingBox: 'block', hardness: 2.5 }
    }
  })
  const res4 = await utils.placeBlockFromInventory(b4, 'crafting_table')
  check(placed4.length === 1 && placed4[0].x === 0 && placed4[0].y === 70, 'cave luxuriante : table pos\u00e9e sous les pieds (passe 3, saut + pose)')
  check(res4 && res4.name === 'crafting_table', 'la table est retourn\u00e9e comme bloc pos\u00e9')
  check(b4._states && b4._states.jump === false, 'le bouton saut est rel\u00e2ch\u00e9 apr\u00e8s la pose')

  // 5. une table/le four TROUVÉ mais injoignable (mur de manoir, falaise) ne doit
  // plus être utilisée ni bloquer la phase — le bot en pose un lui-même
  const u = fs.readFileSync('./src/utils.js', 'utf8')
  check(u.includes("const reachable = (b) => b && b.name === 'crafting_table'") && u.includes("const reachable = (b) => b && b.name === 'furnace'"), 'garde de portée sur la table ET le four (injoignable = inutilisable)')
  check(u.includes('en pose une autre ici') && u.includes('en pose un ici plut'), 'table/four injoignables : le bot en pose un autre au lieu de bloquer')

  console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
  process.exit(fails === 0 ? 0 : 1)
}
main()
