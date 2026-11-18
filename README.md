# 🐉 LibreBot — bot Minecraft autonome 100% hors-ligne

Bot **zéro token, zéro LLM** : du premier arbre jusqu'au dragon de l'End, tout en
code déterministe. Il construit, il craft, il va tuer le dragon tout seul —
**puis il enchaîne 6 ateliers qui chassent les succès (advancements)**.

```
npm install
# édite config.json (host Aternos) puis :
npm start
```

## 📋 Prérequis

- **Node.js ≥ 18** (nodejs.org)
- Un serveur **Minecraft Java 1.21.x à 26.1** — voir « Setup Aternos » et « Compatibilité versions » ci-dessous
- Optionnel : une clé d'API… **non, justement, il n'y en a pas besoin.** 🎉

## 🖥️ Setup Aternos (5 minutes)

1. Crée un serveur Java (Paper recommandé) en **1.21.x ou 26.1** (⚠️ pas 26.2/26.3 pour l'instant — voir la section « Compatibilité versions »).
2. **Options → Cracked : ON** (le bot se connecte en mode offline).
3. **Whitelist : ON** et ajoute ton pseudo **et** `LibreBot` (sinon n'importe qui entre avec n'importe quel pseudo !).
4. **Difficulté : Normale minimum** — sans ça, pas de blazes ni d'endermen, donc pas de fin possible.
5. `view-distance` ≥ 6 (défaut Aternos = OK).
6. Édite `config.json` : mets l'adresse `xxx.aternos.me`, puis `npm start`.

Le bot gère tout le reste : file d'attente Aternos, serveur qui dort, reconnexion auto toutes les 30 s, morts (il repart de zéro en gardant les coordonnées découvertes).

## 🏠 Jouer avec le bot dans ton monde solo (LAN)

Oui, le bot peut te rejoindre dans ton monde solo :

1. Dans ton monde : **Échap → « Ouvrir au réseau local »** (Open to LAN). Note le port annoncé dans le chat (tu peux aussi en fixer un fixe dans les options du LAN).
2. Dans `config.json` : mets `"lan": true` (et laisse `"auth": "offline"` — le serveur LAN accepte les comptes offline).
3. `npm start` **sur la même machine** que le jeu. Le bot lit tout seul le port dans `.minecraft/logs/latest.log` et se connecte à `127.0.0.1:<port>`.

Si le bot tourne sur **un autre PC** du même réseau, ajoute `"lanHost": "192.168.1.x"` (IP de la machine qui héberge le monde). Si aucun monde n'est ouvert au LAN, le bot réessaie toutes les 15 s avec un message explicite. Pour revenir à Aternos : remets `"lan": false`.

Astuce : dans ton monde solo, `/op LibreBot` lui donne les droits d'opérateur (utile pour tester).

## ⚡ Mode rush (speedrun : minimum de ressources)

Mets `"rush": true` dans `config.json` : le bot vise le strict minimum pour tuer le dragon,
le plus vite possible :

- **cibles minimales** : fer 12, diamants 5 (pioche + épée seulement), obsidienne 10 (portail sans les coins), 7 bâtons de blaze, 14 perles, 12 yeux de l'Ender
- **phase 1** : 4 bûches au lieu de 12, outils bois directs
- **phase 2** : 12 cobble (pioche + fourneau), pas les 4 outils en pierre
- **phase 3** : pas d'armure en fer, pas de hache/pelle fer, 16 flèches/torches
- **phase 4** : pas d'armure diamant
- **phase 6** : pas de maison construite
- **fin** : seules les 13 phases de la mission tournent (les 6 ateliers de succès sont sautés)

En mode rush, dis **« baseline »** au bot : il agrège les splits et les morts de tes 30 derniers runs (persistés dans `learning.json`) et liste les phases les plus lentes en premier — moyen direct d'identifier le goulot avant d'optimiser.

## 👁️ Regarder le bot jouer

Le dashboard affiche aussi les **40 dernières lignes du log en direct** (`/api/logs`), la **cible de connexion courante** (LAN/Aternos + fallback), le **streak de morts** et la version du serveur (`/api/state`).

- **Dans ton jeu (recommandé)** : connecte-toi avec ton pseudo, puis :
  ```
  /gamemode spectator TonPseudo
  /spectate LibreBot
  ```
  Tu voles littéralement dans sa tête, en vue première personne.
- **Dans le navigateur** : avec `"viewer": true`, ouvre `http://localhost:3000` (POV + caméra libre).

## 🗨️ Commandes (via `/tell LibreBot <cmd>` ou chat)

| Commande | Effet |
|---|---|
| `stop` / `pause` | met le bot en pause |
| `reprendre` | relance la mission où elle s'était arrêtée |
| `construire` | construit une maison à l'endroit actuel |
| `suivre` / `suivre <pseudo>` | le bot te suit (ou suit le joueur visé) |
| `arrête suivre` / `ne suis plus` | le bot lâche prise et reprend la mission |
| `qui tu suis` | savoir qui le bot suit en ce moment |
| `statut` | avancement de la mission |
| `succès` | bilan complet des advancements (réussis / tentés / restants) |
| `reset` | remet la progression à zéro |
| `mission` / `dragon` | lance la mission si pas déjà lancée |
| `viens` | le bot vient à toi |
| `home` / `base` | le bot retourne à sa maison mémorisée |
| `spawn` | le bot retourne au point de spawn mémorisé |

- **Changer de serveur à chaud** : `lan` (retour au monde solo en LAN), `aternos` (bascule sur Aternos), `serveur <host:port>` (n'importe quel serveur) — le bot se reconnecte tout seul.
- **Fallback automatique** : si le LAN local est fermé (ECONNREFUSED), le bot bascule tout seul sur Aternos, et inversement. Plus besoin de toucher à `config.json` quand un serveur dort.
## 🗺️ La mission (19 phases)

### Mission dragon (phases 1–13)

1. **Bois** — troncs, table de craft, outils en bois, nourriture (et plumes de poulets pour les flèches)
2. **Pierre** — pioche/épée/hache/pelle en pierre, four
3. **Fer** — escalier sécurisé jusqu'à Y=16, minage en branche, fonte, **équipement complet en fer**, bouclier, briquet, 32 flèches
4. **Diamants** — descente à Y=-58, minage en branche, armure + épée + pioche en diamant
5. **Obsidienne** — verse de l'eau sur un lac de lave (méthode du seau)
6. **Base** — remonte à la surface et **construit une maison 5×5** (murs planches, toit cobble, torches)
7. **Portail du Nether** — construit le cadre en obsidienne, l'allume, entre
8. **Forteresse** — exploration du Nether jusqu'à trouver la forteresse
9. **Blazes** — campe le spawner, tue les blazes, 12 bâtons
10. **Endermen** — retour overworld, chasse de nuit jusqu'à ~24 perles
11. **Yeux de l'Ender** — poudre de blaze + perles → yeux
12. **Stronghold** — lance des yeux, triangule, descend, explore les couloirs, remplit le portail
13. **Le dragon** — franchit le vide de l'End, détruit les 10 cristaux (arc pour les libres, cage cassée pour les autres), combat au corps à corps quand le dragon se perche, **victoire**

### Ateliers de succès (phases 14–19)

14. **Aventure Overworld** — lit (Sweet Dreams), champ de blé (A Seedy Place), reproduction des vaches, pêche (Fishy Business), cheval (Best Friends Forever), arbalète (Ol' Betsy), seau de lave (Hot Stuff), ampoule en cuivre (Lighten Up), bloc cible (Bullseye), table d'enchantement, ruche (Bee Our Guest, bloc de miel, Wax On/Off), village (What a Deal!, Hired Help), duel de sniper, chute MLG (Caves & Cliffs)
15. **Tour du Nether** — retour au Nether, les 5 biomes (Hot Tourist Destinations), or aux piglins (Oh Shiny), debris antiques (Hidden in the Depths), magnétite (Country Lode, Take Me Home), ancre de réapparition, ghasts (larmes + longue-vue), crânes de wither (Spooky Scary Skeleton), bastion (War Pigs, Those Were the Days)
16. **Wither & Beacon** — invoque le Wither (T en sable des âmes), le tue, crafte et pose un beacon (Bring Home the Beacon), puis tente la pyramide complète (Beaconator — 164 blocs de fer !)
17. **L'End, acte II** — 4 cristaux de l'End sur la fontaine → **le dragon renaît** (The End… Again…), souffle en bouteille (You Need a Mint), longue-vue sur le dragon (Is It a Plane?), re-combat, œuf au piston (The Next Generation), perle dans la gateway (Remote Getaway) et exploration des îles extérieures (The City at the End of the Game)
18. **Monsters Hunted** — ronde de chasse aux monstres de surface la nuit (zombie, squelette, creeper, araignée, sorcière, slime, noyé, husk, stray…)
19. **Régime équilibré** — chasse/craft/goûte ~32 plats différents (A Balanced Diet)

Chaque tâche est **isolée** : si l'une échoue (pas de village, pas de ruche…), le bot
la marque « tentée » dans `progress.json` et passe à la suivante.

## 🏆 Couverture des 125 succès

| Statut | Nombre | Signification |
|---|---|---|
| ✅ via dragon | ~20 | débloqués par les phases 1–13 |
| 🤖 automatisés | ~13 | ateliers fiables (pêche, lit, blé, cuivre, biomes Nether…) |
| 🎲 tentés | ~59 | automatisés **au mieux** : dépendent de la chance / du seed / de la latence |
| ✋ manuels | ~33 | pas automatisables raisonnablement — liste et tips ci-dessous |

Les 33 succès manuels (à faire à la main, à côté du bot) :

- **How Did We Get Here?** — tous les effets en même temps : quasi impossible à scripter
- **Star Trader** — échange au niveau maximal avec un villageois (trade hall requis)
- **Subspace Bubble** — 1 km en tunnel dans le Nether (long)
- **Two Birds, One Arrow** / **Arbalistic** / **Who's the Pillager Now?** — tirs très précis
- **Zombie Doctor** (soigner un zombie-villageois), **Sneak 100**, **A Furious Cocktail** (toutes les potions), **Postmortal** (totem), **Sound of Music**, **Birthday Song**, **The Whole Pack**, **With Our Powers Combined!** (froglights)…
- Succès de biomes très rares (Deep Dark pour **It Spreads**, trials, vault…)

💡 Le suivi est **persistant** (`progress.json`) : dis `succès` en jeu à tout moment
pour voir le bilan, et le bot ne retente jamais ce qui est déjà réussi.

## 🔢 Compatibilité versions (1.21 → 26.x)

Le bot **détecte automatiquement la version du serveur** (`"version": null` dans
`config.json`) et s'adapte via minecraft-data. Mais la limite vient de
**mineflayer** (la bibliothèque de connexion) :

| Version du serveur | Support | Verdict |
|---|---|---|
| 1.8 → 1.21.x | ✅ officiel | recommandé (testé en 1.21.x) |
| 26.1 | ✅ officiel (mineflayer ≥ 4.39) | OK |
| 26.2 | 🚧 en cours d'intégration en amont | pas encore |
| **26.3** | ❌ protocole 777 non supporté | **le bot ne peut pas se connecter** |

**Si tu veux jouer en 26.3 aujourd'hui** : deux options :
1. **Sur Aternos, choisis 26.1 (ou 1.21.x)** dans les options du serveur — le jeu
   client reste compatible avec ces serveurs.
2. **Attends le support upstream** : suis
   [la PR 26.2](https://github.com/PrismarineJS/mineflayer/pull/3926) et le dépôt
   [PrismarineJS/mineflayer](https://github.com/PrismarineJS/mineflayer) ; quand
   26.3 sort dedans, un simple `npm install` (déjà en `^4.39.0`) récupère la mise
   à jour, sans toucher au code du bot.

Le bot le détecte tout seul : si la version n'est pas supportée, il affiche un
message explicite avec ces deux solutions au lieu d'un crash obscur.

## 🛡️ Robustesse

- **Chaque phase est idempotente** : si tu relances, elle vérifie l'inventaire et ne refait que ce qui manque.
- **À la mort**, l'inventaire est perdu : la mission repart à la phase 1 (rapide, tout se re-crafte) mais **conserve les coordonnées** découvertes (forteresse, stronghold…).
- **3 essais par phase**, puis pause avec message — tu peux intervenir en jeu puis dire `reprendre`.
- Reconnexion automatique (Aternos qui dort ou redémarre).


### 🚨 Watchdog externe (anti-blocage absolu)

Un process séparé (`watchdog.js`) surveille `bot.log` : si le bot n'écrit plus rien depuis **2 min 30**, il le tue et le relance automatiquement. Même une boucle infinie interne ne peut plus bloquer le bot indéfiniment.

### ☠️ Anti-boucle-de-mort

Le bot compte ses morts rapprochées (< 3 min). Au-delà de 2 : **mode panique** — il attend le jour + 45 s avant de respawn (les zombies brûlent au soleil), fuit en sprint à l'opposé des monstres, s'éloigne à 120 blocs avec vérification réelle de la distance, pose des torches, creuse un trou 1x1x2 pour attendre le jour, et ne reprend la mission qu'une fois la zone sûre.

### ⚖️ Garanties anti-cheat (100% légitime)

Aucun mouvement physiquement impossible : pas de fly, pas de téléportation, pas de minage à travers les murs, pas de vitesse surhumaine.

- Tous les déplacements passent par les contrôles vanilla (`forward`/`jump`/`sprint`…) + la **physique serveur** (gravité, collisions, knockback).
- `src/legit.js` vérifie en continu : portée de minage ≤ 4,5 blocs **avec ligne de vue**, portée d'attaque ≤ 3 m, vitesse ≤ 5,612 m/s (sprint vanilla), montée continue > 2 s = vol détecté. Périodes de grâce après le spawn et après chaque coup reçu (knockback).
- Un seul déplacement à la fois (mutex) : le bot ne peut pas oublier d'annuler un mouvement.
## ⚠️ Ce qui peut demander des ajustements

C'est un bot qui joue en conditions réelles ; ces étapes sont les plus fragiles,
surtout sur un serveur avec latence (Aternos) :

| Phase | Risque |
|---|---|
| Obsidienne (eau + lave) | peut nécessiter plusieurs essais si le lac de lave est mal placé |
| Forteresse | rare dans certains seeds : le bot erre jusqu'à 40 cycles |
| Chasse aux endermen | les perles sont le grind le plus long (0–1 perle/tueur) |
| Stronghold | exploration de couloirs approximative |
| Cristaux en cage | le plus délicat : grimper, casser les barreaux, descendre, tirer — prévois quelques morts |
| Combat du dragon | esquive de souffle basique ; en cas de perte, la phase se relance |
| Ateliers de succès | chacun est **isolé** : un échec n'arrête pas la mission, il est marqué « tenté » et le bot continue |
| Wither / Beaconator | combats coûteux : crânes (2,5% de drop) et 164 blocs de fer peuvent prendre très longtemps |
| End acte II | la pose des cristaux et l'œuf au piston sont du best-effort : essaie à la main si le bot échoue |

En cas de pépin, lis la console (les logs expliquent tout), dis `statut` en jeu,
et n'hésite pas à redire `reprendre`. Le fichier `progress.json` garde l'état.

## 🧩 Config (`config.json`)

```json
{
  "host": "ton-serveur.aternos.me",
  "username": "LibreBot",
  "viewer": true,
  "autoMission": true,
  "targets": { "rawIron": 48, "diamonds": 32, "obsidian": 14, "blazeRods": 12, "enderPearls": 24, "enderEyes": 24 }
}
```

- Nouvelles clés : `"fallback": true` (bascule auto LAN ↔ Aternos si un serveur est down), `"aternosHost"` / `"aternosPort"` (cible de secours, ex. `Robinsonx.aternos.me:61339`), `"lanPort"` (port LAN fixe, prioritaire sur la lecture des logs).
## ⚖️ Licence

MIT — fais-en ce que tu veux. Amuse-toi bien 🐲
