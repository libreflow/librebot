// Mock harness: simule des runs rush avec horloge factice, vérifie la baseline agrégée
const fs = require('fs')
if (fs.existsSync('learning.json.bak')) fs.unlinkSync('learning.json.bak')
if (fs.existsSync('learning.json')) fs.renameSync('learning.json', 'learning.json.bak')
fs.writeFileSync('learning.json', '{}')
process.on('exit', () => { try { fs.unlinkSync('learning.json'); if (fs.existsSync('learning.json.bak')) fs.renameSync('learning.json.bak', 'learning.json') } catch {} })
const LEARN_PATH = require('path').join(__dirname, 'learning.json')
if (!fs.existsSync(LEARN_PATH)) fs.writeFileSync(LEARN_PATH, '{}')
// horloge factice : Date.now contrôlée (speedrun/learn utilisent Date.now)
let t = 1700000000000
Date.now = () => t
const learn = require('./src/learn')
const speedrun = require('./src/speedrun')

const stub = () => {}
let fails = 0
const check = (cond, msg) => { console.log((cond ? '✓' : '✗ FAIL') + ' ' + msg); if (!cond) fails++ }

// run 1 : 13 phases, 1 mort en forteresse
speedrun.startRun(stub)
for (const [k, s] of [['bois', 30], ['outils', 25], ['fer', 120], ['diamants', 200], ['obsidienne', 300], ['portail', 310], ['forteresse', 500], ['blazes', 700], ['perles', 900], ['yeux', 950], ['stronghold', 1100], ['portail_end', 1150], ['dragon', 1300]]) {
  speedrun.setPhase(k)
  if (k === 'forteresse') speedrun.noteDeath(stub)
  t = 1700000000000 + s * 1000
  check(speedrun.split(k, k, stub) === s * 1000, 'split elapsed ' + k + ' = ' + s + 's')
}
speedrun.setPhase('dragon')
const r1 = speedrun.finish(true, stub)
check(r1.deaths === 1 && r1.deathsByPhase.forteresse === 1, 'mort attribuée à la phase forteresse')
check(r1.phaseDeltas.bois === 30000 && r1.phaseDeltas.outils === -5000, 'phaseDeltas = delta entre splits consécutifs')

// run 2 : interrompu en forteresse avec 2 morts
t = 1800000000000
speedrun.startRun(stub)
speedrun.setPhase('bois'); t += 20000; speedrun.split('bois', 'bois', stub)
speedrun.setPhase('fer'); t += 60000; speedrun.split('fer', 'fer', stub)
speedrun.setPhase('forteresse'); speedrun.noteDeath(stub); speedrun.noteDeath(stub)
speedrun.finish(false, stub)

const b = speedrun.baseline()
check(b.runs === 2 && b.wins === 1, 'baseline: 2 runs, 1 victoire')
const rowFort = b.phases.find((p) => p.phase === 'forteresse')
check(rowFort && rowFort.deaths === 3, 'baseline: 3 morts cumulées en forteresse')
check(rowFort && rowFort.avgDelta === 190000, 'baseline: avgDelta forteresse = 190 s (500-310)')
check(b.phases[0].phase === 'blazes' || b.phases[0].phase === 'fer', 'baseline triée goulot en premier (' + b.phases[0].phase + ')')
const desc = speedrun.describeBaseline()
check(desc.includes('forteresse') && desc.includes('mort'), 'describeBaseline contient forteresse + morts')
check(learn.getSpeedrunStats().history.length === 2, 'historique persisté dans learning.json')
check(learn.getSpeedrunBaseline().runs === 2, 'getSpeedrunBaseline exporté et cohérent')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
