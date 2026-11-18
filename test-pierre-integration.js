// Simulation intégration : chaîne craftItem de la phase Pierre avec l'inventaire EXACT du log
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const mdReal = require('minecraft-data')
const md = mdReal('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const { Vec3 } = require('vec3')

// Inventaire du log du 21:52 (kit netherite du joueur)
const inventory = [
  ['netherite_sword', 1], ['wooden_axe', 1], ['stone_axe', 1], ['netherite_pickaxe', 1],
  ['dirt', 54], ['dark_oak_planks', 46], ['dark_oak_log', 14], ['wooden_pickaxe', 1],
  ['cobblestone', 48], ['netherite_shovel', 1]
]

// monde mock : sol solide partout sauf l'air au-dessus, une table déjà posée éventuellement
const world = {}
const air = { name: 'air', boundingBox: 'empty', hardness: 0 }
const mkBlock = (p, n, bb) => ({ ...{ name: n, boundingBox: bb, hardness: 1 }, position: p.clone() })

const bot = {
  version: '26.1',
  entity: { position: new Vec3(107.5, 63, -54.5), eyePosition: new Vec3(107.5, 64.62, -54.5) },
  inventory: {
    items: () => inventory.filter(([, c]) => c > 0).map(([name, count]) => ({ name, count, type: md.itemsByName[name]?.id ?? 0 }))
  },
  game: { dimension: 'overworld' },
  blockAt: (v) => {
    const p = v.floored ? v.floored() : new Vec3(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z))
    if (p.y <= 62) return mkBlock(p, 'dirt', 'block') // sol plein jusqu'à y=62, le bot est debout à y=63
    if (world[`${p.x},${p.y},${p.z}`]) return mkBlock(p, world[`${p.x},${p.y},${p.z}`], 'block')
    return mkBlock(p, 'air', 'empty')
  },
  findBlock: ({ matching }) => {
    const tableId = md.blocksByName.crafting_table?.id
    if (matching !== tableId) return null
    for (const k of Object.keys(world)) {
      if (world[k] === 'crafting_table') { const [x, y, z] = k.split(',').map(Number); return bot.blockAt(new Vec3(x, y, z)) }
    }
    return null
  },
  findBlocks: ({ matching }) => {
    const found = bot.findBlock({ matching })
    return found ? [found.position] : []
  },
  // mineflayer recipes : VRAIES recettes 26.1 au FORMAT PRISMARINE-RECIPE
  // (.ingredients normalisé — comme le vrai bot.recipesFor en production)
  _normalize: (r) => {
    const need = new Map()
    const add = (idv, c) => need.set(idv, (need.get(idv) ?? 0) + c)
    if (r.inShape) for (const row of r.inShape) for (const i of (row ?? [])) if (i != null) add(i, 1)
    if (r.inShapeless) for (const i of r.inShapeless) add(i, 1)
    return { ingredients: [...need.entries()].map(([idv, count]) => ({ id: idv, count })), result: r.result, requiresTable: !!r.requiresTable }
  },
  recipesFor: (id, _meta, minCount, table) => {
    const recipes = (md.recipes[id] ?? []).filter((r) => !r.requiresTable || !!table).map(bot._normalize)
    return recipes.filter((r) => {
      const crafts = Math.ceil((minCount ?? 1) / (r.result?.count ?? 1))
      const need = new Map()
      const add = (itemId, c) => need.set(itemId, (need.get(itemId) ?? 0) + c)
      if (r.inShape) for (const row of r.inShape) for (const i of (row ?? [])) if (i != null) add(i, 1)
      if (r.inShapeless) for (const i of r.inShapeless) add(i, 1)
      if (r.ingredients) for (const ing of r.ingredients) add(ing.id, ing.count ?? 1)
      for (const [itemId, c] of need) {
        const need2 = c * crafts
        const have = inventory.filter(([n]) => md.itemsByName[n]?.id === itemId).reduce((a, [, c2]) => a + c2, 0)
        if (have < need2) return false
      }
      return true
    })
  },
  recipesAll: (id, _meta, table) => (md.recipes[id] ?? []).filter((r) => !r.requiresTable || !!table).map(bot._normalize),
  craft: async (recipe, crafts) => {
    // mini-simulation mineflayer : décompte réel, throw 'missing ingredient' si manque
    const add = (m, idv, c) => m.set(idv, (m.get(idv) ?? 0) + c)
    const need = new Map()
    for (const ing of recipe.ingredients ?? []) add(need, ing.id, ing.count ?? 1)
    for (const [idv, c] of need) {
      const total = c * crafts
      const have = inventory.filter(([n]) => md.itemsByName[n]?.id === idv).reduce((a, [, c2]) => a + c2, 0)
      if (have < total) throw new Error(`missing ingredient (${md.items[idv]?.name ?? idv} : ${have}/${total})`)
    }
    for (const [idv, c] of need) { const total = c * crafts; const row = inventory.find(([n]) => md.itemsByName[n]?.id === idv); row[1] -= total }
    const out = md.items[recipe.result.id]?.name ?? String(recipe.result.id)
    const existing = inventory.find(([n]) => n === out)
    if (existing) existing[1] += recipe.result.count * crafts
    else inventory.push([out, recipe.result.count * crafts])
  },
  equip: async () => {},
  placeBlock: async (ref, face) => {
    const t = ref.position.plus(face)
    world[`${t.x},${t.y},${t.z}`] = 'crafting_table'
  },
  dig: async (b) => { world[`${b.position.x},${b.position.y},${b.position.z}`] = 'air' },
  lookAt: async () => {},
  look: async () => {},
  pathfinder: { setMovements: () => {}, setGoal: () => {}, goto: () => Promise.resolve(), stop: () => {} },
  clearControlStates: () => {},
  setControlState: () => {},
  _librebotTablePos: null,
  _librebotMovementsByDim: null,
  _librebotMovements: null
}

const utils = require('./src/utils.js')

const main = async () => {
  // phase pierre (rush) : la chaîne exacte du code corrigé
  const haveStone = utils.countItem(bot, 'cobblestone') + utils.countItem(bot, 'stone')
  check(haveStone >= (12), 'skip du minage (déjà 48+ cobble — inventaire du log)')

  // repli bois : planches dispo → pas de coupe
  const PLANKS = ['oak_planks', 'dark_oak_planks']
  const anyCount = (l) => l.reduce((a, n) => a + utils.countItem(bot, n), 0)
  check(anyCount(PLANKS) > 0, 'planches dark oak présentes → pas de coupe express nécessaire')

  try {
    if (utils.countItem(bot, 'stick') < 2) await utils.craftItem(bot, 'stick', 2)
    check(utils.countItem(bot, 'stick') >= 2, 'bâtons craftés depuis les planches dark oak (' + utils.countItem(bot, 'stick') + ')')
    await utils.craftItem(bot, 'stone_pickaxe', 1)
    check(utils.countItem(bot, 'stone_pickaxe') >= 1, 'pioche en pierre craftée (' + utils.countItem(bot, 'stone_pickaxe') + ')')
    await utils.craftItem(bot, 'furnace', 1)
    check(utils.countItem(bot, 'furnace') >= 1, 'fourneau crafté (' + utils.countItem(bot, 'furnace') + ')')
  } catch (e) {
    check(false, 'chaîne pierre : ' + e.message)
  }

  console.log(fails === 0 ? '\nTOUS LES TESTS OK — la chaîne passe avec l\'inventaire exact du log' : '\n' + fails + ' ÉCHECS')
  console.log('\ninventaire final : ' + inventory.filter(([, c]) => c > 0).map(([n, c]) => n + 'x' + c).join(', '))
  process.exit(fails === 0 ? 0 : 1)
}
main()
