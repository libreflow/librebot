// Mock harness : catch-up adaptatif — les phases prouvées par l'inventaire sont sautées
const fs = require('fs')
const LEARN_PATH = require('path').join(__dirname, 'learning.json')
if (!fs.existsSync(LEARN_PATH)) fs.writeFileSync(LEARN_PATH, '{}')
const md = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const mission = require('./src/mission.js')
const bot = (inv, dimension = 'overworld') => ({
  version: '26.1',
  game: { dimension },
  inventory: { items: () => inv.map(([name, count]) => ({ name, count })) },
  entity: { position: { x: 0, y: 64, z: 0 } }
})
const cfg = {
  rush: true,
  targets: { rawIron: 8, diamonds: 5, obsidian: 10, blazeRods: 7, enderPearls: 14, enderEyes: 12 }
}

// 1. kit complet给的 + progression forte → 12 phases sautées (tout sauf dragon)
const kit = [['diamond_pickaxe', 1], ['diamond_sword', 1], ['flint_and_steel', 1], ['furnace', 1],
  ['obsidian', 10], ['blaze_powder', 14], ['ender_pearl', 14], ['ender_eye', 12]]
let p = { done: [], home: [0, 64, 0], netherPortal: [1, 65, 1], fortress: [2, 66, 2], portalRoom: [3, 67, 3] }
let s = mission.recoverPhasesFromInventory(bot(kit), cfg, p)
check(s === 12, 'kit complet + progression : 12 phases sautées (dragon jamais) — obtenu ' + s)
check(p.done.includes('yeux') && p.done.includes('stronghold') && !p.done.includes('dragon'), 'saut avec progression, dragon conservé')

// 2. inventaire vide → aucun saut (route classique)
p = { done: [] }
s = mission.recoverPhasesFromInventory(bot([]), cfg, p)
check(s === 0 && p.done.length === 0, 'inventaire vide : rien de sauté')

// 3. monotone : kit fer complet mais pas de diamant → stop après 'fer'
const ironKit = [['stone_pickaxe', 1], ['iron_pickaxe', 1], ['iron_sword', 1], ['furnace', 1], ['flint_and_steel', 1]]
p = { done: [] }
s = mission.recoverPhasesFromInventory(bot(ironKit), cfg, p)
check(s === 3 && p.done.join(',') === 'bois,pierre,fer', 'monotone : arrêt après fer (' + p.done.join(',') + ')')

// 4. pioche fer SANS de quoi faire briquet/seau → phase fer conservée (prérequis Nether)
const ironPickOnly = [['wooden_pickaxe', 1], ['stone_pickaxe', 1], ['iron_pickaxe', 1], ['furnace', 1], ['iron_ingot', 0], ['flint_and_steel', 0]]
p = { done: [] }
s = mission.recoverPhasesFromInventory(bot(ironPickOnly), cfg, p)
check(s === 2 && !p.done.includes('fer'), 'prérequis briquet/seau manquant : fer NON sauté (' + p.done.join(',') + ')')

// 5. butin de poudres : 14 poudres (= 7 rods) suffisent pour blazes — mais monotone s'applique
const powderKit = [['diamond_pickaxe', 1], ['flint_and_steel', 1], ['furnace', 1], ['obsidian', 10], ['blaze_powder', 14]]
p = { done: [], home: [0, 64, 0], netherPortal: [1, 65, 1], fortress: [2, 66, 2] }
s = mission.recoverPhasesFromInventory(bot(powderKit), cfg, p)
check(p.done.includes('blazes'), 'poudres comptées comme équivalent rods : blazes sauté')

// 6. dénie le cas mort : progression persiste (forteresse connue) mais inventaire vide
//    → monotone stoppe dès 'bois', on ne saute PAS 'nether' sur des coordonnées seules
p = { done: [], home: [0, 64, 0], netherPortal: [1, 65, 1], fortress: [2, 66, 2] }
s = mission.recoverPhasesFromInventory(bot([]), cfg, p)
check(s === 0 && !p.done.includes('nether'), 'après mort (inventaire vide) : coordonnées seules ne sautent pas nether/forteresse')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
