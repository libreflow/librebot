// ============================================================
// LibreBot — src/mission.js
// Orchestrateur : séquence de phases, progression persistante,
// gestion des morts, commandes chat.
// ============================================================
const { log, say, chat, proactive, announce, sleep, goTo, GoalFollow, GoalNear, GoalXZ, GoalY, GoalBlock, Vec3, countItem, isSolidBlock, hasAnyItem, withTimeout, eatUntil, pillarUp, equipName, equipBestSword, collectNearbyItems, isItemDrop, lootNearbyChests } = require('./utils')

// helpers locaux (évite un cycle d'import avec survie.js)
const isNight = (bot) => { const t = bot.time?.timeOfDay ?? 0; return t >= 13000 && t <= 23000 }
const MELEE_WEAPONS = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword',
  'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'mace', 'trident']
// un seul parcours d'inventaire pour bow+arrow+toutes les armes de mêlée
// (l'ancien hasWeapon faisait jusqu'à 11 countItem = 11 parcours complets)
const hasWeapon = (bot) => {
  let bow = 0, arrow = 0
  const set = new Set(MELEE_WEAPONS)
  for (const i of bot.inventory.items()) {
    if (i.name === 'bow') bow += i.count
    else if (i.name === 'arrow') arrow += i.count
    else if (set.has(i.name)) return true
  }
  return bow > 0 && arrow > 0
}
const P = require('./phases')
const P2 = require('./phases2')
const advancements = require('./advancements')
const learn = require('./learn')
const decision = require('./decision')
const speedrun = require('./speedrun')
let vision = null
try { vision = require('./vision') } catch {}

// progress.json a UN SEUL écrivain : advancements.js (cache + debounce).
// Avant, mission.js écrivait le fichier en direct avec fs, ce qui pouvait écraser
// les "adv" écrits par advancements.js entre-temps (ou l'inverse) → perte de données.
const { loadProgress, saveProgress } = advancements

const PHASES = [
  { key: 'bois', label: 'Bois & outils', run: P.phaseWood },
  { key: 'pierre', label: 'Pierre', run: P.phaseStone },
  { key: 'fer', label: 'Fer', run: P.phaseIron },
  { key: 'diamant', label: 'Diamants', run: P.phaseDiamond },
  { key: 'obsidienne', label: 'Obsidienne', run: P.phaseObsidian },
  { key: 'base', label: 'Construction de la base', run: P.phaseBase },
  { key: 'nether', label: 'Portail du Nether', run: P.phaseNether },
  { key: 'forteresse', label: 'Forteresse', run: P.phaseFortress },
  { key: 'blazes', label: 'Chasse aux blazes', run: P.phaseBlaze },
  { key: 'perles', label: 'Chasse aux endermen', run: P.phasePearls },
  { key: 'yeux', label: 'Yeux de l\'Ender', run: P.phaseEyes },
  { key: 'stronghold', label: 'Stronghold & portail', run: P.phaseStronghold },
  { key: 'dragon', label: 'Le dragon', run: P.phaseDragon },
  // ----- Ateliers de succès (v2) -----
  P2.wAventureOverworld(),
  P2.wNether(),
  P2.wWitherBeacon(),
  P2.wEndAgain(),
  P2.wMonsters(),
  P2.wDiet()
]

// ---------- Progression persistante ----------
// loadProgress / saveProgress viennent d'advancements.js (voir plus haut)

// À la mort, l'inventaire est perdu : on repart des phases de base,
// mais on garde les coordonnées découvertes (forteresse, stronghold…).
// On mémorise aussi le lieu de la mort pour s'en éloigner au respawn.
function handleDeath (bot) {
  const p = loadProgress()
  p.done = []
  if (bot?.entity?.position) {
    const pos = bot.entity.position.floored()
    p.deathPos = { x: pos.x, y: pos.y, z: pos.z }
  }
  // streak de morts rapprochées (< 3 min) : déclenche le mode panique au respawn
  const now = Date.now()
  p.deaths = (p.deaths ?? []).filter((d) => now - d.t < 180000)
  const cause0 = learn.detectDeathCause(bot)
  p.deaths.push({ t: now, cause: cause0 })
  state.deathStreak = p.deaths.length
  saveProgress(p)
  const cause = cause0
  learn.recordDeath(cause, bot)
  speedrun.noteDeath(log) // le chrono speedrun continue malgré la mort
  chat(bot, 'death', { cause }, { force: true })
  log('☠️ Mort détectée (cause apprise : ' + cause + ') : progression remise à zéro (coordonnées conservées)' + (state.deathStreak >= 2 ? ' — STREAK x' + state.deathStreak + ', mode panique au respawn' : ''))
}

// Mode panique après plusieurs morts rapprochées : on s'éloigne VRAIMENT du lieu
// de mort (vérification de distance), on nettoie les hostiles proches, on pose des
// torches, et on attend le calme avant de reprendre. Sinon le bot meurt en boucle
// au même endroit (vu en prod : morts en rafale contre un zombie au respawn).
async function fleeDeathSpot (bot) {
  const p = loadProgress()
  const streak = state.deathStreak ?? (p.deaths ?? []).length
  if (!p.deathPos) return
  const deathPos = new Vec3(p.deathPos.x, p.deathPos.y, p.deathPos.z)
  const pos = bot.entity?.position
  if (!pos) return
  const d0 = pos.distanceTo(deathPos)
  if (d0 >= 100 && streak < 2) { delete p.deathPos; saveProgress(p); return }
  log('☠️ Fuite du lieu de mort (' + Math.round(d0) + ' blocs' + (streak >= 2 ? ', streak x' + streak : '') + ')')
  // 1. pas d'attente au respawn : chaque seconde compte face à un mob (sprint max)
  try { bot.setControlState("sprint", true) } catch {}
  // 2. si des hostiles sont proches, les tuer (combat) plutôt que fuir en ligne droite
  try {
    const { fightSmart, nearestHostile } = require('./survie')
    const hostile = nearestHostile(bot, 30)
    if (hostile) {
      log("⚔️ Hostile à proximité au respawn — je le combats d'abord")
      await withTimeout(fightSmart(bot, hostile), 30000).catch(() => {})
    }
  } catch {}
  // 3. FUITE PANIC immédiate : 15s de sprint en ligne droite à l'opposé des
  // hostiles proches (walkDirect only, pas de pathfinder qui mettrait 20s à calculer)
  try {
    const { nearestHostile } = require('./survie')
    const { walkDirect } = require('./utils')
    // sprint continu 25 s à l'opposé du centroid des hostiles (walkDirect only,
    // pas de pathfinder qui mettrait 20 s à calculer pendant qu'on se fait taper)
    for (let i = 0; i < 3; i++) {
      const h = nearestHostile(bot, 24)
      if (!h) break
      const dir = bot.entity.position.minus(h.position)
      if (dir.lengthSq() < 0.001) break
      dir.normalize()
      const away = bot.entity.position.plus(dir.scale(60))
      log('🏃 FUITE PANIC de ' + h.name + ' (' + Math.round(h.position.distanceTo(bot.entity.position)) + ' blocs) — sprint 25s')
      await walkDirect(bot, away.x, bot.entity.position.y, away.z, { range: 2, timeoutMs: 25000, ignoreFlee: true }).catch(() => {})
      if (!nearestHostile(bot, 12)) break
    }
  } catch {}
  // puis s'éloigner à 120 blocs, avec VÉRIFICATION de la distance atteinte (max 3 essais)
  {
    const { goTo } = require('./utils')
    const { goals: { GoalXZ } } = require('mineflayer-pathfinder')
    let okFlee = false
    for (let i = 0; i < 3 && !okFlee; i++) {
      const ang = Math.random() * Math.PI * 2
      const target = pos.offset(Math.cos(ang) * 120, 0, Math.sin(ang) * 120)
      await goTo(bot, new GoalXZ(target.x, target.z), { timeout: 60000, retries: 1 }).catch(() => {})
      okFlee = bot.entity.position.distanceTo(deathPos) > 80
      if (!okFlee) log('⚠️ Encore trop proche du lieu de mort (' + Math.round(bot.entity.position.distanceTo(deathPos)) + ' blocs) — je réessaie')
    }
  }
  // 4. poser des torches autour si on en a (les mobs n'apparaissent pas à la lumière)
  try {
    const torches = bot.inventory.items().filter((it) => it.name === 'torch')
    if (torches.length >= 4) {
      const { placeBlockFromInventory } = require('./utils')
      for (let i = 0; i < 4; i++) {
        await placeBlockFromInventory(bot, 'torch').catch(() => {})
        await sleep(300)
      }
      log('🔥 Torches posées autour de moi')
    }
  } catch {}
  // 5. attendre le calme : aucun hostiles à 24 blocs pendant 15s (max 60s)
  const t0 = Date.now()
  let calmSince = Date.now()
  while (Date.now() - t0 < 60000) {
    await sleep(2000)
    const hostile = require('./survie').nearestHostile(bot, 24)
    if (hostile) calmSince = Date.now()
    else if (Date.now() - calmSince > 15000) break
  }
  delete p.deathPos
  p.deaths = []
  state.deathStreak = 0
  saveProgress(p)
  log('✅ Zone sûre atteinte, lieu de mort oublié')
}

// Récupère le stuff laissé au sol après une mort (les drops despawnent après 5 min).
// S'équipe de la meilleure arme/armure d'abord, puis va ramasser les drops proches
// du lieu de mort. Appelé au respawn AVANT la fuite (seulement si pas en panique).
async function recoverStuff (bot, { maxDist = 64, maxMs = 90000 } = {}) {
  const p = loadProgress()
  if (!p.deathPos) return 0
  const deathPos = new Vec3(p.deathPos.x, p.deathPos.y, p.deathPos.z)
  // 1. s'équiper : meilleure épée + toute l'armure dispo
  try { await equipBestSword(bot) } catch {}
  try { bot.armorManager?.equipAll?.() } catch {}
  // 2. lister les drops proches du lieu de mort (ou du bot)
  const ref = bot.entity?.position ?? deathPos
  const drops = []
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!isItemDrop(e) || e.isValid === false || !e.position) continue
    const d = e.position.distanceTo(ref)
    if (d < maxDist) drops.push({ e, d })
  }
  drops.sort((a, b) => a.d - b.d)
  if (!drops.length) { log('📦 Aucun drop à proximité du lieu de mort'); return 0 }
  log("📦 " + drops.length + " drop(s) à récupérer près du lieu de mort — j'y vais (arme équipée)")
  // 3. y aller et ramasser (max 8 drops, 90 s au total)
  const t0 = Date.now()
  let got = 0
  for (const { e } of drops.slice(0, 8)) {
    if (Date.now() - t0 > maxMs) break
    if (e.isValid === false) continue
    await goTo(bot, new GoalNear(e.position.x, e.position.y, e.position.z, 1.5), { timeout: 15000, retries: 0 }).catch(() => {})
    const before = Object.keys(bot.entities).length
    await collectNearbyItems(bot, 10, 4000).catch(() => {})
    if (e.isValid === false) got++
    if (Date.now() - t0 > maxMs) break
  }
  log('📦 Stuff récupéré : ~' + got + ' drop(s) ramassé(s)')
  return got
}

// Sécurité post-mort : si le bot meurt en boucle (streak >= 2), attendre le jour
// dans une alcôve creusée (fonctionne même sans inventaire lisible) avant de
// reprendre quoi que ce soit. La nuit au milieu des mobs = mort assurée sans arme.
async function waitSafe (bot) {
  const streak = state.deathStreak ?? 0
  if (streak < 2) return
  const { isNight } = require('./survie')
  // De jour aussi : un trou 1x1x2 rend le bot invincible (les mobs ne peuvent ni
  // tomber dedans ni attaquer à travers). Prioritaire sur l'attente du jour.
  if (streak >= 2) {
    // creuser VERS LE BAS dès maintenant (déjà fait plus bas dans la fonction)
  } else if (!isNight(bot)) { state.deathStreak = 0; return }
  log("🌙 Nuit + streak de morts x" + streak + " — je me cache et j'attends le jour")
  // creuser VERS LE BAS : trou 1x1x2, le bot au fond est inaccessible aux mobs
  // (un zombie en surface ne peut ni tomber dans un trou 1x1 ni attaquer à travers)
  try {
    const { digBlock } = require('./utils')
    const pos = bot.entity.position.floored()
    for (const dy of [-1, -2]) {
      const blk = bot.blockAt(pos.offset(0, dy, 0))
      if (isSolidBlock(blk) && blk.name !== 'bedrock' && !blk.name.includes('ore')) {
        await digBlock(bot, blk, 6000).catch(() => {})
      }
    }
    log("🕳️ Trou 1x1 creusé sous moi, j'attends le jour au fond…")
  } catch {}
  // attendre le jour (max 12 min), sortir brièvement si un hostile entre
  const t0 = Date.now()
  while (Date.now() - t0 < 12 * 60000) {
    await sleep(5000)
    if (!isNight(bot)) break // de jour on sort du trou directement
    const { nearestHostile, fightSmart } = require('./survie')
    const h = nearestHostile(bot, 10)
    if (h) { log("⚔️ " + h.name + " dans l'alcôve — attaque au corps à corps"); await withTimeout(fightSmart(bot, h), 15000).catch(() => {}) }
  }
  state.deathStreak = 0
  const p = loadProgress(); p.deaths = []; saveProgress(p)
  log('☀️ Jour levé (ou attente terminée) — zone reprise')
}

// ---------- État global ----------

const state = {
  paused: false,
  running: false,
  currentPhase: null, // clé de la phase en cours (contexte pour le cerveau de décision)
  followTimer: null,
  following: null, // pseudo du joueur suivi (null = personne)
  bot: null
}

// Mode rush / speedrun (cfg.rush = true) : cibles minimales d'un any% legit.
// fer 8 (seau 3 + pioche fer 3 + épée 2), diamants 5 (pioche 3 + épée 2),
// obsidienne 10 (portail sans les 4 coins — autorisé en vanilla), blaze 7 bâtons
// (14 poudres → 12 yeux + marge), perles 14 (farmées la nuit), yeux 12 (12 cadres).
function applyRushTargets (cfg) {
  if (!cfg.rush) return cfg.targets
  cfg.targets = { rawIron: 8, diamonds: 5, obsidian: 10, blazeRods: 7, enderPearls: 14, enderEyes: 12 }
  return cfg.targets
}

function stopAll (bot) {
  state.paused = true
  state.following = null
  try { bot.pathfinder.stop() } catch {}
  try { bot.pvp.stop() } catch {}
  if (state.followTimer) { clearInterval(state.followTimer); state.followTimer = null }
}

function resume (bot) {
  state.paused = false
  chat(bot, 'resume', {}, { force: true })
  say(bot, '▶️ Reprise')
}

// Suit un joueur : GoalFollow est dynamique, un seul setGoal suffit (le pathfinder
// recalcule le chemin tout seul quand la cible bouge). Un timer léger (3 s) vérifie
// juste que le joueur est toujours là et que le pathfinder n'est pas arrêté.
function followUser (bot, username) {
  stopAll(bot)
  state.paused = true // la mission est en pause pendant le follow
  const entity = bot.players[username]?.entity
  if (!entity) { state.paused = false; say(bot, `Je ne te vois pas, ${username} !`); return } // stopAll avait mis la pause : on la défait
  state.following = username
  try { bot.pathfinder.setGoal(new GoalFollow(entity, 3), true) } catch {}
  state.followTimer = setInterval(() => {
    const e = bot.players[username]?.entity
    if (!e) { // joueur déconnecté ou plus visible
      say(bot, `😕 Je ne te vois plus, ${username} — j'arrête de suivre.`)
      stopFollowing(bot, false)
      return
    }
    // si le pathfinder s'est arrêté (obstacle infranchissable), on re-pose le goal
    try {
      if (!bot.pathfinder.isMoving?.() && !bot.pathfinder.isBuilding?.()) {
        bot.pathfinder.setGoal(new GoalFollow(e, 3), true)
      }
    } catch {}
  }, 3000)
  chat(bot, 'follow', { user: username }, { force: true })
  say(bot, '👣 Je te suis, ' + username + ' ! ("arrête suivre" pour lâcher prise)')
}

// Arrête le follow. Si resumeMission, relance la mission là où elle en était.
function stopFollowing (bot, resumeMission = true) {
  if (state.followTimer) { clearInterval(state.followTimer); state.followTimer = null }
  state.following = null
  try { bot.pathfinder.stop() } catch {}
  if (resumeMission) {
    state.paused = false
    say(bot, '🛑 J\'arrête de suivre.')
    if (!state.running) runMission(bot, require('../config.json')).catch((e) => log(e.stack))
  }
}

function status (bot) {
  const p = loadProgress()
  const done = p.done ?? []
  const next = PHASES.find((ph) => !done.includes(ph.key))
  const workshopsDone = done.filter((k) => k.startsWith('atelier_')).length
  const follow = state.following ? ` — je suis ${state.following} 👣` : ''
  chat(bot, 'status', { done: done.length, total: PHASES.length, next: next ? next.label : 'terminé !' }, { force: true })
  say(bot, '📊 Progression : ' + done.length + '/' + PHASES.length + ' phases (ateliers succès : ' + workshopsDone + '/6). Prochaine : ' + (next ? next.label : 'terminé !') + follow)
}

// ---------- Exécution de la mission ----------

async function runMission (bot, cfg, { fromStart = false } = {}) {
  if (state.running) { say(bot, '⏳ La mission tourne déjà'); return }
  state.running = true
  state.paused = false
  // mode speedrun (rush) : démarre le chrono any% legit
  if (cfg.rush) speedrun.startRun(log)
  try {
    // fromStart remet seulement les phases à zéro, mais conserve le reste de la
    // progression (deathPos, home, coordonnées forteresse/stronghold…) — avant,
    // { done: [] } écrasait tout le fichier à la prochaine saveProgress.
    const progress = fromStart ? { ...loadProgress(), done: [] } : loadProgress()
    progress.done ??= []
    // mode rush : seules les 13 phases de la mission dragon, pas les ateliers de succès
    const phases = cfg.rush ? PHASES.slice(0, 13) : PHASES
    for (const ph of phases) {
      if (progress.done.includes(ph.key)) {
        log(`⏭️ Phase déjà faite : ${ph.label}`)
        continue
      }
      // attendre si en pause. La pause volontaire (commande "stop") est respectée
      // indéfiniment ; seule la fuite (_fleeing) est bornée à 10 min (anti blocage infini)
      let waitedFlee = 0
      while (state.paused || bot._fleeing) {
        await sleep(2000)
        if (bot._fleeing) {
          waitedFlee += 2000
          if (waitedFlee >= 600000) { log('⚠️ Fuite bloquée depuis > 10 min — je force la reprise'); bot._fleeing = false }
        }
      }
      // Comportement joueur survival la nuit sans arme :
      // 1. Dormir dans un lit (avance le temps jusqu'au matin)
      // 2. Sinon abri d'urgence 3x3 + torche
      // 3. Fallback : pilier de 6 blocs
      let waited = 0
      let lastNightLog = 0
      let shelterDone = false
      while (isNight(bot) && !hasWeapon(bot) && waited < 300000 && !state.paused) {
        if (Date.now() - lastNightLog > 30000) { lastNightLog = Date.now(); log("🌙 Nuit et pas d'arme — je me mets à l'abri…") }
        if (!shelterDone) {
          shelterDone = true
          // 1. Lit dans l'inventaire → poser + dormir
          const bed = bot.inventory.items().find(i => i.name.endsWith("_bed"))
          if (bed) {
            log("🛏️ Je pose mon lit et je dors jusqu'au matin")
            try {
              const { placeBlockFromInventory } = require("./utils")
              const placed = await placeBlockFromInventory(bot, bed.name)
              if (placed) {
                await withTimeout(bot.sleep(placed), 15000)
                let slept = 0
                while (isNight(bot) && slept < 120000) { await sleep(2000); slept += 2000 }
                try { await bot.wake() } catch {}
                break
              }
            } catch (e) { log("dodo raté: " + e.message) }
          }
          // 2. Abri d'urgence 3x3 + torche
          const blockName = ["dirt", "cobblestone", "stone", "oak_planks"].find(n => countItem(bot, n) >= 12)
          if (blockName && countItem(bot, "torch") > 0) {
            log("🏠 Abri d'urgence 3x3 + torche pour la nuit")
            try {
              const { placeBlockFromInventory } = require("./utils")
              const base = bot.entity.position.floored()
              const spots = []
              for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                if (Math.abs(dx) === 1 || Math.abs(dz) === 1) spots.push([dx, 0, dz], [dx, 1, dz], [dx, 2, dz])
                spots.push([dx, 3, dz]) // toit
              }
              let placedCount = 0
              for (const [dx, dy, dz] of spots) {
                if (countItem(bot, blockName) <= 0) break
                try {
                  const target = base.offset(dx, dy, dz)
                  const ground = bot.blockAt(target.offset(0, -1, 0))
                  if (!isSolidBlock(ground)) continue
                  if (bot.blockAt(target)?.name !== "air") continue
                  await equipName(bot, blockName, "hand")
                  await bot.lookAt(target.offset(0.5, 0.5, 0.5))
                  await bot.placeBlock(ground, new Vec3(0, 1, 0))
                  placedCount++
                  await sleep(150)
                } catch {}
              }
              try { await placeBlockFromInventory(bot, "torch") } catch {}
              log("🏠 Abri posé: " + placedCount + " blocs")
            } catch (e) {}
          }
          // 3. Fallback pilier
          if (!blockName) {
            const anyBlock = ["dirt", "cobblestone", "stone"].find(n => countItem(bot, n) > 5)
            if (anyBlock) {
              log("🧱 Pilier de secours pour la nuit")
              try { await pillarUp(bot, bot.entity.position.y + 6, anyBlock) } catch {}
            }
          }
        }
        await sleep(5000)
        waited += 5000
      }
      state.currentPhase = ph.key
      speedrun.setPhase(ph.key) // attribue les morts à la bonne phase dans la baseline
      chat(bot, 'phaseStart', { label: ph.label }, { force: true })
      say(bot, '━━━ ▶ Phase ' + ph.label + ' ━━━')
      let ok = false
      // stratégie apprise : une phase qui échoue souvent recevra plus de tentatives
      const strat = learn.phaseStrategy(ph.key)
      const reliability = learn.phaseReliability(ph.key)
      if (reliability !== null && reliability < 0.5) log(`📉 Phase ${ph.label} peu fiable (${Math.round(reliability * 100)}%) — j'insiste (${strat.attempts} essais)`)
      for (let attempt = 1; attempt <= strat.attempts && !ok; attempt++) {
        let waitedFlee2 = 0
        while (state.paused || bot._fleeing) {
          await sleep(2000)
          if (bot._fleeing) {
            waitedFlee2 += 2000
            if (waitedFlee2 >= 600000) { log('⚠️ Fuite bloquée depuis > 10 min — je force la reprise'); bot._fleeing = false }
          }
        }
        // Message proactif occasionnel (max 1 toutes les 2 min)
        if (Math.random() < 0.3) proactive(bot, 'la phase ' + ph.label)
        const t0 = Date.now()
        try {
          // plafond global : aucune phase ne peut bloquer indéfiniment
          await withTimeout(ph.run(bot, cfg, progress), Math.round(8 * 60000 * (strat.timeoutScale || 1)))
          ok = true
          learn.recordPhaseSuccess(ph.key, Date.now() - t0)
        } catch (err) {
          learn.recordPhaseFailure(ph.key, err.message)
          log(`✗ Phase "${ph.key}" tentative ${attempt}/${strat.attempts} : ${err.message}`)
          chat(bot, 'phaseFail', { label: ph.label, error: err.message, retry: attempt < strat.attempts ? ' — je réessaie' : '' }, { force: true })
          say(bot, '⚠️ Phase ' + ph.label + ' : échec (' + err.message + ')' + (attempt < strat.attempts ? ' — je réessaie' : ''))
          await sleep(2000)
          // se calmer : remettre les contrôles
          try { bot.pathfinder.stop() } catch {}
          try { bot.pvp.stop() } catch {}
          bot.clearControlStates?.()
        }
      }
      if (!ok) {
        // Le cerveau évalue si on abandonne ou si on persiste encore
        const dec = decision.evaluate(bot, { missionActive: true, phaseKey: ph.key, hostilesNear: 0 })
        const persisted = learn.bestActionInSimilarSituations(dec.state)
        if (persisted && persisted.action === 'MISSION' && persisted.avg > 0.5 && strat.attempts < 8) {
          log(`🧠 ${ph.label} : persistance apprise (${persisted.n} épisodes similaires, avg ${persisted.avg.toFixed(2)}) — j'augmente les tentatives`)
          strat.attempts = Math.min(8, strat.attempts + 2)
          // re-boucle une fois de plus
          for (let attempt = strat.attempts - 1; attempt <= strat.attempts && !ok; attempt++) {
            try {
              await withTimeout(ph.run(bot, cfg, progress), Math.round(8 * 60000 * (strat.timeoutScale || 1)))
              ok = true
              learn.recordPhaseSuccess(ph.key, 0)
            } catch (err) {
              learn.recordPhaseFailure(ph.key, err.message)
              log(`✗ Phase "${ph.key}" tentative supplémentaire : ${err.message}`)
            }
          }
        }
        if (!ok) {
          chat(bot, 'phaseBlocked', { label: ph.label, attempts: strat.attempts }, { force: true })
          say(bot, '⛔ Phase ' + ph.label + ' bloquée après ' + strat.attempts + ' essais. Dis-moi "reprendre" pour retenter.')
          saveProgress(progress)
          return
        }
      }
      if (!progress.done.includes(ph.key)) progress.done.push(ph.key)
      saveProgress(progress)
      const splitMs = cfg.rush ? speedrun.split(ph.key, ph.label, log) : null // split chrono en mode speedrun
      chat(bot, 'phaseDone', { label: ph.label, done: progress.done.length, total: phases.length }, { force: true })
      say(bot, '✅ Phase ' + ph.label + ' terminée (' + progress.done.length + '/' + phases.length + ')' + (splitMs != null ? ' ⏱️ split ' + speedrun.fmt(splitMs) : ''))
    }
    announce(bot, [
      '🏆 MISSION ACCOMPLIE !',
      '🐉 Le dragon de l\'End est vaincu !',
      '📊 Dis "succès" pour le bilan complet des succès.'
    ])
    say(bot, '🏆 MISSION ACCOMPLIE : le dragon est mort et les ateliers de succès sont passés !')
    if (cfg.rush) speedrun.finish(true, log) // 🏆 victoire speedrun : persiste le meilleur chrono
  } catch (err) {
    log(`erreur mission : ${err.stack}`)
    say(bot, `💥 Erreur inattendue : ${err.message}`)
    if (cfg.rush) speedrun.finish(false, log)
  } finally {
    state.running = false
    state.currentPhase = null
  }
}

// ---------- Commandes chat ----------

async function handleCommand (bot, cfg, from, message) {
  const msg = message.trim().toLowerCase()
  if (!msg) return
  log(`💬 ${from}: ${message}`)

  // testé AVANT le stop général : "arrête suivre" contient "arrête" et serait sinon pris pour un stop
  if (/arr[êe]te suivre|stop follow|l[âa]che|stopfollow|ne suis plus/.test(msg)) {
    if (state.following) stopFollowing(bot, true)
    else say(bot, 'Je ne suivais personne.')
  } else if (/(stop|pause|arrête|arrete)/.test(msg)) {
    stopAll(bot)
    state.paused = true
    chat(bot, 'pause', {}, { force: true })
    say(bot, '⏸️ En pause. "reprendre" pour relancer.')
  } else if (/reprendre|resume|continue/.test(msg)) {
    resume(bot)
    if (!state.running) runMission(bot, cfg).catch((e) => log(e.stack))
  } else if (/construire|build/.test(msg)) {
    say(bot, '🏠 Je construis une maison ici')
    try { await P.phaseBase(bot, cfg, loadProgress()) } catch (e) { say(bot, `échec construction : ${e.message}`) }
  } else if (/suivre|follow/.test(msg)) {
    // "suivre" seul = suit l'expéditeur ; "suivre <pseudo>" = suit ce joueur
    const target = msg.replace(/suivre|follow/g, '').trim() || from
    followUser(bot, target)
  } else if (/\baternos\b/.test(msg)) {
    cfg.lan = false
    cfg.host = cfg.aternosHost || cfg.host
    cfg.port = cfg.aternosPort || cfg.port
    require('./target').setAlt(false)
    say(bot, '🌐 Je passe sur Aternos (' + cfg.host + ':' + cfg.port + ') — reconnexion…')
    log('🌐 Commande chat : switch sur Aternos ' + cfg.host + ':' + cfg.port)
    setTimeout(() => { try { bot.quit() } catch {} }, 1500)
  } else if (/\blan\b|local/.test(msg)) {
    cfg.lan = true
    require('./target').setAlt(false)
    say(bot, '🏠 Je passe en LAN local (' + (cfg.lanHost || '127.0.0.1') + ':' + (cfg.lanPort || 25565) + ') — reconnexion…')
    log('🏠 Commande chat : switch sur LAN')
    setTimeout(() => { try { bot.quit() } catch {} }, 1500)
  } else if (/serveur |server /.test(msg)) {
    const m2 = msg.match(/(?:serveur|server)\s+([\w.\-]+)(?::(\d+))?/)
    if (m2) {
      cfg.lan = false
      cfg.host = m2[1]
      cfg.port = Number(m2[2] || 25565)
      require('./target').setAlt(false)
      say(bot, '🌐 Serveur changé : ' + cfg.host + ':' + cfg.port + ' — reconnexion…')
      log('🌐 Commande chat : serveur ' + cfg.host + ':' + cfg.port)
      setTimeout(() => { try { bot.quit() } catch {} }, 1500)
    } else say(bot, 'Usage : "serveur host:port"')
  } else if (/\bstuff\b|récupère|recupere|va chercher mon stuff/.test(msg)) {
    say(bot, '📦 Je vais récupérer ton stuff…')
    recoverStuff(bot).then((n) => say(bot, '📦 ' + n + ' drop(s) ramassé(s) !')).catch((e) => say(bot, 'échec: ' + e.message))
  } else if (/fouille|loot|vide les coffres|coffres? alentour|\bchest\b/.test(msg)) {
    say(bot, '📦 Je fouille les coffres alentour…')
    lootNearbyChests(bot, 48, 6).then((n) => {
      say(bot, `📦 ${n} coffre(s) vidé(s) ! (compétence fouille_coffre : ${Math.round(learn.skillLevel('fouille_coffre') * 100)}%)`)
    }).catch((e) => say(bot, 'échec: ' + e.message))
  } else if (/craftable|que puis-je crafter|que puis je crafter/.test(msg)) {
    const list = require('./craftplanner').craftableList(bot, 25)
    say(bot, list.length ? "🔨 Craftable maintenant : " + list.map((c) => c.item).join(", ") : "🔨 Rien de craftable avec ce que j'ai.")
  } else if (/^craft /.test(msg)) {
    const item = msg.replace(/^craft /, '').trim().replace(/ /g, '_')
    say(bot, '🔨 Je tente de crafter ' + item + '…')
    require('./craftplanner').craftAny(bot, item, 1).then((ok) => say(bot, ok ? '✅ ' + item + ' crafté !' : '❌ ' + item + ' impossible (ressources manquantes)')).catch((e) => say(bot, 'échec: ' + e.message))
  } else if (/qui tu suis|following/.test(msg)) {
    say(bot, state.following ? `👣 Je suis ${state.following}.` : '👣 Je ne suis personne en ce moment.')
  } else if (/statut|status|progress/.test(msg)) {
    status(bot)
  } else if (/baseline|goulot/.test(msg)) {
    const b = speedrun.baseline()
    say(bot, `📉 Baseline : ${b.runs} run(s), ${b.wins} victoire(s) — phases les plus lentes d'abord :`)
    if (!b.phases.length) say(bot, '📉 Pas encore de données — lance la mission en mode rush !')
    else for (const row of b.phases) {
      say(bot, `📉 ${row.phase} : ${speedrun.fmt(row.avgDelta)} en moyenne (${speedrun.fmt(row.minDelta)}–${speedrun.fmt(row.maxDelta)}, n=${row.n}) — ${row.deaths} mort(s)`)
    }
  } else if (/chrono|speedrun|split|\btemps\b/.test(msg)) {
    const desc = speedrun.describe()
    say(bot, '⏱️ ' + desc)
    const s = speedrun.status()
    if (s.current && s.current.splits) {
      const parts = Object.entries(s.current.splits).map(([k, ms]) => k + '=' + speedrun.fmt(ms))
      if (parts.length) say(bot, '⏱️ Splits : ' + parts.join(', '))
    }
    if (s.bestSplits) {
      const parts = Object.entries(s.bestSplits).map(([k, ms]) => k + '=' + speedrun.fmt(ms))
      say(bot, '🏆 Meilleur run : ' + speedrun.fmt(s.best) + ' — ' + parts.join(', '))
    }
  } else if (/succ[eè]s|success|avancement/.test(msg)) {
    const s = advancements.summary(bot)
    say(bot, `ℹ️ ${s.manual} succès restent 100% manuels (voir README). Dis "mission" pour lancer les ateliers restants.`)
  } else if (/reset|recommencer/.test(msg)) {
    // garder le reste de la progression (coordonnées, morts…) — même bug que fromStart avant
    saveProgress({ ...loadProgress(), done: [] })
    say(bot, '🔄 Progression remise à zéro.')
  } else if (/(mission|dragon|go)/.test(msg)) {
    if (!state.running) runMission(bot, cfg).catch((e) => log(e.stack))
  } else if (/mémoire|memoire|apprentissage|learn|skills/.test(msg)) {
    say(bot, `🧠 Mémoire : ${learn.summary()}`)
  } else if (/environnement|env|vision|alentours/.test(msg)) {
    const env = vision?.getEnv?.()
    if (env) {
      say(bot, '👁️ Environnement : ' + vision.describe())
      const known = learn.knownResources()
      if (known.length) say(bot, '👁️ Ressources connues : ' + known.slice(0, 10).join(', '))
    } else say(bot, '👁️ Vision non active.')
  } else if (/cerveau|decision|décision/.test(msg)) {
    const dec = decision.evaluate(bot, { missionActive: state.running, phaseKey: state.currentPhase })
    const similar = learn.getSimilarEpisodes(dec.state, 5)
    say(bot, '🧠 Cerveau : action=' + dec.action + ' score=' + dec.score + ' — ' + dec.reason)
    say(bot, '🧠 État: vie=' + Math.round(bot.health) + ' faim=' + Math.round(bot.food) + ' dim=' + (bot.game?.dimension ?? '?') + ' phase=' + (state.currentPhase ?? 'aucune'))
    if (similar.length) say(bot, '🧠 ' + similar.length + ' épisodes similaires, meilleure action passée: ' + similar[0].action + ' (reward ' + (similar[0].reward ?? '?') + ')')
    else say(bot, "🧠 Aucun épisode similaire enregistré pour l'instant.")
  } else if (/viens|come|rejoins/.test(msg)) {
    const e = bot.players[from]?.entity
    if (e) {
      say(bot, `🏃 Je viens, ${from} !`)
      goTo(bot, new GoalFollow(e, 3), { timeout: 60000, retries: 1 }).catch(() => {})
    } else say(bot, `Je ne te vois pas, ${from} !`)
  } else if (/home|maison|base/.test(msg)) {
    const p = loadProgress()
    if (p.home) {
      say(bot, `🏠 Je rentre à la base (${Math.round(p.home[0])}, ${Math.round(p.home[2])})…`)
      goTo(bot, new GoalNear(p.home[0], p.home[1], p.home[2], 4), { timeout: 180000, retries: 1 }).catch(() => {})
    } else say(bot, 'Pas de base connue pour l\'instant.')
  } else if (/spawn/.test(msg)) {
    const a = learn.getExploreAnchor(bot)
    say(bot, `🎯 Je retourne au spawn (${Math.round(a.x)}, ${Math.round(a.z)})…`)
    goTo(bot, new GoalXZ(a.x, a.z), { timeout: 180000, retries: 1 }).catch(() => {})
  } else if (/inventaire|inv/.test(msg)) {
    const inv = bot.inventory.items().map((i) => `${i.name}x${i.count}`).join(', ') || 'vide'
    chat(bot, 'inventory', { inv, food: Math.round(bot.food), hp: Math.round(bot.health) }, { force: true })
    say(bot, '🎒 ' + inv + ' — faim ' + Math.round(bot.food) + '/20, vie ' + Math.round(bot.health) + '/20')
  } else if (/coords|position/.test(msg)) {
    const p = bot.entity.position.floored()
    chat(bot, 'coords', { x: p.x, y: p.y, z: p.z, dim: bot.game?.dimension ?? '?' }, { force: true })
    say(bot, '📍 (' + p.x + ', ' + p.y + ', ' + p.z + ') — dimension ' + (bot.game?.dimension ?? '?'))
  } else if (/(manger|eat)/.test(msg)) {
    await eatUntil(bot, 20)
    say(bot, `🍗 Faim ${Math.round(bot.food)}/20`)
  }
}

module.exports = { runMission, handleCommand, handleDeath, fleeDeathSpot, waitSafe, recoverStuff, loadProgress, saveProgress, stopAll, followUser, stopFollowing, status, state, PHASES, applyRushTargets }
