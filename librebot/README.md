# 🐉 LibreBot — bot Minecraft autonome 100% hors-ligne

Bot **zéro token, zéro LLM** : du premier arbre jusqu'au dragon de l'End, tout en
code déterministe. Il construit, il craft, et il va chercher le dragon tout seul.

```
npm install
# édite config.json (host Aternos) puis :
npm start
```

## 📋 Prérequis

- **Node.js ≥ 18** (nodejs.org)
- Un serveur **Minecraft Java** (testé pour 1.21.x) — voir « Setup Aternos » ci-dessous
- Optionnel : une clé d'API… **non, justement, il n'y en a pas besoin.** 🎉

## 🖥️ Setup Aternos (5 minutes)

1. Crée un serveur Java (Paper recommandé) en **1.21.x**.
2. **Options → Cracked : ON** (le bot se connecte en mode offline).
3. **Whitelist : ON** et ajoute ton pseudo **et** `LibreBot` (sinon n'importe qui entre avec n'importe quel pseudo !).
4. **Difficulté : Normale minimum** — sans ça, pas de blazes ni d'endermen, donc pas de fin possible.
5. `view-distance` ≥ 6 (défaut Aternos = OK).
6. Édite `config.json` : mets l'adresse `xxx.aternos.me`, puis `npm start`.

Le bot gère tout le reste : file d'attente Aternos, serveur qui dort, reconnexion auto toutes les 30 s, morts (il repart de zéro en gardant les coordonnées découvertes).

## 👁️ Regarder le bot jouer

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
| `suivre` | le bot te suit |
| `statut` | avancement de la mission |
| `reset` | remet la progression à zéro |
| `mission` / `dragon` | lance la mission si pas déjà lancée |

## 🗺️ La mission (13 phases)

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

## 🛡️ Robustesse

- **Chaque phase est idempotente** : si tu relances, elle vérifie l'inventaire et ne refait que ce qui manque.
- **À la mort**, l'inventaire est perdu : la mission repart à la phase 1 (rapide, tout se re-crafte) mais **conserve les coordonnées** découvertes (forteresse, stronghold…).
- **3 essais par phase**, puis pause avec message — tu peux intervenir en jeu puis dire `reprendre`.
- Reconnexion automatique (Aternos qui dort ou redémarre).

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

## ⚖️ Licence

MIT — fais-en ce que tu veux. Amuse-toi bien 🐲
