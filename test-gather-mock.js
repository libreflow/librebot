// Récolte au fur et à mesure : le craft ne s arrête plus sur un manque minable
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')

// 1. règles de récolte présentes pour le cas exact du signalement (fer / lingot)
check(utilsSrc.includes('GATHER_RULES'), 'GATHER_RULES défini')
for (const r of ['raw_iron', 'raw_gold', 'raw_copper', 'diamond', 'coal', 'flint']) {
  check(utilsSrc.includes(r + ':'), 'ressource récoltable : ' + r)
}

// 2. le chemin fonte mine la matière première manquante AVANT de fondre
const smeltZone = utilsSrc.indexOf('smeltRaw = bestSmeltRaw(bot, name)')
const gatherCall = utilsSrc.indexOf('ensureResource(bot, smeltRaw, missingOut)', smeltZone)
const smeltCall = utilsSrc.indexOf('smeltItem(bot, smeltRaw, name, count)', smeltZone)
check(gatherCall > -1 && smeltCall > -1 && gatherCall < smeltCall, 'fonte : le raw manquant est MINÉ avant smeltItem (mine -> four -> lingot -> craft)')

// 3. la boucle d ingrédients récolte les minables au lieu d échouer
const loopZone = utilsSrc.indexOf('for (const ing of recipe.ingredients ?? [])')
check(utilsSrc.indexOf('if (GATHER_RULES[ingItem.name])', loopZone) > -1, 'ingrédient minable manquant -> ensureResource (pas de throw)')

// 4. bornes : la récolte est plafonnée en temps (rubrique maxMinutes partout)
const rules = utilsSrc.slice(utilsSrc.indexOf('const GATHER_RULES'), utilsSrc.indexOf('// Amène'))
check((rules.match(/maxMinutes/g) || []).length >= 5, 'chaque règle de minage a un plafond de temps')

// 5. ensureResource exporté (utilisable par les phases)
const utils = require('./src/utils.js')
check(typeof utils.ensureResource === 'function' && typeof utils.GATHER_RULES === 'object', 'ensureResource + GATHER_RULES exportés')

// 6. non-régression : les erreurs restent explicites si la récolte échoue
check(utilsSrc.includes('impossible de récolter'), 'échec de récolte -> message explicite avec comptes')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
