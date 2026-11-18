// Le kit netherite doit être reconnu (catch-up, équipement, priorité d arme)
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const mission = require('./src/mission.js')
const survie = require('./src/survie.js')

const kit = [['netherite_pickaxe', 1], ['netherite_sword', 1], ['netherite_shovel', 1], ['furnace', 1], ['flint_and_steel', 1],
  ['netherite_chestplate', 1], ['netherite_boots', 1],
  ['dark_oak_planks', 46], ['dark_oak_log', 14], ['cobblestone', 48], ['dirt', 54]]
const bot = {
  version: '26.1',
  game: { dimension: 'overworld' },
  inventory: { items: () => kit.map(([name, count]) => ({ name, count })) },
  entity: { position: { x: 0, y: 64, z: 0 } }
}
const cfg = { rush: true, targets: { rawIron: 8, diamonds: 5, obsidian: 10, blazeRods: 7, enderPearls: 14, enderEyes: 12 } }

// repro du log : kit netherite => les phases pierre/fer/diamant doivent être sautées
const p = { done: [], home: null }
const skipped = mission.recoverPhasesFromInventory(bot, cfg, p)
check(p.done.includes('bois') && p.done.includes('pierre') && p.done.includes('fer') && p.done.includes('diamant'),
  'kit netherite : bois+pierre+fer+diamant sautés (' + p.done.join(',') + ')' + (skipped !== 4 ? ' — obtenu ' + skipped : ''))

// netherite_sword considéré comme bonne arme => équipé pour se battre
check(survie.isWellEquipped(bot) === true, 'isWellEquipped : kit netherite = prêt à se battre (avant : faux)')
const survieSrc = fs.readFileSync('./src/survie.js', 'utf8')
check(survieSrc.includes("'netherite_sword'"), 'survie : netherite_sword dans les ensembles d armes')
const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')
check(utilsSrc.includes("'netherite_sword'"), 'utils : priorité d équipement inclut netherite')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
