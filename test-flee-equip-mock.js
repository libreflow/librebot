// Mock harness : le bot bien équipé ne fuit plus, il se bat
const fs = require('fs')
const LEARN_PATH = require('path').join(__dirname, 'learning.json')
if (!fs.existsSync(LEARN_PATH)) fs.writeFileSync(LEARN_PATH, '{}')
const decision = require('./src/decision')
const survie = require('./src/survie')

let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const bot = (opts = {}) => ({
  health: opts.health ?? 16,
  food: opts.food ?? 20,
  inventory: { items: () => opts.inv ?? [] },
  entity: { position: { floored: () => ({ x: 0, y: 64, z: 0, offset: () => null }) } },
  blockAt: () => null,
  time: { timeOfDay: 6000 },
  game: { dimension: 'overworld' }
})

const ctx = (o = {}) => ({
  hostile: { name: 'zombie' },
  hostileDist: o.dist ?? 5,
  hostilesNear: o.n ?? 1,
  armed: o.armed ?? true,
  hasBow: false,
  wellEquipped: o.wellEquipped ?? false,
  missionActive: true
})

// 1. bien équipé, 3 hostiles, bonne vie → PAS de FUITE (combat à la place)
let d = decision.evaluate(bot(), ctx({ n: 3, wellEquipped: true }))
check(d.action !== 'FUITE', '3 hostiles + bien équipé → ' + d.action + ' (plus de fuite systématique)')

// 2. mal équipé, 3 hostiles → FUITE inchangée
d = decision.evaluate(bot(), ctx({ n: 3, wellEquipped: false }))
check(d.action === 'FUITE', '3 hostiles + mal équipé → FUITE conservée')

// 3. bien équipé mais 5 hostiles → FUITE (submergé)
d = decision.evaluate(bot(), ctx({ n: 5, wellEquipped: true }))
check(d.action === 'FUITE', '5 hostiles → FUITE même bien équipé (overwhelm)')

// 4. bien équipé mais vie <= 6 → FUITE vitale inchangée
d = decision.evaluate(bot({ health: 5 }), ctx({ n: 2, wellEquipped: true }))
check(d.action === 'FUITE', 'vie 5 → FUITE prioritaire même bien équipé')

// 5. bien équipé, 4 hostiles → combat autorisé (l'ancienne limite était 2)
d = decision.evaluate(bot(), ctx({ n: 4, wellEquipped: true, dist: 8 }))
check(d.action === 'COMBAT_MORTEL' || d.action === 'MONSTRE_FAIBLE', 'bien équipé : combat possible à 4 hostiles → ' + d.action)

// 6. isWellEquipped : arme + armure + nourriture
const invGood = [{ name: 'iron_sword', count: 1 }, { name: 'iron_chestplate', count: 1 }, { name: 'iron_boots', count: 1 }]
const invWeak = [{ name: 'wooden_sword', count: 1 }]
check(survie.isWellEquipped(bot({ inv: invGood })) === true, 'isWellEquipped: épée fer + 2 pièces armure = équipé')
check(survie.isWellEquipped(bot({ inv: invWeak })) === false, 'isWellEquipped: épée bois sans armure = pas équipé')
check(survie.isWellEquipped(bot({ inv: invGood, food: 5 })) === false, 'isWellEquipped: faim < 12 = pas prêt à se battre')

// 7. code : reactDamage ne fuit plus à 16 pv si bien équipé (hp<=8 reste vital)
const src = fs.readFileSync('./src/survie.js', 'utf8')
check(src.includes('hp <= 8 || !isWellEquipped(bot)'), 'reactDamage: fuite seulement si hp<=8 OU mal équipé')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
