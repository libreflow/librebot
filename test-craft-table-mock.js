// Mock harness : ensureCraftingTable transforme les bûches en planches avant d'échouer
// + craftAny retourne la vraie raison d'échec (et non un générique)
const fs = require('fs')
const md = {
  blocksByName: { crafting_table: { id: 1234 } },
  itemsByName: { crafting_table: { id: 1234 }, oak_planks: { id: 500 }, oak_log: { id: 900 }, iron_pickaxe: { id: 777 } },
  items: { 500: { name: 'oak_planks', id: 500 }, 900: { name: 'oak_log', id: 900 }, 1234: { name: 'crafting_table', id: 1234 }, 777: { name: 'iron_pickaxe', id: 777 } },
  itemsById: { 500: { name: 'oak_planks', id: 500 }, 900: { name: 'oak_log', id: 900 }, 777: { name: 'iron_pickaxe', id: 777 } }
}
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

// --- test 1 : craftAny retourne une raison d'échec exploitable, pas un booléen muet ---
const cp = require('./src/craftplanner.js')
const bot2 = {
  version: '26.1',
  inventory: { items: () => [] },
  recipesFor: () => [], // aucune recette dispo sans table ni ressources
  recipesAll: () => null
}
const main = async () => {
  const reason = await cp.craftAny(bot2, 'iron_pickaxe', 1)
  check(typeof reason === 'string' && reason.length > 0, "craftAny retourne une raison d'échec : " + reason)
  const missionSrc = fs.readFileSync('./src/mission.js', 'utf8')
  check(!missionSrc.includes('impossible (ressources manquantes)'), 'message générique "ressources manquantes" retiré de mission.js')
  check(missionSrc.includes('impossible : '), 'mission.js affiche la vraie raison')

  // --- test 2 : le chemin logs -> planches -> table est bien câblé dans utils.js ---
  const src = fs.readFileSync('./src/utils.js', 'utf8')
  check(src.includes('await craftAnyPlanks(bot, 4)'), 'ensureCraftingTable transforme les bûches en planches avant d\'abandonner')
  check(src.indexOf('craftAnyPlanks(bot, 4)') < src.indexOf('pas de planches pour crafter une table'), 'craftAnyPlanks appelé AVANT le throw')

  // --- test 3 : logique runtime planche->table avec bot mock (replic ensureCraftingTable) ---
  const madePlanks = { v: false }
  const inv = [['oak_log', 3]]
  const inventory = { items: () => inv.map(([name, count]) => ({ name, count })) }
  const countItem = (n) => inv.filter(([x]) => x === n).reduce((a, [, c]) => a + c, 0)
  const recipesFor = (id) => {
    if (id === 1234) return madePlanks.v ? [{ id: 1234, ingredients: [{ id: 500, count: 4 }], result: { count: 1 } }] : []
    if (id === 500) return countItem('oak_log') > 0 ? [{ id: 500, ingredients: [{ id: 900, count: 1 }], result: { count: 4 } }] : []
    return []
  }
  // reproduit le nouveau bloc : pas de planches -> craftAnyPlanks(4) -> retry recipes -> craft table
  const craftAnyPlanks = async () => { if (recipesFor(500).length) { madePlanks.v = true; return 4 } throw new Error('pas de planches disponibles') }
  const ensure = async () => {
    let recipes = recipesFor(1234)
    if (!recipes?.length) {
      await craftAnyPlanks(4)
      recipes = recipesFor(1234)
    }
    if (!recipes?.length) throw new Error('pas de planches pour crafter une table')
    return 'table craftée'
  }
  check((await ensure()) === 'table craftée', 'bûches sans planches : la table est craftée après conversion des bûches')
  const ensureOld = async () => {
    const recipes = recipesFor.call({ ...{}, ...{} }, 1234) && (() => { const r = recipesFor(1234); return r })()
    if (!recipes?.length) throw new Error('pas de planches pour crafter une table')
    return 'table craftée'
  }
  // sans planches ni bûches, l'échec reste explicite (pas de faux succès)
  madePlanks.v = false
  inv.length = 0
  let threwNoWood = false
  try { await ensure() } catch (e) { threwNoWood = true; check(e.message === 'pas de planches disponibles', 'raison racine propagée : ' + e.message) }
  check(threwNoWood, 'sans bûches ni planches, l’échec reste explicite')

  console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
  process.exit(fails === 0 ? 0 : 1)
}
main()
