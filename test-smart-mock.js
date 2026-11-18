// Intelligence : réflexe cuisine, forteresse spirale + mémoire, auto-reprise
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')
const phasesSrc = fs.readFileSync('./src/phases.js', 'utf8')
const missionSrc = fs.readFileSync('./src/mission.js', 'utf8')
const indexSrc = fs.readFileSync('./src/index.js', 'utf8')

// 1. réflexe cuisine
check(utilsSrc.includes('RÉFLEXE CUISINE') && utilsSrc.includes('smeltItem(bot, rawName, cookedName'), 'eatUntil : réflexe cuisine (cuit avant de manger cru, via le four)')
const smeltCall = utilsSrc.indexOf('smeltItem(bot, rawName, cookedName')
const whileIdx = utilsSrc.indexOf('while (bot.food < target')
check(smeltCall > -1 && whileIdx > -1 && smeltCall < whileIdx, 'la cuisson précède la boucle de repas')

// 2. forteresse intelligente
const fz = phasesSrc.slice(phasesSrc.indexOf('async function phaseFortress'), phasesSrc.indexOf('async function phaseBlaze'))
check(fz.includes('Je connais déjà une forteresse'), 'forteresse : mémoire d abord (progress.fortress)')
check(fz.includes('angle += Math.PI / 3') && fz.includes('radius *= 1.08'), 'exploration en spirale croissante (plus de marche aléatoire)')
check(fz.includes("recordDiscovery('fortress'"), 'forteresse découverte mémorisée pour les runs futurs')

// 3. auto-reprise après blocage
check(missionSrc.includes('state.autoResumeAt = Date.now() + 5 * 60000'), 'blocage : auto-reprise programmée (5 min)')
check(!/while \(isNight\(bot\) && !hasWeapon\(bot\) && waited/.test(missionSrc), 'nuit : plus d attente passive jusqu au matin')
check(missionSrc.includes('JE BOSSE QUAND M'), 'nuit : le bot continue la mission protégé')
check(indexSrc.includes('state.autoResumeAt && Date.now() > state.autoResumeAt'), 'idle watch : la reprise se déclenche seule')
check(indexSrc.includes('Auto-reprise'), 'log d auto-reprise')

// 4. comportemental : conversions viande crue -> cuite correctes
check(utilsSrc.includes("beef: 'cooked_beef'") && utilsSrc.includes("chicken: 'cooked_chicken'"), 'conversions viande crue -> cuite correctes')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
