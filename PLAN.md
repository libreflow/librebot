# 🔍 Audit LibreBot + Plan d'amélioration

Audit statique réalisé **sans lancer le bot**, avec vérification des signatures contre :

- **Documentation officielle mineflayer** : `PrismarineJS/mineflayer` — `docs/api.md`, `index.d.ts` (github.com/PrismarineJS/mineflayer)
- **Code source des dépendances installées** (`node_modules`) : `mineflayer-collectblock/lib/BlockVeins.js`, `mineflayer-pathfinder/lib/movements.js`, `minecraft-data/data/pc/26.1/protocol.json`, `prismarine-block/index.js`, `mineflayer/lib/plugins/{craft,physics,entities,bed,villager,enchantment_table}.js`
- **Minecraft Wiki / wiki.vg** : temps de minage (obsidienne = 9,4 s pioche diamant, hardness 50), forme d'invocation du Wither, protocole 1.21.2+ (`player_input` = bitmask u8, `client_command.actionId`, un paquet de mouvement par tick)

---

## ✅ Bugs corrigés dans cet audit

| # | Fichier | Bug | Gravité | Référence |
|---|---------|-----|---------|-----------|
| 1 | `src/utils.js` `digBlock` | Timeout plafonné à `min(timeoutMs, 4000)` → **obsidienne inminable** (9,4 s requis). Le `bot.dig()` continuait en arrière-plan après le timeout → double minage, drops non comptés. Corrigé : timeout adaptatif `hardness × 1,5 s + marge`, plancher = timeout demandé, plafond 30 s. | 🔴 critique | Minecraft Wiki (hardness 50) ; test mock : dig de 9,4 s laisse passer ✓ |
| 2 | `src/utils.js` (×2) | `findFromVein(bot, block, 8, 16, 1)` : **arguments inversés**. Signature réelle : `(bot, block, maxBlocks, maxDistance, floodRadius)`. Corrigé en `(bot, block, 16, 8, 1)` et `(bot, block, 24, 12, 1)`. | 🔴 fonctionnel | `node_modules/mineflayer-collectblock/lib/BlockVeins.js:4` ; test mock : 13 blocs à maxDistance 12 ✓ |
| 3 | `src/learn.js` `getSimilarEpisodes` | `matches.push(ep, score)` poussait 2 éléments séparés et le tri utilisait `.similarity` (inexistant) → tri cassé, moitié des entrées inutilisables, mémoire épisodique inopérante. Corrigé : `push({ ...ep, similarity: score })`. | 🔴 fonctionnel | test API publique : 5 épisodes → 5 résultats triés, `bestAction` OK ✓ |
| 4 | `src/index.js` | **Fuite de timers à chaque reconnexion** : le `setInterval` de 10 s (POIs map) n'était jamais stocké ni nettoyé ; `bot._visionTimer = vision._scanTimer` valait `undefined` (`_scanTimer` non exporté). Corrigé : `bot._poiTimer` stocké + nettoyé dans `end` ; `bot._visionTimer = vision.startVision(...)`. | 🟠 fuite mémoire | code source vision.js (exports) |
| 5 | `src/phases.js` `safeDescend` | `placeSafe(bot, side, new Vec3(0, 0, 0))` : faceVector **(0,0,0) invalide**, le placement échouait toujours. Corrigé : face cardinale calculée depuis l'axe dominant bot→bloc. | 🟠 fonctionnel | mineflayer `docs/api.md` : faceVector = une des 6 directions cardinales |
| 6 | `src/utils.js` `makeObsidian` | Visait `lave + 2 blocs` → l'eau ne touchait jamais la source. Corrigé : `lookAt` sur la lave + `actBlock` (clic sur la source avec le seau d'eau = obsidienne directe), repli `actItem`. | 🟠 fonctionnel | mécanique vanilla (eau sur lave source → obsidienne) |
| 7 | `src/phases2.js` Wither | Structure en **croix 3D** (3 soul_sand au niveau 1) → le Wither ne spawnait jamais. Corrigé : **T vanilla** = 4 soul_sand au sol (3 en ligne + 1 au centre) + 3 crânes au niveau 1. | 🟠 fonctionnel | Minecraft Wiki (Wither spawning) ; test de forme ✓ |
| 8 | `src/mission.js` `runMission` | `fromStart ? { done: [] }` écrasait `progress.json` (perte de `deathPos`, `home`, coordonnées forteresse/stronghold). Corrigé : `{ ...loadProgress(), done: [] }`. | 🟠 perte de données | — |
| 9 | `src/phases.js`, `src/build.js`, `src/phases2.js` | `findBlock({ matching: undefined })` si le bloc n'existe pas dans la version → **matche tous les blocs** → cible aléatoire (portail, forteresse, spawner…). Corrigé : helper `blockId(bot, name)` + guards sur tous les appels exposés. | 🟡 robustesse | comportement `bot.findBlock` (matching undefined = tout) |
| 10 | `src/utils.js` `setMovements` | `movements.maxDropHeight = 4` : **propriété inexistante** dans mineflayer-pathfinder 2.4.5 → silencieusement ignorée. Retirée + commentée (protection chute déjà assurée par le watchdog de survie). | 🟡 config inopérante | `node_modules/mineflayer-pathfinder/lib/movements.js` (absente) |
| 11 | `src/utils.js` `craftItem` | `md.items[ing.id]` rendu robuste : `itemsById` prioritaire, fallback array/objet selon la version de minecraft-data. | 🟡 portabilité | `minecraft-data` 1.21.4 : `items` = objet keyed-by-id |
| 12 | divers | Commentaire en chinois dans `vision.js` nettoyé ; import `autofarm` mort retiré dans `index.js`. | 🟢 cosmétique | — |

**Vérifications effectuées et OK** (pas de bug) : `player_input` avec objet `inputs` (sérialisé en bitmask u8 par minecraft-protocol, identique au code interne de mineflayer `physics.js:265`) ; `client_command { actionId: 0 }` (champ correct en 26.1) ; exports des plugins (`autoEat.loader`, `auto-totem.autototem`, `hawkeye.default`, `tool.plugin`, `armorManager`, `collectBlock.plugin`, `pvp.plugin`) ; `recipesFor(itemType, metadata, minResultCount, craftingTable)` ; `containerItems()` / `withdraw(type, null, count)` ; `villager.trade(index)` ; `furnace.putInput/putFuel/takeOutput` ; `enchantmentTable.enchantments` + `enchant(choice)` ; `bot.sleep/wake` ; `block.light` ; `md.items[id]` en 1.21.4.

**Validation** : `node --check` sur les 21 fichiers ✓ — chargement de tous les modules (hors `index.js`) ✓ — tests unitaires avec mock bot (digBlock 9,4 s, getSimilarEpisodes, findFromVein, forme Wither) ✓.

---

## 🔬 Passe 2 — audit statique avancé (cross-références, événements, API, logique)

Méthodologie : scripts d'analyse statique sur `src/` + vérification systématique contre `node_modules` (mineflayer, pathfinder, collectblock, pvp, auto-eat v5, prismarine-world/entity/block/windows, minecraft-data 1.20.4/1.21.4/26.1) et la doc officielle.

### Nouveaux bugs corrigés

| # | Fichier | Bug | Gravité | Référence |
|---|---------|-----|---------|-----------|
| 13 | `src/index.js` | `bot.on('damage', …)` — **événement inexistant** dans mineflayer (`entityHurt` est émis à la place) → `reactDamage()` (soin d'urgence/fuite instantanée) et `legit.noteKnockback()` ne se déclenchaient **jamais**. Corrigé : `bot.on('entityHurt')` filtré sur `entity.id === bot.entity.id`. | 🔴 critique (survie) | `mineflayer/lib/plugins/entities.js:384` (`bot.emit('entityHurt', entity, source)`) |
| 14 | `src/index.js` | `bot.autoEat.options = …` — en auto-eat **v5** les options sont dans `bot.autoEat.opts` (+ méthode `setOpts()`), `.options` est `undefined` → la config (minHunger 17…) était **silencieusement ignorée**. Corrigé : `setOpts()` / `opts` / fallback v3. | 🟠 config ignorée | `mineflayer-auto-eat/dist/new.js` (`this.opts`, `setOpts`) |
| 15 | `src/vision.js` | `bot.world.getBiome(pos)` est **async** (prismarine-world) → `String(Promise)` = `"[object Promise]"` : le biome affiché/enregistré était toujours cassé et le fallback par blocs ne se déclenchait jamais. Corrigé : consommation de la promesse + fallback synchrone. Test mock : biome `plains` ✓ | 🟠 fonctionnel | `prismarine-world/src/world.js:253` (`async getBiome`) |
| 16 | `src/vision.js` | Marqueur `hay_bale` — **n'existe dans aucune version** (c'est `hay_block`) → détection des villages affaiblie. Corrigé. | 🟡 | minecraft-data 1.20.4 & 1.21.4 |
| 17 | `src/utils.js` | `FLUIDS` contenait `flowing_water`/`flowing_lava` — **supprimés depuis le Flattening (1.13)** (ce sont des états `level` de water/lava). Nettoyé (le `includes('water'/'lava')` couvrait déjà). | 🟡 | minecraft-data |
| 18 | `src/craftplanner.js` | `disc_fragment` n'existe pas (c'est `disc_fragment_5`). Corrigé. | 🟢 | minecraft-data |
| 19 | `src/phases.js` ×2, `src/phases2.js` | Boucles de chute `while (y - ground > 10 && vel < 0)` **sans garde temporelle** → boucle infinie si le bot est bloqué mid-air. Corrigé : timeouts 15–20 s. | 🟠 blocage potentiel | — |
| 20 | `src/phases.js`, `src/phases2.js`, `src/utils.js` | `GoalNear(…, 0)` pour entrer dans les portails — range 0 = position exacte, souvent inatteignable contre un mur → téléportation jamais atteinte. Corrigé : range 0,5. | 🟠 fonctionnel | pathfinder `goals.js` |
| 21 | `src/phases.js` `phaseEyes` | `craftItem('blaze_powder', enderEyes + 2)` : avec 12 rods (24 poudres max) et 24 yeux + 2 = 26 poudres → `blaze_rod` est dans `NOT_CRAFTABLE` → **throw systématique**. Corrigé : calcul depuis l'inventaire réel (`poudres dispo + rods × 2`). | 🔴 logique | recette blaze_powder (1 rod → 2) |
| 22 | `src/mission.js` `reset` | `saveProgress({ done: [] })` — même bug que `fromStart` : écrasait `deathPos`/`home`/coords. Corrigé. | 🟠 perte de données | — |
| 23 | `src/survie.js` + `src/index.js` | `_panicTimer` (400 ms) jamais arrêté à la déconnexion si dernière vie < 17 → fuite de timer. Corrigé : `stopPanic()` exporté, appelé dans `bot.on('end')`. | 🟡 fuite | — |
| 24 | `src/index.js` | `smartRespawn()` appelé sans `.catch()` (promesse flottante). Corrigé. | 🟢 | — |
| 25 | `src/skills.js` `goldToPiglin` | minage de l'or du Nether à **Y=100** (toit rocheux, quasi rien) → Y=32 (pic réel de `nether_gold_ore`). | 🟡 perf | Minecraft Wiki (génération nether_gold_ore : Y 10–117, pic ~30) |
| 26 | `.gitignore` | manquait `worldmap.json`, `.bot.lock`, `.watchdog.lock`, `nul`, scripts d'audit. Corrigé. | 🟢 | — |

### Vérifié OK (pas de bug) lors de cette passe

- Tous les imports/exports cross-modules (20 modules) — script de cross-check ✓
- Toutes les méthodes `bot.xxx()` appelées existent dans mineflayer/plugins ✓
- Toutes les propriétés `bot.xxx` utilisées (hors `bot._*` internes) ✓
- Événements `bot.on(...)` : tous émis sauf `damage` (corrigé) — `spawn/death/chat/whisper/kicked/error/end/physicsTick/blockUpdate/soundEffectHeard/playerCollect` ✓
- `client_command { actionId: 0 }` : champ correct dans toutes les versions 1.20+ ✓ (protocol.json)
- `player_input { inputs: {...} }` : sérialisé en bitmask u8 par minecraft-protocol (identique au code interne mineflayer) ✓
- `hawkEye.oneShot(target, 'bow')` : `Weapons.bow === "bow"` ✓
- `pvp.attack/stop/target`, `pathfinder.isMoving/isBuilding/setGoal/goto/setMovements/thinkTimeout/tickTimeout`, `clearControlStates`, `tossStack`, `useOn`, `mount/dismount`, `collectBlock.movements`, `armorManager.equipAll`, `autototem.equip`, `tool.equipForBlock` ✓
- Noms de blocs/items/entités en chaînes : tous valides en 1.21.4 sauf ceux corrigés (hay_bale, flowing_*, disc_fragment, obsidian_crying) ✓
- Pas d'appels flottants de fonctions async (hors `smartRespawn`, corrigé) ✓
- Pas de `await` manquant sur `findGroundBelow` ✓ ; pas de NaN dans les `normalize()` (guards `lengthSq`) ✓

### Code mort / API non câblées (à brancher ou retirer — cf. plan)

`decision.arbitrate`, `map.recordPath/pathReliability`, `utils.sortInventory/dropJunk`, `autofarm.startAutoFarm`, `learn.nearestDangerSpatial/bestResourceNear/spatialInRadius/pruneSpatial/skillLevel/getFleeThreshold/resetExplore/getDiscoveries`, `craftplanner.executePlan`, `_moveAbort` (jamais mis à true).

---

## 🔎 Passe 3 — rapide (dernier sweep)

- **26bis** `config.example.json` : clés utilisées mais non documentées (`lanHost`, `lanPort`, `fallback`, `aternosHost`, `aternosPort`) → ajoutées. `config.json` inchangé (local, gitignoré).
- Vérifié et **OK** : aucun appel `bot.xxx()` flottant sans `try/catch` restant ; `filter(Boolean)` jamais appliqué à un id 0 recherché ; accès indexés (`spots[0]`, `similar[0]`, `p.home[0]`…) tous guardés ; `config.targets.*` (rawIron/diamonds/obsidian/blazeRods/enderPearls/enderEyes) tous présents dans example et cohérents (12 rods = 24 poudres = 24 yeux, pile ce que demande `phaseEyes` corrigée) ; `bot.chat`/`bot.quit` flottants dans des `try/catch` intentionnels.
- Validation : `node --check` 21/21 ✓, 20/20 modules ✓, `config.example.json` JSON valide ✓.

---

## 🗺️ Plan d'amélioration

### Court terme (cette semaine)
1. **Tests d'intégration hors-ligne** : créer `test/` avec un mock bot (comme ceux de cet audit : digBlock, getSimilarEpisodes, findFromVein, getBiome, forme Wither) pour couvrir `craftItem`, `smeltItem`, `placePlan`, `walkDirect` — rejouable en CI sans serveur Minecraft.
2. **Activer l'auto-farm** : `autofarm.startAutoFarm(bot)` jamais appelé — le lancer après la phase base pour une source de nourriture infinie.
3. **Corriger `sortInventory`** : `bot.equip(item, 'hand')` en boucle ne remplit pas la hotbar (ne change que la main). Utiliser `bot.moveSlot(src, dst)` (prismarine-windows) pour réorganiser les slots 36–44.
4. **Guard générique** : remplacer tous les `bot.findBlock({ matching: X?.id })` restants (skills.js : eau, cloche, citrouille) par `blockId()`.
5. **Brancher ou retirer le code mort** listé dans la passe 2 (ex: `getFleeThreshold` devrait piloter le seuil de fuite de `reactDamage` ; `arbitrate` devrait décider mission vs survie).

### Moyen terme (ce mois)
6. **Q-learning réel** : `decision.js` enregistre un seul `_pendingEpisode` — le remplacer par une file (FIFO) pour ne plus perdre d'épisodes quand `evaluate()` est appelé 2× rapidement (watchdog survie + mission). Implémenter aussi l'**exploration ε-greedy** sur les actions (aujourd'hui le Q-bonus est consulté mais l'action gagnante est toujours la règle dure). **Brancher `entityHurt` dans l'apprentissage** : chaque dégât reçu = reward négatif pour l'action en cours (le handler existe maintenant, il faut l'exploiter).
7. **Biome async propre** : `vision.scan` est synchrone mais `getBiome` est async — mettre le vrai biome à jour via promesse (fait) puis **mettre en cache par chunk** pour éviter un appel async par scan.
7. **Minage ciblé par `digTime`** : remplacer l'estimation `hardness × 1,5 s` par `block.digTime(heldItem.type, false, inWater, !onGround, enchants, effects)` de prismarine-block (réf. `AbstractBlock#calcBlockBreakingDelta`), avec correction du matériau 1.21.2+ (`incorrect_for_wooden_tool` fausse le calcul — à calibrer contre le wiki).
8. **Pathfinder : éviter les trous profonds** — `maxDropHeight` n'existant plus, ajouter un coût personnalisé : surcharger `movements` pour pénaliser les nœuds avec > 3 blocs de vide dessous (inspiré de `blocksToAvoid` / `gravityBlocks`).
9. **Retry exponentiel sur `goTo`** : quand le pathfinder échoue 2×, insérer une étape intermédiaire aléatoire (±8 blocs) avant de réessayer, au lieu du même goal.
10. **Dashboard : historique** — garder un ring buffer des 200 dernières décisions (`bot._lastDecision`) pour tracer les oscillations FUITE/COMBAT.

### Long terme
11. **Stratégie de minage par veine orientée** : au lieu de tunnels aléatoires (4 directions), miner en grille 3×3 (méthode vanilla optimale pour les diamants à Y=-58) avec priorité aux blocs exposés.
12. **Combat du dragon robuste** : cristaux en cage → pillar jusqu'au niveau du cristal **puis** casser les barreaux **puis** tirer ; ajouter l'usage du lit/respawn anchor et la pose de blocs de dégagement autour de la fontaine.
13. **Économie villageois** : boucler `tryTrade` sur plusieurs échanges (pas un seul) pour farmer les enchantements (Mending) avant le dragon.
14. **Auto-équipement par situation** : `armorManager.equipAll()` périodique existe, mais ajouter un profil « combat » (armure + totem + épée) vs « minage » (pioche + torches) selon la phase courante.
15. **Métriques de fiabilité** : persister dans `learning.json` le taux de réussite par phase **par biome/dimension** (ex: `diamant@plains` vs `diamant@mountains`) pour ajuster les stratégies.
16. **Support multi-version** : config `version: "1.20.4"` fixe — tester la matrice 1.20.4 / 1.21.4 / 26.1 en CI avec un serveur local vanilla lancé en subprocess.

---

## 📚 Références utilisées (fiables, spécialisées bots Minecraft)

- **mineflayer (officiel)** : https://github.com/PrismarineJS/mineflayer — `docs/api.md`, `docs/tutorial.md`, `index.d.ts`, `examples/` (chest.js, sleeper.js, digger.js)
- **mineflayer-pathfinder** : https://github.com/PrismarineJS/mineflayer-pathfinder — `lib/movements.js` (options `Movements`), `index.d.ts`
- **mineflayer-collectblock** : https://github.com/PrismarineJS/mineflayer-collectblock — `lib/BlockVeins.js` (`findFromVein`)
- **minecraft-data / protocole** : `node_modules/minecraft-data/data/pc/26.1/protocol.json`, https://wiki.vg/Protocol
- **Minecraft Wiki** : https://minecraft.wiki — temps de minage (Obsidian, Breaking), invocation du Wither, portails
- **prismarine-block** : `digTime()` / `canHarvest()` (réf. `AbstractBlock#calcBlockBreakingDelta`)
