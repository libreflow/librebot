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

// 7. couverture complète de la route (re-audit) : bûches + arc + combustible
const G = utils.GATHER_RULES
check(G.oak_log && G.oak_log.wood === true, 'bûches récoltables automatiquement (arbres proches)')
check(G.birch_log && G.dark_oak_log, 'toutes les essences couvertes (birch, dark_oak…)')
const junkSrc = fs.readFileSync('./src/utils.js', 'utf8')
const junkLine = junkSrc.slice(junkSrc.indexOf('const junkNames'))
check(!junkLine.slice(0, 200).includes("'string'"), 'string retiré des junks (nécessaire pour l arc)')
const phasesSrc2 = fs.readFileSync('./src/phases.js', 'utf8')
check(phasesSrc2.includes("craftItem(bot, 'bow', 1)"), "l arc est maintenant craft par phaseIron (jamais craft avant !)")
check(phasesSrc2.indexOf("huntMob(bot, ['spider']") > -1, 'mini-chasse aux araignées pour les ficelles')
check(utilsSrc.includes('ensureResource(bot, \'coal\''), 'smeltItem : combustible manquant -> charbon auto-récolté')


// 8. ponts & précautions vide/lave
check(utils.countBridgeBlocks && utils.ensureBridgeBlocks, 'countBridgeBlocks + ensureBridgeBlocks exportés')
check(G.netherrack && G.end_stone, 'netherrack et end_stone récoltables (ponts sur place)')
const phasesSrc3 = fs.readFileSync('./src/phases.js', 'utf8')
const fortressZone = phasesSrc3.slice(phasesSrc3.indexOf('async function phaseFortress'), phasesSrc3.indexOf('async function phaseBlaze'))
check(fortressZone.includes('ensureBridgeBlocks(bot, 32)'), 'forteresse : réserve de ponts garantie AVANT exploration (lave du Nether)')
check(phasesSrc3.includes('PRÉCAUTION END') && utils.ensureBridgeBlocks, 'End : réserve de blocs avant l île principale (vide mortel)')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)

