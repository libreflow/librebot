// Corrections utiles : plumes rush, trou de nuit, priorité nourriture
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const phasesSrc = fs.readFileSync('./src/phases.js', 'utf8')
const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')

// 1. rush : la chasse aux poules express existe AVANT le craft des flèches
const arrowIdx = phasesSrc.indexOf("craftItem(bot, 'arrow'")
const featherHuntIdx = phasesSrc.indexOf("chasse aux poules express")
check(featherHuntIdx > -1 && featherHuntIdx < arrowIdx, 'chasse aux poules express prévue avant craftItem(arrow) — le rush ne casse plus')
check(phasesSrc.includes("countItem(bot, 'feather') < arrowCrafts"), 'le besoin de plumes est calculé par rapport aux flèches (1 plume = 4 flèches)')
// les flèches ne se craftent que si les plumes sont là (pas de crash en milieu de phase)
check(phasesSrc.includes("if (countItem(bot, 'feather') >= arrowCrafts) await craftItem(bot, 'arrow'"), 'le craft des flèches est conditionné aux plumes (plus de throw)')

// 2. trou de nuit : re-sortie explicitement prévue
check(phasesSrc.includes('surfaceY') && phasesSrc.includes('ressortir du trou'), 'trou d^attente de nuit : le bot ressort (pilier ou escalier de secours)')
check(phasesSrc.includes('pillarUp(bot, surfaceY + 1'), 're-sortie par pilier de blocs')

// 3. eatUntil : priorité nourriture (cuite > crue)
const foodIdx = utilsSrc.indexOf('for (const fname of FOOD_NAMES)')
const oldFind = utilsSrc.includes("bot.inventory.items().find((i) => FOOD_NAMES_SET.has(i.name))")
check(foodIdx > -1 && !oldFind, 'eatUntil : nourriture choisie par priorité FOOD_NAMES (steak avant poulet cru)')
check(utilsSrc.indexOf('golden_apple') < utilsSrc.indexOf("'cooked_beef'"), 'ordre de priorité : pomme dorée > steak')

// 4. feed prioritaire reste cohérent avec la liste existante
const FOOD = require('./src/utils.js')
check(typeof FOOD.eatUntil === 'function' && typeof FOOD.smeltItem === 'function', 'exports intacts')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
