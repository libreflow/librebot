// Mouvement : plus de saut sur place ni de moonwalk (bornes et abandons raisonnés)
const fs = require('fs')
if (!fs.existsSync('./learning.json')) fs.writeFileSync('./learning.json', '{}')
const md = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const src = fs.readFileSync('./src/utils.js', 'utf8')
const utilsSrcFull = src
const zone = src.slice(src.indexOf('async function walkDirect'), src.indexOf('// Mutex de mouvement'))

// 1. saut en impulsions bornées : plus de jump maintenu en boucle
check(zone.includes('jumpsSinceMove < 3'), 'saut : budget max 3 impulsions sans mouvement réel')
check(zone.includes('lastJumpAt'), 'saut en impulsions ON/OFF (pas maintenu)')
check(zone.includes('else bot.setControlState(\'jump\', false)'), 'jump coupé quand le budget est épuisé')
check(zone.includes('jumpsSinceMove = 0'), 'budget remis à zéro dès qu on avance réellement')

// 2. contournement borné : 2 alternances max puis abandon
check(zone.includes('strafeCount < 2'), 'moonwalk : 2 contournements max (avant : alternance infinie)')

// 3. abandons raisonnés vers le pathfinder
check(zone.includes('depth >= 3 && !holeAhead && stuckFor > 3000'), 'trou profond : abandon rapide au pathfinder (ponts)')
check(zone.includes('depth >= 5'), 'trou très profond : abandon immédiat (pont = pathfinder)')
check(zone.includes('stuckFor > 6000 && jumpsSinceMove >= 3 && strafeCount >= 2'), 'après sauts+contournements épuisés : rend la main (fin de la marche agitée)')

// 5. téléportation opérateur : le trajet en cours est annulé, pas de retour à l'ancien objectif
const idx = fs.readFileSync('./src/index.js', 'utf8')
check(idx.includes("_lastTpPos") && idx.includes('physicsTick') && idx.includes('distanceTo(_lastTpPos) > 32'), 'tp : détection sur le tick physique (saut > 32 blocs en un tick)')
check(zone.includes('(bot._tpAt ?? 0) !== tp0'), 'tp : walkDirect rend la main immédiatement (objectif obsolète)')
check(utilsSrcFull.includes("t\u00e9l\u00e9port\u00e9 \u2014 trajet annul\u00e9") || fs.readFileSync('./src/utils.js', 'utf8').includes('t\u00e9l\u00e9port\u00e9 \u2014 trajet annul\u00e9'), 'tp : goTo logge l\'annulation et échoue proprement (la phase réévalue sur place)')

// 4. nage intacte
check(zone.includes("if (inWater) bot.setControlState('jump', true)"), 'nage : remonter à la surface, inchangé')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
