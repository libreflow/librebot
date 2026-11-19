// ============================================================
// LibreBot — src/index.js
// Point d'entrée : connexion (avec reconnexion automatique pour
// Aternos), plugins, commandes chat, lancement de la mission.
// ============================================================
// Anti-crash global : une exception non catchée dans un timer ne doit JAMAIS
// tuer le process (le watchdog externe relancerait après 2 min 30 de downtime).
process.on('uncaughtException', (e) => { try { console.log('[FATAL] ' + String(e.stack || e.message).slice(0, 500)) } catch {} })
process.on('unhandledRejection', (e) => { try { console.log('[REJECT] ' + String(e?.stack || e?.message || e).slice(0, 300)) } catch {} })

const fs = require('fs')
const path = require('path')

// --- Verrou anti-double-instance ---
// Si une autre instance du bot tourne déjà, on s'arrête immédiatement
// (évite les "duplicate_login" sur Aternos quand on lance npm start 2 fois)
const LOCK_PATH = path.join(__dirname, '..', '.bot.lock')
// Lock ATOMIQUE (flag 'wx' = échoue si le fichier existe) : évite la race condition
// entre deux lancements simultanés qui passeraient tous les deux le existsSync.
function lockPérimé () {
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim())
    if (!pid) return true
    process.kill(pid, 0) // lève une erreur si le pid est mort
    return false
  } catch { return true } // pid mort ou illisible -> lock périmé
}
try {
  if (fs.existsSync(LOCK_PATH)) {
    if (!lockPérimé()) {
      const st = fs.readFileSync(LOCK_PATH, 'utf8').trim()
      console.log('⛔ Une autre instance du bot tourne déjà (PID ' + st + '). Arrêt.')
      process.exit(1)
    }
    // lock périmé (pid mort, ex: kill -9 du watchdog) : on le SUPPRIME avant de
    // réécrire — sinon writeFileSync('wx') échoue EEXIST à vie et le bot ne redémarre jamais.
    try { fs.unlinkSync(LOCK_PATH) } catch {}
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' }) // atomique
  process.on('exit', () => { try { if (fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK_PATH) } catch {} })
} catch (e) {
  if (e.code === 'EEXIST') { console.log('⛔ Une autre instance du bot tourne déjà (lock existant). Arrêt.'); process.exit(1) }
  console.log('lock: ' + e.message)
}

const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock')
const pvp = require('mineflayer-pvp')
const autoEat = require('mineflayer-auto-eat')
// v5 exporte .loader (ESM), v3 exportait .plugin — compatible les deux
const autoEatPlugin = autoEat.loader ?? autoEat.plugin ?? autoEat.default
const armorManager = require('mineflayer-armor-manager')
const config = require('../config.json')

const { log, say, sleep, goTo, GoalXZ, Vec3, watchBlockChanges } = require('./utils')
const vision = require('./vision')
const legit = require('./legit')
const map = require('./map')
const dashboard = require('./dashboard')
const { runMission, handleCommand, handleDeath, loadProgress, saveProgress, state, PHASES, applyRushTargets } = require('./mission')
const { startSurvivalWatch, reactDamage } = require('./survie')
const { installPhysics } = require('./physique')
const target = require('./target')
const learn = require('./learn')

let bot = null
// dernier port LAN qui a MARCHÉ cette session + drapeau de refus (monde rouvert = nouveau port aléatoire)
let _lanPortOk = null
let _lanRefused = false
let _curTgt = null

// compare des versions type "26.1" / "1.21.4" : versionAtLeast(v, '1.21.2')
function versionAtLeast (v, ref) {
  const parts = (s) => String(s || '').split('.').map(Number)
  const a = parts(v); const b = parts(ref)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return true
}

// Fallback automatique : si la cible principale est down (ECONNREFUSED…),
// on bascule sur l'autre (LAN <-> Aternos) au lieu de boucler sur rien.
async function createBot () {
  let tgt = target.resolve(config)
  if (config.lan && _lanPortOk) {
    // un port LAN a déjà marché cette session : on le réutilise (pas de re-découverte)
    tgt = { host: config.lanHost || '127.0.0.1', port: _lanPortOk, lan: true }
  }
  if (config.lan && (!_lanPortOk || _lanRefused)) {
    if (_lanRefused || !tgt) {
    // refus de connexion sur le port connu (monde rouvert = nouveau port aléatoire)
    // ou aucun port dans les logs : on écoute les annonces Open-to-LAN
    // (multicast 224.0.2.60:4445) — fonctionne avec n'importe quel port local
    log('🔍 ' + (_lanRefused ? 'Port LAN refusé (monde rouvert ?) — j\'écoute les annonces' : 'Pas de port LAN dans les logs — j\'écoute les annonces') + ' "Ouvrir au réseau local" (6 s)…')
    const port = await require('./lan').listenLanAnnounce(6000)
    if (port) {
      tgt = { host: config.lanHost || '127.0.0.1', port, lan: true }
      log('📡 Monde LAN découvert automatiquement : port ' + port)
    }
    }
  }
  if (!tgt) {
    log('⛔ config.lan = true mais aucun monde solo ouvert au LAN détecté (logs + multicast).')
    log('   → Ouvre ton monde : Échap → "Ouvrir au réseau local". Nouvelle tentative dans 15 s…')
    if (!target.getAlt() && config.fallback !== false) { target.setAlt(true); log('   → LAN indisponible, je bascule sur Aternos (' + (config.aternosHost || config.host) + ':' + (config.aternosPort || config.port) + ')') }
    setTimeout(createBot, 15000)
    return
  }
  _curTgt = tgt
  log('🔌 Connexion à ' + tgt.host + ':' + tgt.port + ' en tant que ' + config.username + '… (' + target.label(config, tgt) + ')')
  bot = mineflayer.createBot({
    host: tgt.host,
    port: tgt.port,
    username: config.username,
    auth: config.auth || 'offline',
    version: config.version || undefined,
    physicsEnabled: true // physique locale vanilla (gravité, collisions, poussées)
  })

  // --- plugins ---
  bot.loadPlugin(pathfinder.pathfinder)
  bot.loadPlugin(collectBlock.plugin)
  bot.loadPlugin(pvp.plugin)
  bot.loadPlugin(armorManager)
  try {
    bot.loadPlugin(autoEatPlugin)
    // auto-eat v5 : les options vivent dans bot.autoEat.opts (méthode setOpts),
    // PAS bot.autoEat.options (undefined en v5 → le if précédent ne s'appliquait jamais)
    if (bot.autoEat) {
      const opts = { priority: 'foodPoints', minHunger: 17, minHealth: 14, bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'] }
      if (typeof bot.autoEat.setOpts === 'function') bot.autoEat.setOpts(opts)
      else if (bot.autoEat.opts) bot.autoEat.opts = { ...bot.autoEat.opts, ...opts }
      else bot.autoEat.options = opts // fallback v3
    }
  } catch (e) { log(`auto-eat indisponible : ${e.message}`) }
  // tir à l'arc auto (vraie visée balistique) — le package s'appelle minecrafthawkeye, export .default
  try { bot.loadPlugin(require('minecrafthawkeye').default) } catch (e) { log('hawk-eye indisponible : tir à l\'arc en mode manuel') }
  // sélection auto du meilleur outil pour chaque bloc (minage plus rapide)
  try { bot.loadPlugin(require('mineflayer-tool').plugin) } catch (e) { log('mineflayer-tool indisponible : minage manuel') }
  // totem automatique en off-hand si dispo (survie) — export .autototem
  try { bot.loadPlugin(require('mineflayer-auto-totem').autototem) } catch (e) { log('auto-totem indisponible') }

  // --- événements ---

  let protocolPatched = false
  // Téléportation (opérateur / tp du joueur) : un saut de position en un tick
  // ne peut pas être une marche. On annule le trajet en cours au lieu de courir
  // à travers la map pour retourner à l'ancien objectif.
  let _lastTpPos = null
  bot.on('physicsTick', () => {
    try {
      const pos = bot.entity?.position
      if (!pos) return
      if (_lastTpPos) {
        if (pos.distanceTo(_lastTpPos) > 32 && Date.now() - (bot._tpAt ?? 0) > 3000) {
          bot._tpAt = Date.now()
          log('🌀 Téléportation détectée — trajet annulé, je garde mon objectif mais je le re-planifie autour d\'ici')
          try { bot.pathfinder.stop() } catch {}
          try { bot.clearControlStates() } catch {}
          try { bot.pvp?.stop?.() } catch {}
        }
      }
      _lastTpPos = pos.clone()
    } catch {}
  })


  bot.on('spawn', () => {
    // connexion LAN réussie : on mémorise le port qui marche (les prochaines
    // reconnexions l'utilisent direct, sans re-découverte de 6 s)
    if (_curTgt?.lan !== false) { _lanPortOk = _curTgt.port; _lanRefused = false }
    // NOUVEAU MONDE ? Empreinte = position du spawn du monde. Si elle change, la
    // progression sauvegardée (phases, portails, forteresse, base) vient d'un autre
    // monde — on repart de la phase 1 au lieu de croire que tout est déjà fait.
    if (!bot._worldChecked) {
      bot._worldChecked = true
      try {
        const sp = bot.spawn_point
        if (sp) {
          const fp = Math.round(sp.x) + ',' + Math.round(sp.y) + ',' + Math.round(sp.z)
          const p = loadProgress()
          if (p.worldId && p.worldId !== fp) {
            log('🌍 Nouveau monde détecté (spawn ' + fp + ' != ' + p.worldId + ') — progression réinitialisée, retour à la phase 1')
            for (const k of ['done', 'blocked', 'deathPos', 'fortress', 'strongholdXZ', 'netherPortal', 'endPortal', 'portalRoom', 'home', 'confirm']) delete p[k]
            p.worldId = fp
            saveProgress(p)
            try { require('./learn').resetWorldMemory() } catch (e) { log('reset learn: ' + e.message) }
            try { require('./map').clearWorld() } catch (e) { log('reset map: ' + e.message) }
          } else if (!p.worldId) { p.worldId = fp; saveProgress(p) }
        }
      } catch (e) { log('reset monde : ' + e.message) }
    }
    bot._spawnedOnce = true
    log(`✅ Connecté ! (version serveur détectée : ${bot.version})`)
    if (!protocolPatched) {
      protocolPatched = true
      // Physique de joueur vanilla (gravité, chute dans le vide, poussées) —
      // voir src/physique.js. Changement clé : on NE BLOQUE PLUS les paquets
      // position/position_look envoyés par mineflayer. Comme un vrai client,
      // le serveur reçoit à chaque tick la position calculée localement par
      // prismarine-physics (gravité + collisions + vélocité reçue du serveur
      // via entity_velocity = poussées), la valide, applique les dégâts de
      // chute, et renvoie une correction en cas de divergence. Bloquer ces
      // paquets faisait flotter le bot côté serveur (position jamais reçue)
      // et empêchait qu'on puisse le pousser.
      // Depuis 1.21.2 le serveur n'accepte qu'un paquet de mouvement par tick :
      // on envoie player_input (les contrôles) + tick_end à chaque tick
      // (mineflayer 4.39 ne le fait pas nativement).
      installPhysics(bot, versionAtLeast, log)
      watchBlockChanges(bot) // détection des drops après casse de bloc
      legit.reset(bot) // init suivi vitesse anti-cheat
      // Suivi continu de la vitesse (anti-speedhack) + vérif anti-fly toutes les 2s
      // 'damage' n'existe pas dans mineflayer : l'événement émis quand une entité
      // prend des dégâts est 'entityHurt' (entity, source). On filtre sur le bot.
      bot.on('entityHurt', (entity) => {
        if (!entity || entity.id !== bot.entity?.id) return
        try { legit.noteKnockback() } catch {}
        reactDamage(bot).catch(() => {})
      })
      bot._legitTimer = setInterval(() => {
        try {
          legit.trackMovement(bot)
          if (legit.isFlying(bot)) console.log('[LEGIT] ⚠️ Vol détecté — le bot ne vole pas, mouvement ignoré')
        } catch {}
      }, 750)
      bot._visionTimer = vision.startVision(bot, 10000) // scan environnement 10s + entités 1s (perfs) — startVision retourne le timer
      // Carte du monde : enregistrer le chunk actuel
      map.visitChunk(Math.floor(bot.entity.position.x / 16), Math.floor(bot.entity.position.z / 16), vision.getEnv()?.biome, Math.round(bot.entity.position.y))
      if (!map.getSpawn()) map.setSpawn(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z)
      // Dashboard web temps réel
      if (!bot._dashboardStarted) {
        bot._dashboardStarted = true
        const mission = require('./mission')
        const learn = require('./learn')
        dashboard.startDashboard(() => ({
          health: bot.health, food: bot.food, x: Math.round(bot.entity?.position?.x ?? 0), y: Math.round(bot.entity?.position?.y ?? 0), z: Math.round(bot.entity?.position?.z ?? 0),
          dimension: bot.game?.dimension ?? '?', fleeing: !!bot._fleeing,
          connected: !!bot._spawnedOnce, version: bot.version ?? '?',
          target: (() => { const t = target.resolve(config); return t ? target.label(config, t) : 'aucune' })(),
          alt: target.getAlt(), deathStreak: state.deathStreak ?? 0,
          logs: (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'bot.log'), 'utf8').split('\n').filter((l) => l.includes(']')).slice(-40) } catch { return [] } })(),
          env: vision.getEnv(),
          mission: { running: mission.state.running, paused: mission.state.paused, currentPhase: mission.state.currentPhase, done: mission.loadProgress().done?.length ?? 0, total: mission.PHASES.length },
          mapStats: map.stats(),
          learn: { episodes: learn.data?.episodes?.length ?? 0, qstates: Object.keys(learn.data?.qtable ?? {}).length, deaths: learn.data?.deaths?.length ?? 0, discoveries: Object.keys(learn.data?.discoveries ?? {}).length },
          decision: bot._lastDecision ?? null,
          speedrun: (() => { try { return require('./speedrun').status() } catch { return null } })()
        }), 3000)
      }
      // Connecter vision → map : enregistrer les ressources/dangers/structures comme POIs
      // Timer STOCKÉ sur le bot pour être nettoyé dans 'end' (sinon fuite à chaque reconnexion)
      bot._poiTimer = setInterval(() => {
        const env = vision.getEnv()
        const pos = bot.entity?.position
        if (!pos || !env) return
        for (const r of env.resources) if (r.value >= 50) map.addPOI('resource:' + r.kind, r.x, r.y, r.z, r.value)
        for (const d of env.dangers) map.addPOI('danger:' + d.kind, d.x, d.y, d.z, 0)
        for (const s of env.structures) map.addPOI('structure:' + s, pos.x, pos.y, pos.z, 0)
        map.visitChunk(Math.floor(pos.x / 16), Math.floor(pos.z / 16), env.biome, Math.round(pos.y))
      }, 10000) // toutes les 10s
      if (bot.version && /^(26\.[2-9]|[3-9]\d\.)/.test(bot.version)) {
        log('⚠️ Version très récente : si des erreurs de protocole apparaissent,')
        log('   utilise `npm update` pour obtenir le dernier support mineflayer.')
      }
      // viewer optionnel (POV navigateur sur http://localhost:3000)
      if (config.viewer) {
        try {
          const mineflayerViewer = require('prismarine-viewer').mineflayer
          mineflayerViewer(bot, { port: 3000, firstPerson: true })
          log('👁️ POV disponible sur http://localhost:3000')
        } catch (e) { log(`viewer indisponible : ${e.message}`) }
      }
      // watchdog de survie (faim, armure, fuite, lave, noyade) — idempotent
      startSurvivalWatch(bot)
      // watchdog d'inactivité : si aucun log depuis 150s, on débloque tout
      if (!bot._idleWatch) {
        bot._idleWatch = setInterval(() => {
          try {
            const idle = Date.now() - require('./chat').getLastLogAt()
            if (idle > 150000) {
              try { bot.pathfinder.stop() } catch {}
              // auto-reprise programmée après un blocage de phase : le bot retente seul
              if (!state.running && state.autoResumeAt && Date.now() > state.autoResumeAt) {
                state.autoResumeAt = null
                log('🕒 Auto-reprise : je relance la mission (retour avec rattrapage inventaire)')
                runMission(bot, config).catch((e) => log('mission error : ' + e.message))
              }
              try { bot.pvp.stop() } catch {}
              try { bot.clearControlStates() } catch {}
              // un avertissement max tous les 150 s (avant : spam toutes les 20 s quand la mission était bloquée)
              if (!bot._lastIdleWarn || Date.now() - bot._lastIdleWarn > 150000) {
                bot._lastIdleWarn = Date.now()
                console.log('[' + new Date().toISOString().slice(11, 19) + '] 🚨 WATCHDOG: inactif depuis ' + Math.round(idle / 1000) + 's — déblocage forcé')
              }
              for (const s of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) { try { bot.setControlState(s, false) } catch {} }
              if (idle > 300000 && state.running) {
                console.log('[' + new Date().toISOString().slice(11, 19) + '] 🚨 WATCHDOG: mission bloquée depuis > 5 min — relance')
                state.running = false
                setTimeout(() => { if (!state.running) runMission(bot, config).catch((e) => log('mission error : ' + e.message)) }, 5000)
              }
            }
          } catch {}
        }, 20000)
      }
      // mode rush : cibles minimales, puis apprentissage ajuste selon l'inventaire actuel
      if (config.rush) {
        applyRushTargets(config)
        log('⚡ Mode speedrun (any% legit) : cibles minimales fer ' + config.targets.rawIron + ', diamants ' + config.targets.diamonds + ', obsidienne ' + config.targets.obsidian + ' (portail sans coins), blazes ' + config.targets.blazeRods + ', perles ' + config.targets.enderPearls + ', yeux ' + config.targets.enderEyes)
      }
      learn.adjustTargets(config, bot)
    }
    // après une mort : d'abord tenter de récupérer le stuff laissé au sol
    // (les drops despawnent après 5 min) — sauf en mode panique (streak >= 3, trop dangereux)
    if (loadProgress().deathPos && (state.deathStreak ?? 0) < 3) {
      require('./mission').recoverStuff(bot).catch((e) => log('recoverStuff: ' + e.message))
    }
    // streak >= 2 : se cacher IMMÉDIATEMENT dans un trou 1x1x2 (invincible), même de jour
    if (loadProgress().deathPos && (state.deathStreak ?? 0) >= 2) {
      require('./mission').waitSafe(bot).catch((e) => log('waitSafe: ' + e.message))
    }
    // puis s'éloigner VRAIMENT du lieu de mort (vérifié) + mode panique si streak
    if (loadProgress().deathPos) {
      require('./mission').fleeDeathSpot(bot).catch((e) => log('fleeDeathSpot: ' + e.message))
    }
    // relance auto de la mission à chaque (re)spawn si elle ne tourne pas déjà
    if (config.autoMission) {
      setTimeout(async () => {
        // streak de morts : d'abord sécuriser (attendre le jour / zone claire)
        if ((state.deathStreak ?? 0) >= 2) {
          await require('./mission').waitSafe(bot).catch((e) => log('waitSafe: ' + e.message))
        }
        if (!state.running) runMission(bot, config).catch((e) => log(`mission error : ${e.stack}`))
      }, 1200)
    }
    // log de statut périodique (toutes les 5 min) pour surveiller de loin
    if (!bot._statusTimer) {
      bot._statusTimer = setInterval(() => {
        if (!bot.entity) return
        const p = bot.entity.position.floored()
        const p2 = loadProgress()
        log(`📊 statut : pos=(${p.x},${p.y},${p.z}) vie=${Math.round(bot.health)}/20 faim=${Math.round(bot.food)}/20 dim=${bot.game?.dimension ?? '?'} phases=${(p2.done ?? []).length}/${PHASES.length} pause=${state.paused} fuite=${!!bot._fleeing}`)
      }, 5 * 60 * 1000)
    }
  })

  bot.on('death', () => {
    log('☠️ Le bot est mort !')
    handleDeath(bot)
    // respawn intelligent : après un streak de morts la nuit, attendre le jour
    // (les zombies/squelettes brûlent au soleil) avant de respawn, sinon le bot
    // respawn au milieu des mobs et meurt en boucle en 7s.
    const smartRespawn = async () => {
      try {
        const { isNight, nearestHostile } = require('./survie')
        const streak = require('./mission').state.deathStreak ?? 0
        if (streak >= 2) {
          // Sur l'écran de mort les entités ne sont pas trackées : délai fixe + jour.
          // Max 5 min (sinon le watchdog externe relancerait le bot pour rien).
          log("🛡️ Streak x" + streak + " — j'attends le jour + 45s avant de respawn (timeOfDay=" + (bot.time?.timeOfDay ?? '?') + ')')
          const t0 = Date.now()
          let lastLog = 0
          while (Date.now() - t0 < 5 * 60000) {
            await new Promise((r2) => setTimeout(r2, 5000))
            if (Date.now() - lastLog > 30000) { lastLog = Date.now(); log("⏳ Toujours pas sûr de respawn (attendu " + Math.round((Date.now() - t0) / 1000) + "s, timeOfDay=" + (bot.time?.timeOfDay ?? '?') + ')') }
            if (Date.now() - t0 >= 45000 && !isNight(bot)) break
          }
          log('☀️ Zone sûre — respawn en sécurité')
        }
      } catch {}
      setTimeout(() => {
        try { bot._client.write('client_command', { actionId: 0 }) } catch (e) { log('respawn: ' + e.message) }
      }, 1500)
    }
    smartRespawn().catch((e) => log('smartRespawn: ' + e.message))
  })

  // commandes : /tell LibreBot <commande>  (ou chat direct)
  bot.on('whisper', (username, message) => {
    if (username === bot.username) return
    handleCommand(bot, config, username, message).catch((e) => log(`command error : ${e.stack}`))
  })
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const lower = message.toLowerCase()
    // accepter les commandes directes préfixées par le nom du bot
    if (lower.startsWith(`${config.username.toLowerCase()}`) || lower.startsWith('librebot')) {
      handleCommand(bot, config, username, message).catch((e) => log(`command error : ${e.stack}`))
    }
  })

  bot.on('kicked', (reason) => {
    let reasonStr = reason; try { reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason) } catch {}
    log('❌ Expulsé du serveur : ' + String(reasonStr).slice(0, 500))
    log('   (Si le serveur Aternos s\'est arrêté, je me reconnecterai quand il sera relancé.)')
  })

  bot.on('error', (err) => {
    // port LAN refusé : le monde a été rouvert avec un nouveau port aléatoire —
    // on invalide pour que la prochaine tentative redécouvre par multicast
    if (err.code === 'ECONNREFUSED' && _curTgt?.lan !== false) { _lanPortOk = null; _lanRefused = true }
    const msg = String(err.message || err)
    // Erreur réseau AVANT le premier spawn = serveur down : on bascule de cible
    if (!bot._spawnedOnce && config.fallback !== false && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET'].includes(err.code)) {
      log('⚠️ Serveur injoignable (' + err.code + ') — bascule de cible à la prochaine tentative')
    }
    if (!/PartialReadError|deprecated/i.test(msg)) log('erreur : ' + msg.slice(0, 300))
  })

  bot.on('end', () => {
    // nettoyer les timers de l'ancien bot pour éviter les fuites à chaque reconnexion
    if (bot._statusTimer) { clearInterval(bot._statusTimer); bot._statusTimer = null }
    if (bot._survivalTimer) { clearInterval(bot._survivalTimer); bot._survivalTimer = null }
    if (bot._physicsTimer) { clearInterval(bot._physicsTimer); bot._physicsTimer = null }
    if (bot._visionTimer) { clearInterval(bot._visionTimer); bot._visionTimer = null }
    if (bot._legitTimer) { clearInterval(bot._legitTimer); bot._legitTimer = null }
    if (bot._idleWatch) { clearInterval(bot._idleWatch); bot._idleWatch = null }
    if (bot._farmTimer) { clearInterval(bot._farmTimer); bot._farmTimer = null }
    if (bot._poiTimer) { clearInterval(bot._poiTimer); bot._poiTimer = null }
    try { require('./survie').stopPanic() } catch {} // stoppe le timer de panique global (fuite sinon)
    // CRITIQUE reconnexion : la boucle mission ne survit PAS à une déconnexion —
    // si une phase attendait (goTo pendant la coupure), state.running restait true
    // pour toujours et l'auto-mission croyait que ça tournait : le bot reprenait
    // « son objectif » gelé sans jamais se réadapter. On force l'état à l'arrêt :
    // le respawn relancera runMission, qui réévalue le rattrapage inventaire.
        // Sauvegarde du run speedrun en cours : une déconnexion ne doit pas perdre les splits
    // déjà réalisés (le run est clos comme « interrompu » — donnée réelle pour la baseline).
    try { const sr = require('./speedrun'); if (sr.isRunning()) sr.finish(false, require('./chat').log) } catch {}
if (state.running) {
      state.running = false
      state.autoResumeAt = null
      log('🔄 Mission interrompue par la déconnexion — elle sera relancée au reconnect (avec rattrapage inventaire)')
    }
    // idem pour l'état de follow (timer + cible peuvent référencer l'ancien bot)
    if (state.followTimer) { clearInterval(state.followTimer); state.followTimer = null }
    state.following = null
    log('🔌 Déconnecté. Nouvelle tentative dans 15 s…')
    // une seule bascule par tentative (sinon double switch dans la même seconde)
    if (!bot._spawnedOnce && config.fallback !== false) {
      const alt = target.flipAlt()
      log('🔀 Prochaine tentative sur ' + (alt ? 'la cible de secours' : 'la cible principale'))
      try { require('./chat').chat(bot, 'fallback', {}, { force: true }) } catch {}
    }
    setTimeout(createBot, 15000)
  })
}

createBot()

// Ctrl+C propre
process.on('SIGINT', () => {
  log('👋 Arrêt du bot.')
  try { bot.quit() } catch {}
  process.exit(0)
})
