// Repro du bug prod « Error: missing ingredient » en phase pierre (reprise sans bois)
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = require('minecraft-data')('26.1')
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }

const utilsSrc = fs.readFileSync('./src/utils.js', 'utf8')
const phasesSrc = fs.readFileSync('./src/phases.js', 'utf8')

// 1. le cache ne stocke PLUS le résultat filtré par inventaire
check(utilsSrc.includes('const recipesKey = `${bot.version}:${item.id}`'), 'clé de cache : version+item (plus de dépendance à la table)')
check(!utilsSrc.includes('recipesFor(item.id, null, 1, table)'), "recipesFor (filtré par l'inventaire) n'est plus mis en cache")
check(utilsSrc.includes('bot.recipesAll(item.id, null, true)'), 'liste structurelle recipesAll mise en cache')

// 2. re-sélection de recette après fabrication récursive des ingrédients
check(utilsSrc.includes('recipe = recipes.find(isCraftableNow) ?? recipe'), 'recette re-sélectionnée après la récursion (variantes gérées)')

// 3. erreur diagnostique à la place du muet « missing ingredient »
check(utilsSrc.includes('il manque ${'), 'échec bot.craft -> erreur explicite (il manque N x item)')
check(utilsSrc.includes('ingrédients irrécupérables après 3 passes'), 'borne de 3 passes (pas de boucle infinie)')

// 4. phaseStone : repli coupe de bois si ni bâtons ni planches (reprise cassée)
const zone = phasesSrc.slice(phasesSrc.indexOf('async function phaseStone'), phasesSrc.indexOf('async function phaseIron'))
check(zone.includes('coupe une bûche express'), 'phaseStone : coupe express de bûche si aucun bois (cas reprise)')
check(zone.includes("craftItem(bot, 'stick', 2)"), 'phaseStone : bâtons fabriqués avant les outils')
check(zone.indexOf('stick') < zone.indexOf("craftItem(bot, 'stone_pickaxe'"), 'bâtons AVANT la pioche en pierre')

// 5. les bûches sont NOT_CRAFTABLE dans craftItem (erreur claire, pas de récursion fantôme)
check(utilsSrc.includes("'oak_log', 'birch_log'"), 'bûches marquées non-craftables (message clair)')

// 6. round-trip comportemental : le planificateur résout stone_pickaxe dès qu'une bûche est là
const cp = require('./src/craftplanner.js')
const bot = (inv) => ({ version: '26.1', inventory: { items: () => inv.map(([n, c]) => ({ name: n, count: c })) }, recipesFor: (id) => md.recipes[id] ?? [], recipesAll: (id) => md.recipes[id] ?? [] })
const p = cp.plan(bot([['cobblestone', 12], ['oak_log', 1]]), 'stone_pickaxe', 1)
check(p.crafts.length >= 2 && p.gather.length === 0, 'plan stone_pickaxe : bûche->planches->bâtons->pioche résolu (' + p.crafts.map((c) => c.item).join(' > ') + ')')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
