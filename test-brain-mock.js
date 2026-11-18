// Mock harness : le cerveau branché — zones de mort, seuil de fuite appris, mémoire des chemins
const fs = require('fs')
const LEARN_PATH = require('path').join(__dirname, 'learning.json')
const MAP_PATH = require('path').join(__dirname, 'worldmap.json')
for (const p of [LEARN_PATH, MAP_PATH]) if (!fs.existsSync(p)) fs.writeFileSync(p, '{}')
const md = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const learn = require('./src/learn')
const map = require('./src/map')

// 1. mémoire spatiale des zones de mort : round-trip + distance
learn.recordSpatial('danger:death', { x: 100, y: 64, z: 100 }, 10)
check(learn.nearestDangerSpatial({ x: 90, z: 90 }, 64) != null, 'nearestDangerSpatial retrouve la zone de mort à ~14 blocs')
check(learn.nearestDangerSpatial({ x: 400, z: 400 }, 64) === null, 'pas de danger signalé à 400 blocs')

// 2. seuil de fuite APPRIS : morts en combat à 12 pv → seuil monte à 14
for (let i = 0; i < 3; i++) learn.recordDeath('combat', { entity: { position: { floored: () => ({ x: 1, y: 2, z: 3 }) }, health: 12 }, health: 12 })
check(learn.getFleeThreshold() === 14, 'getFleeThreshold apprend : 3 morts à 12 pv → seuil 14 (obtenu ' + learn.getFleeThreshold() + ')')

// 3. mémoire des chemins : la fiabilité s'apprend
map.recordPath(0, 0, 100, 100, true)
map.recordPath(0, 0, 100, 100, false)
const rel = map.pathReliability(0, 0, 100, 100)
check(rel === 0.5, 'pathReliability : 1 réussite / 1 échec = 50% (obtenu ' + rel + ')')
check(map.pathReliability(0, 0, 999, 999) === null, 'chemin inconnu → null')

// 4. câblage vérifié dans les sources
const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')
check(utilsSrc.includes('map.recordPath(') && utilsSrc.includes('map.pathReliability('), 'goTo enregistre sa fiabilité (recordPath + pathReliability)')
const survieSrc = fs.readFileSync('./src/survie.js', 'utf8')
check(survieSrc.includes('learn.nearestDangerSpatial'), 'fleeFrom évite les zones de mort connues')
check(survieSrc.includes('learn.getFleeThreshold()'), 'le seuil de fuite sur dégâts est le seuil APPRIS')
check(survieSrc.includes('dropJunk(bot)'), 'inventaire encombré → superflu jeté')
const missionSrc = fs.readFileSync('./src/mission.js', 'utf8')
check(missionSrc.includes("recordSpatial('danger:death'"), 'chaque mort devient une zone DANGER en mémoire')
const decSrc = fs.readFileSync('./src/decision.js', 'utf8')
check(!decSrc.includes('arbitrate'), 'decision.arbitrate (code mort) retiré')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
