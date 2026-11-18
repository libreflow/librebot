// Garde-fous Nether : movements PAR DIMENSION, parkour désactivé dans le Nether
const fs = require('fs')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

// stub Movements pour tester le vrai setMovements du bot
const pfPath = require.resolve('mineflayer-pathfinder')
const real = require.cache[pfPath]
const created = []
require.cache[pfPath] = { id: pfPath, filename: pfPath, loaded: true, exports: { Movements: class { constructor (b) { this.bot = b; this.canDig = false; this.allowSprinting = false; this.allowParkour = false; this.allow1by1towers = false; created.push(this) } }, goals: { GoalNear: class {}, GoalXZ: class {}, GoalY: class {}, GoalBlock: class {}, GoalFollow: class {} }, GoalFollow: class {} } }

const utils = require('./src/utils.js')

const mkBot = (dim) => ({
  version: '26.1', game: { dimension: dim },
  pathfinder: { setMovements: (m) => {}, thinkTimeout: 0, tickTimeout: 0 },
  collectBlock: { movements: null }
})

const nether = mkBot('the_nether')
utils.setMovements(nether)
check(created.length === 1, 'Movements créé pour le Nether')
check(created[0].allowParkour === false, 'Nether : parkour DÉSACTIVÉ (garde-fou lave)')
check(created[0].allow1by1towers && created[0].canDig, 'Nether : piliers et minage toujours autorisés')
check(nether.collectBlock.movements === created[0], 'collectBlock partage les movements Nether')

utils.setMovements(nether)
check(created.length === 1, 'cache : pas de recréation dans la même dimension')

const over = mkBot('overworld')
utils.setMovements(over)
check(created.length === 2, 'changement de dimension : nouveaux Movements')
check(created[1].allowParkour === true, 'Overworld : parkour réactivé (garde-fou limité au Nether)')

const end = mkBot('the_end')
utils.setMovements(end)
check(created.length === 3 && created[2].allowParkour === true, 'End : parkour autorisé')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
