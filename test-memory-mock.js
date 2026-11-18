// Corrections finales : mémoire des gisements consultée, confirmation stronghold itérative, purge spatiale
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
if (!fs.existsSync('./worldmap.json')) fs.writeFileSync('./worldmap.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')
const phasesSrc = fs.readFileSync('./src/phases.js', 'utf8')
const survieSrc = fs.readFileSync('./src/survie.js', 'utf8')

// 1. branchMine consulte la mémoire AVANT de creuser aveuglément
check(utilsSrc.includes('getNearestDiscoveries(n, bot.entity.position, 2, 128)'), 'branchMine consulte la mémoire des gisements vus')
check(utilsSrc.indexOf('if (!spots.length)') < utilsSrc.indexOf('dirs[dir % 4]'), 'consultation mémoire avant le creusage de tunnel aveugle')

// 2. confirmation stronghold itérative (3 tentatives au lieu d'une estimation figée)
check(phasesSrc.includes('for (let tries = 0; tries < 3; tries++)') && phasesSrc.includes('progress.strongholdXZ = confirm.to'), 'stronghold : estimation corrigée au fil des lancers de confirmation')

// 3. purge spatiale périodique
check(survieSrc.includes('learn.pruneSpatial()'), 'purge périodique de la carte spatiale (1/h)')

// 4. round-trip mémoire -> consultation (fonctions réelles)
const learn = require('./src/learn.js')
learn.recordDiscovery('diamond_ore', { x: 10, y: -58, z: 10 })
const d = learn.getNearestDiscoveries('diamond_ore', { x: 0, z: 0 }, 2, 128)
check(d.length === 1 && d[0].dist <= 128, 'round-trip recordDiscovery -> getNearestDiscoveries OK (dist ' + (d[0] && Math.round(d[0].dist)) + ')')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
