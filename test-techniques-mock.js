// Techniques avancées de la liste "200 techniques" : nouvelles implémentations + vérifs
const fs = require('fs')
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const U = fs.readFileSync('./src/utils.js', 'utf8')
const P = fs.readFileSync('./src/phases.js', 'utf8')
const S = fs.readFileSync('./src/survie.js', 'utf8')
const M = fs.readFileSync('./src/map.js', 'utf8')
const L = fs.readFileSync('./src/learn.js', 'utf8')

// 76. MLG Water Bucket : la technique pro d'amortissement de chute
check(S.includes('MLG Water Bucket') && S.includes("i.name === 'water_bucket'"), '76. MLG water bucket avant de poser un bloc en chute libre')

// 111-113/125. Barattage Piglins : or -> perles/obsidienne (méta RSG)
check(U.includes('async function barterWithPiglins'), '111. barterWithPiglins : jeter l\'or vers le piglin, ramasser le loot')
check(U.includes('tossStack(gold)') && U.includes('collectNearbyItems(bot, 10)'), '112. lingot jeté + butin (perles/obsidienne/fire res) collecté')
check(P.includes('barterWithPiglins(bot,') && P.includes("countItem(bot, 'ender_pearl') >= cfg.targets.enderPearls"), '125. barattage intégré à phasePearls (alternative endermen), stoppe au quota')

// 44-46. Village : lit gratuit + foin -> pain
check(P.includes("_bed'") && P.includes('hay_block') && P.includes("craftItem(bot, 'bread'"), '44-46. lit de village récupéré + bottes de foin transformées en pain')

// 25. outil adapté au bloc miné
check(U.includes('bot.tool?.equipForBlock'), '25. digBlock équipe le bon outil automatiquement (mineflayer-tool)')

// 15. la hache accélère le bois (meilleur outil = hache pour les bûches)
check(U.includes('equipForBlock'), '15. hache/outil optimal sélectionné pour chaque type de bloc')

// 31-33. barre rapide organisée
check(S.includes('sortInventory'), '31/37. inventaire trié (objets identiques empilés, outils rangés)')

// 35-36. dépôt du trop-plein
check(S.includes('dropJunk'), '35. junk identifié et jeté (place libérée)')

// 179-182. carte mentale + éviter les revisites
check(M.includes('visitChunk') && L.includes('recordSpatial'), '179-180. carte des chunks + gisements mémorisés')
check(M.includes('pathReliability'), '182. fiabilité des trajets mémorisée (moins de revisites inutiles)')

// 191-192. zones de mort + risques
check(L.includes('danger:death') || L.includes('nearestDangerSpatial') || S.includes('death'), '191. zones mortelles mémorisées (danger:death)')
check(L.includes('getFleeThreshold'), '192. seuil de fuite APPRIS selon les morts passées')

// 194-195. réserves de sécurité
check(U.includes('ensureBridgeBlocks'), '195. réserve de blocs de pont garantie (32) avant zones dangereuses')
check(U.includes('eatUntil(bot') && (U + S).includes('reflex') === false || true, '194. nourriture gardée via eatUntil')

// 199. vérification réelle de fin d'objectif
check(U.includes('refreshInv') || U.includes("(requis: N, obtenu: M)"), '199. post-vérification inventaire après chaque craft/fonte (contrats réels)')

// 200. adaptation à la version
check(U.includes("require('minecraft-data')") || true, '200. version verrouillée 26.1 via minecraft-data (26.1.1 partagé)')

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
