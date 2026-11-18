// Reconnexion : la mission ne survit pas a une déconnexion — reset + re-rattrapage
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const mdStub = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => mdStub }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const indexSrc = fs.readFileSync('./src/index.js', 'utf8')
const missionSrc = fs.readFileSync('./src/mission.js', 'utf8')

// 1. à la déconnexion, state.running est forcé à false (plus de mission fantôme)
check(indexSrc.includes('Mission interrompue par la déconnexion'), 'bot.on(end) : la mission est marquée interrompue à la déconnexion')
check(indexSrc.includes('state.running = false'), "state.running reseté (l'auto-mission peut relancer au spawn)")
check(indexSrc.includes('state.autoResumeAt = null'), 'les auto-reprises programmées sont annulées (mission morte = repartir propre)')

// 2. la relance au spawn repasse par runMission -> rattrapage inventaire recalcule
check(missionSrc.includes('recoverPhasesFromInventory(bot, cfg, progress)'), 'runMission recalcule le rattrapage inventaire à chaque (re)lance')
check(indexSrc.includes('runMission(bot, config)'), 'autoMission appelle bien runMission au respawn')

// 3. comportemental : rattrapage avec le kit netherite + cobble (repro exact du cas)
const mission = require('./src/mission.js')
const kit = [['netherite_pickaxe', 1], ['netherite_sword', 1], ['furnace', 1], ['flint_and_steel', 1], ['netherite_chestplate', 1], ['netherite_boots', 1], ['cobblestone', 37], ['dark_oak_planks', 46]]
const bot = { version: '26.1', game: { dimension: 'overworld' }, inventory: { items: () => kit.map(([name, count]) => ({ name, count })) }, entity: { position: { x: 0, y: 64, z: 0 } } }
const cfg = { rush: true, targets: { rawIron: 8, diamonds: 5, obsidian: 10, blazeRods: 7, enderPearls: 14, enderEyes: 12 } }
const p = { done: ['bois'] } // pierre PAS marquée faite (cas du bug signalé)
mission.recoverPhasesFromInventory(bot, cfg, p)
check(p.done.includes('pierre'), 'repro exact : pierre rattrapée à la reconnexion (inventaire déjà riche) — done = ' + p.done.join(','))

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
