// Conversation libre : réponses contextuelles aux messages non-commande
;(async () => {
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
// stub de mission.js (état + progression) injecté AVANT le require de conversation
const missionStub = {
  state: { running: true, currentPhase: 'fer' },
  PHASES: [
    { key: 'bois', label: 'Bois & outils' },
    { key: 'pierre', label: 'Pierre' },
    { key: 'fer', label: 'Fer' }
  ],
  loadProgress: () => ({ done: ['bois', 'pierre'] })
}
const missionPath = require.resolve('./src/mission')
require.cache[missionPath] = { id: missionPath, filename: missionPath, loaded: true, exports: missionStub }

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const sent = []
const bot = {
  username: 'LibreBot',
  chat: (m) => sent.push(String(m)),
  health: 18, food: 16,
  entity: { position: { floored: () => ({ x: 10, y: 64, z: -5 }) } },
  game: { dimension: 'minecraft:overworld' },
  inventory: { items: () => [] }
}
const conv = require('./src/conversation')

// 1. salutation → réponse avec le pseudo
conv._resetForTest?.()
sent.length = 0
let ok = conv.reply(bot, 'Rbxsnx', 'LibreBot salut !')
check(ok === true, 'message non-commande : le bot répond')
check(sent.length >= 0 && /salut|yo|coucou|hello/i.test(sent.join(' ')), 'salutation reconnue (réponse amicale)')

// 2. ça va → stats de vie intégrées
sent.length = 0
await new Promise((r) => setTimeout(r, 4100))
conv.reply(bot, 'Rbxsnx', 'LibreBot comment ça va ?')
check(/18|16|20/.test(sent.join(' ')), 'ça va : vie/faim injectées dans la réponse')

// 3. identité
sent.length = 0
await new Promise((r) => setTimeout(r, 4100))
conv.reply(bot, 'Rbxsnx', 'LibreBot qui es-tu ?')
check(/LibreBot/i.test(sent.join(' ')), 'identité : se présente comme LibreBot')

// 4. insulte → réponse zen, jamais d'insulte en retour
sent.length = 0
await new Promise((r) => setTimeout(r, 4100))
conv.reply(bot, 'Rbxsnx', 'LibreBot t es un connard')
const out = sent.join(' ')
check(/zen|pacifique|respiration|coince/i.test(out), 'insulte : répond calmement (pas d\'insulte en retour)')
check(!/(connard|batard|crétin|creton)/i.test(out), 'insulte : aucun terme offensant dans la réponse')

// 5. anti-flood : message trop rapproché ignoré
sent.length = 0
const nOk = conv.reply(bot, 'Rbxsnx', 'LibreBot tu fais quoi ?')
check(nOk === false || sent.length === 0, 'anti-flood : pas deux réponses à moins de 4 s')

// 6. contexte phase/progression
sent.length = 0
await new Promise((r) => setTimeout(r, 4100))
conv.reply(bot, 'Rbxsnx', 'LibreBot pourquoi tu ne fais pas ça ?')
check(/Fer|phase en cours/i.test(sent.join(' ')), 'contexte : phase en cours (Fer) présente dans la réponse')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
