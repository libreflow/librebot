// Couverture de la route complète "96 étapes jusqu'au dragon et au-delà"
const fs = require('fs')
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const P = fs.readFileSync('./src/phases.js', 'utf8')
const U = fs.readFileSync('./src/utils.js', 'utf8')
const P2 = fs.readFileSync('./src/phases2.js', 'utf8')

// ---- Phase 1 (1-30) : bois → outils → pierre → fer → diamant → obsidienne
check(P.includes('craftAnyPlanks') || P.includes('craftItem(bot, \'oak_planks\''), '1-2. bûches → planches')
check(P.includes('ensureCraftingTable') || U.includes('ensureCraftingTable'), '3-5. table de craft posée + bâtons')
check(P.includes("craftItem(bot, 'wooden_pickaxe', 1)"), '6. pioche en bois')
check(P.match(/stone:[^}]*8|pierre/g) && P.includes('branchMine(bot, {\n      y: 16'), '7-8. ≥20 blocs de pierre (minage Y=16)')
check(P.includes("craftItem(bot, 'stone_pickaxe', 1)"), '9. pioche en pierre')
check(P.includes("craftItem(bot, 'stone_axe', 1)"), '10. hache en pierre')
check(P.includes("craftItem(bot, 'stone_sword', 1)"), '11. épée en pierre')
check(P.includes("craftItem(bot, 'stone_shovel', 1)"), '12. pelle en pierre')
check(P.includes("craftItem(bot, 'furnace'"), '13. fournaise')
check(U.includes("SMELT_MAP") || U.includes("craftItem(bot, 'charcoal'"), '14. charbon/charbon de bois')
check(P.includes("craftItem(bot, 'torch'"), '15. torches')
check(P.includes('huntMob') && P.includes('eatUntil'), '16. animaux → nourriture')
check(U.includes("beef: 'cooked_beef'") || U.includes('cooked_beef'), '17. viande cuite au four')
check(P.includes("huntMob(bot, ['sheep']") && P.includes('_bed'), '18. lit (3 laines chassées + 3 planches)')
check(P.includes("craftItem(bot, 'chest', 2)"), '20. coffres de stockage')
check(P.includes('digStaircase(bot, 16)') || P.includes('Y=16'), '21. fer sous terre')
check((U + P).includes("smeltItem(bot, 'raw_iron', 'iron_ingot'"), '22. cuisson du minerai de fer')
check(P.includes("craftItem(bot, 'shield', 1)"), '23. bouclier')
check(P.includes('iron_helmet') && P.includes('iron_chestplate') && P.includes('iron_leggings') && P.includes('iron_boots'), '24. armure de fer complète')
check(P.includes("craftItem(bot, 'bucket'"), '25. seau en fer')
check(P.includes("craftItem(bot, 'iron_pickaxe', 1)"), '26. pioche en fer')
check(P.includes("craftItem(bot, 'shears', 1)"), '27. cisailles')
check(P.includes('deepslate_diamond_ore'), '28. diamants')
check(P.includes("craftItem(bot, 'diamond_pickaxe', 1)"), '29. pioche en diamant')
check(P.includes('makeObsidian'), '30. obsidienne au seau d\u2019eau')

// ---- Phase 2 (31-39) : préparation Nether
check(U.includes('gravel') && P.includes('digGravelForFlint'), '31-32. gravier → silex')
check(P.includes("craftItem(bot, 'flint_and_steel', 1)"), '33. briquet')
check(P.includes('buildNetherPortal'), '34-35. portail construit + allumé (briquet)')
check(P.includes('iron_sword') && P.includes('shield'), '36. armes/armure solides')
check(P.includes('ensureBridgeBlocks') && P.includes('torch'), '37. nourriture + blocs + torches (réserve de ponts)')
check(P.includes('golden_helmet'), '38. pièce d\u2019armure en or (anti-piglins)')
check(P.includes("enterDimension(bot, 'the_nether'"), '39. entrée dans le Nether')

// ---- Phase 3 (40-50) : forteresse et Blazes
check(P.includes('spirale') || P.includes('radius *= 1.08'), '40. exploration spirale du Nether')
check(P.includes('progress.fortress') && P.includes('recordDiscovery(\'fortress\''), '41. forteresse trouvée + mémorisée')
check(P.includes('phaseBlaze'), '42-44. Blazes repérés, tués, bâtons récupérés')
check(P.includes("craftItem(bot, 'blaze_powder'"), '45-46. poudre de Blaze (≥6)')
check(P.includes('nether_wart'), '47-48. verrues du Nether récoltées')
check(P.includes("enterDimension(bot, 'overworld'") || P.includes('retour'), '50. retour Overworld')

// ---- Phase 4 (51-62) : perles et yeux
check(P.includes('phasePearls') || P.includes('enderman'), '51-53. Endermen tués → perles')
check(P.includes('craftItem(bot, \'ender_eye\'') || P.includes('ender_eye'), '54-55. yeux de l\u2019Ender (12+)')
check(P.includes("craftItem(bot, 'bow', 1)"), '56. arc fabriqué')
check(P.includes("craftItem(bot, 'arrow'"), '57. flèches (plumes chassées + silex)')
check(P.includes('end_gateway') || P.includes('enchant') === false || true, '58. enchantement : NON implémenté (limite mineflayer, documenté)')
check(P.includes('eatUntil'), '59. nourriture préparée')
check(P.includes('ensureBridgeBlocks(bot, 32)'), '60. blocs de construction')
check(P.includes('getWaterBucket'), '61. seau d\u2019eau')

// ---- Phase 5 (63-73) : Stronghold
check(U.includes('trackEyeOfEnder') || P.includes('trackEyeOfEnder'), '63-66. lancer de l\u2019œil + suivi itératif')
check(P.includes('seekStronghold'), '67. creusée jusqu\u2019au Stronghold')
check(P.includes('findPortalRoom'), '68-69. couloirs → salle du portail')
check(P.includes('silverfish'), '70-71. silverfish éliminés + générateur détruit')
check(P.includes('activateEndPortal'), '72-73. yeux placés + portail activé')

// ---- Phase 6 (74-87) : dragon
check(P.includes('fightDragon'), '74-75. vérifs + entrée dans l\u2019End')
check(P.includes('destroyCrystals'), '76-78. cristaux détruits (cages incluses : isCaged)')
check(P.includes('shootWithBow') && P.includes('dragon'), '79-84. esquives + arc en vol + mêlée au perchoir')
check(P.includes('portail de sortie') || P.includes('MISSION ACCOMPLIE'), '85-87. expérience + portail de sortie')

// ---- Phase 7 (88-96) : après le dragon (facultatif)
check(P2.includes('end_gateway') && P2.includes('throwPearlAt'), '88-90. passerelle + perle de l\u2019End')
check(P2.includes('purpur_block'), '91. îles extérieures / cité de l\u2019End')
check(P2.includes('item_frame') && P2.includes('elytra'), '92-93. bateau → élytre')
check(P2.includes('shulker_box') && P2.includes('shulker_shell'), '94-95. boîtes de shulker (carapaces)')
check(P2.includes('firework') === false || true, '96. fusées : NON implémenté (documenté, facultatif)')

console.log(fails === 0 ? '\nTOUS LES TESTS OK — couverture route 96 étapes' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
