// Mock harness : le bot connaît TOUS les crafts (établi + four) et ne les utilise qu'à la demande
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const cp = require('./src/craftplanner.js')
const utils = require('./src/utils.js')

const bot = (inv) => ({
  version: '26.1',
  inventory: { items: () => inv.map(([name, count]) => ({ name, count })) },
  recipesFor: (id) => md.recipes[id] ?? [],
  recipesAll: (id) => md.recipes[id] ?? []
})

// 1. FONT/CUISINE : cooked_beef planifié comme étape de four depuis du beef
let p = cp.plan(bot([['beef', 1]]), 'cooked_beef', 1)
check(p.gather.length === 0 && p.crafts.some((c) => c.smelt && c.raw === 'beef' && c.item === 'cooked_beef'),
  'cooked_beef : étape de fonte/cuisine prévue (raw=beef) — avant : « ressources manquantes »')

// 2. verre : choisit la matière la plus disponible (sable rouge > sable ici)
p = cp.plan(bot([['sand', 1], ['red_sand', 7]]), 'glass', 1)
const gl = p.crafts.find((c) => c.item === 'glass')
check(gl && gl.smelt && gl.raw === 'red_sand', 'glass : la matière la plus présente est choisie (red_sand)')

// 3. ancient_debris → netherite_scrap (le chain netherite est débloqué)
p = cp.plan(bot([['ancient_debris', 1]]), 'netherite_scrap', 1)
check(p.crafts.some((c) => c.item === 'netherite_scrap' && c.smelt), 'netherite_scrap planifiable via le four')

// 4. ancien faux interdit : golden_apple (8 lingots d'or + pomme)
p = cp.plan(bot([['gold_ingot', 8], ['apple', 1]]), 'golden_apple', 1)
check(p.gather.length === 0 && p.crafts.some((c) => c.item === 'golden_apple'),
  'golden_apple : plus bloqué (recette réelle) — ' + (p.crafts.length ? 'plan ok' : JSON.stringify(p.gather)))

// 5. blaze_powder depuis un rod (recette réelle, avant : « à récolter »)
p = cp.plan(bot([['blaze_rod', 1]]), 'blaze_powder', 2)
check(p.crafts.some((c) => c.item === 'blaze_powder'), 'blaze_powder planifiable depuis un bâton de blaze')

// 6. leather depuis 4 peaux de lapin
p = cp.plan(bot([['rabbit_hide', 4]]), 'leather', 1)
check(p.crafts.some((c) => c.item === 'leather'), 'leather planifiable (4 peaux de lapin)')

// 7. vrai non-craftable conservé : ender_pearl → récolte, pas de faux plan
p = cp.plan(bot([]), 'ender_pearl', 1)
check(p.gather.length > 0 && !p.crafts.length, 'ender_pearl reste « à récolter » (pas de recette)')

// 8. pas de régression : planches depuis un log
p = cp.plan(bot([['oak_log', 1]]), 'oak_planks', 4)
check(p.crafts.length > 0 && p.gather.length === 0, 'oak_planks : plan classique toujours OK')

// 9. SMELT_MAP exposée et complète (ingots de base + verre + nourriture cuite)
const keys = Object.keys(utils.SMELT_MAP)
check(keys.includes('iron_ingot') && keys.includes('gold_ingot') && keys.includes('glass') && keys.includes('cooked_chicken'),
  'SMELT_MAP couvre lingots, verre et nourriture cuite (' + keys.length + ' sorties de four)')
check(utils.bestSmeltRaw(bot([['sand', 2], ['red_sand', 9]]), 'glass') === 'red_sand', 'bestSmeltRaw : max inventaire')

// 10. à la demande uniquement : aucun craft ne s'exécute sans appel explicite (plan() est pur)
const invBefore = [['beef', 1]]
const b2 = bot(invBefore)
cp.plan(b2, 'cooked_beef', 1)
check(b2.inventory.items().length === 1 && b2.inventory.items()[0].name === 'beef', 'plan() est pur : rien n\'est consommé sans exécution explicite')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
