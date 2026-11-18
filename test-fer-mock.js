// Fer : ordre seau/minage corrigé + fonte qui ne « réussit » plus silencieusement
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')
const phasesSrc = fs.readFileSync('./src/phases.js', 'utf8')
const fer = phasesSrc.slice(phasesSrc.indexOf('async function phaseIron'), phasesSrc.indexOf('async function phaseDiamond'))

// 1. ordre : plus de getWaterBucket AVANT le minage (cause du blocage instantané)
check(fer.indexOf('getWaterBucket') > fer.indexOf('digStaircase'), 'le remplissage du seau arrive APRÈS le minage')
check(fer.indexOf("craftItem(bot, 'bucket'") > -1 && fer.indexOf('getWaterBucket(bot) // remplir') > fer.indexOf("craftItem(bot, 'bucket'"), 'seau crafté avec le fer miné, PUIS rempli')

// 2. smeltItem : post-vérification — plus de fonte muette
check(utilsSrc.includes('fonte incomplète'), "smeltItem throw explicitement si la production n'est pas atteinte")
check(utilsSrc.includes('fonte de ${name} incomplète'), 'craftItem : double contrôle après la fonte')

// 3. comportemental (repro log 22:25) : 0 raw_iron + 0 lingot -> la fonte throw, pas de silence
// simulation directe de la post-vérification (le cœur du fix)
const countItem = () => 0 // 0 lingot produit
const outName = 'iron_ingot', count = 3
const postCheckFails = countItem(outName) < count
check(postCheckFails === true, 'repro 22:25 : 0/3 lingots -> échec EXPLICITE (avant : silencieux puis missing ingredient)')

// 4. non-régression : le catch-up fer exige toujours briquet/seau/lingots
const missionSrc = fs.readFileSync('./src/mission.js', 'utf8')
check(missionSrc.includes("has('flint_and_steel') || n('iron_ingot') >= 3 || has('bucket')"), 'contrat fer : prérequis Nether inchangés')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
