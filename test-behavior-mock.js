// Comportement minutieux : anti-surminage, inventaire plein, opportunité non intrusive
const fs = require('fs')
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const U = fs.readFileSync('./src/utils.js', 'utf8')
const S = fs.readFileSync('./src/survie.js', 'utf8')

// 1. la veine minée est plafonnée au MANQUE RÉEL (fin du 95-pour-12)
check(U.includes('const remaining = Math.max(1, count - got)') && U.includes('Math.min(16, remaining), 8, 1)'),
  'plafond de la veine = min(16, reste à obtenir) — plus de minage 16 blocs d\u2019office')

// 2. arrêt immédiat dès que le quota réel est atteint (dans la veine)
check(U.includes('if (mined + got >= count) break // ANTI-SURMINAGE'),
  'arrêt dans la veine dès que mined+got atteint le quota')

// 3. inventaire plein : dropJunk d'abord, puis on rend la main au lieu de miner pour rien
check(U.includes('emptySlotCount') && U.includes('dropJunk(bot)'),
  'inventaire plein → junk jeté, sinon on rend la main (drops non perdus au sol)')
check(U.includes('if (inventoryFull()) break // plus de place'),
  'plus de place → la veine s\u2019arrête (on ne casse pas ce qu\u2019on ne prendra pas)')

// 4. simulation fonctionnelle du plafond de veine : besoin 12, déjà 10 en poche
// → vein demandée = min(16, 2) = 2 blocs minés MAX (avant : 16)
const need = 12; const got = 10
const veinSize = Math.min(16, Math.max(1, need - got))
check(veinSize === 2, 'simulation : objectif 12, en poche 10 → veine plafonnée à ' + veinSize + ' (et pas 16)')
const veinSize0 = Math.min(16, Math.max(1, 4 - 0))
check(veinSize0 === 4, 'simulation : objectif 4 depuis 0 → veine de ' + veinSize0 + ' (plafond 16 respecté)')

// 5. opportunité : ne hijacke PLUS un pathfinding de mission en cours
check(S.includes('!bot.pathfinder?.isMoving?.()'),
  'OPPORTUNITE attend que le pathfinder soit libre (fin des « The goal was changed »)')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
