// ============================================================
// LibreBot — src/mission.js
// Orchestrateur : séquence de phases, progression persistante,
// gestion des morts, commandes chat.
// ============================================================
const { log, say, sleep, goTo, GoalFollow, randInt } = require('./utils')
const { loadProgress, saveProgress } = require('./storage')
const P = require('./phases')
const P2 = require('./phases2')
const build = require('./build')
const advancements = require('./advancements')
const learn = require('./learn')

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

// ---------- État global ----------

const state = {
  paused: false,
  running: false,
  abort: false,       // true si une mort interrompt la mission en cours
  followTimer: null,
  bot: null
}

// À la mort, l'inventaire est perdu : on repart des phases de base,
// mais on garde les coordonnées découvertes (forteresse, stronghold…).
// On mémorise aussi le lieu de la mort pour s'en éloigner au respawn.
// La mission en cours est interrompue proprement (state.abort) pour ne
// pas écraser la progression remise à zéro.
function handleDeath (bot) {
  const p = loadProgress()
  p.done = []
  if (bot?.entity?.position) {
    const pos = bot.entity.position.floored()
    p.deathPos = { x: pos.x, y: pos.y, z: pos.z }
  }
  saveProgress(p)
  const cause = learn.detectDeathCause(bot)
  learn.recordDeath(cause, bot)
  state.abort = true
  try { bot.pathfinder.stop() } catch {}
  try { bot.pvp.stop() } catch {}
  try { bot.clearControlStates?.() } catch {}
  log(`☠️ Mort détectée (cause apprise : ${cause}) : progression remise à zéro (coordonnées conservées)`)
}

function stopAll (bot) {
  state.paused = true
  try { bot.pathfinder.stop() } catch {}
  try { bot.pvp.stop() } catch {}
  if (state.followTimer) { clearInterval(state.followTimer); state.followTimer = null }
}

function resume (bot) {
  state.paused = false
  say(bot, '▶️ Reprise')
}

function followUser (bot, username) {
  stopAll(bot)
  const entity = bot.players[username]?.entity
  if (!entity) { say(bot, `Je ne te vois pas, ${username} !`); return }
  state.followTimer = setInterval(() => {
    const e = bot.players[username]?.entity
    if (e) {
      try { bot.pathfinder.setGoal(new GoalFollow(e, 3), true) } catch {}
    }
  }, 1000)
  say(bot, `👣 Je te suis, ${username} !`)
}

function status (bot) {
  const p = loadProgress()
  const done = p.done ?? []
  const next = PHASES.find((ph) => !done.includes(ph.key))
  const workshopsDone = done.filter((k) => k.startsWith('atelier_')).length
  say(bot, `📊 Progression : ${done.length}/${PHASES.length} phases (ateliers succès : ${workshopsDone}/6). Prochaine : ${next ? next.label : 'terminé !'}`)
}

// ---------- Exécution de la mission ----------

async function runMission (bot, cfg, { fromStart = false } = {}) {
  if (state.running) { say(bot, '⏳ La mission tourne déjà'); return }
  state.running = true
  state.paused = false
  state.abort = false
  try {
    const progress = fromStart ? { done: [] } : loadProgress()
    progress.done ??= []
    for (const ph of PHASES) {
      if (progress.done.includes(ph.key)) {
        log(`⏭️ Phase déjà faite : ${ph.label}`)
        continue
      }
      // attendre si en pause (ou interrompre si le bot est mort)
      while ((state.paused || bot._fleeing) && !state.abort) await sleep(2000)
      if (state.abort) throw Object.assign(new Error('mission interrompue par une mort'), { aborted: true })
      say(bot, `━━━ ▶ Phase ${ph.label} ━━━`)
      let ok = false
      // stratégie apprise : une phase qui échoue souvent recevra plus de tentatives
      const strat = learn.phaseStrategy(ph.key)
      const reliability = learn.phaseReliability(ph.key)
      if (reliability !== null && reliability < 0.5) log(`📉 Phase ${ph.label} peu fiable (${Math.round(reliability * 100)}%) — j'insiste (${strat.attempts} essais)`)
      for (let attempt = 1; attempt <= strat.attempts && !ok; attempt++) {
        while ((state.paused || bot._fleeing) && !state.abort) await sleep(2000)
        if (state.abort) throw Object.assign(new Error('mission interrompue par une mort'), { aborted: true })
        const t0 = Date.now()
        try {
          await ph.run(bot, cfg, progress)
          ok = true
          learn.recordPhaseSuccess(ph.key, Date.now() - t0)
        } catch (err) {
          learn.recordPhaseFailure(ph.key, err.message)
          log(`✗ Phase "${ph.key}" tentative ${attempt}/${strat.attempts} : ${err.message}`)
          say(bot, `⚠️ Phase ${ph.label} : échec (${err.message})${attempt < strat.attempts ? ' — je réessaie' : ''}`)
          await sleep(5000)
          // se calmer : remettre les contrôles
          try { bot.pathfinder.stop() } catch {}
          try { bot.pvp.stop() } catch {}
          bot.clearControlStates?.()
        }
      }
      if (!ok) {
        say(bot, `⛔ Phase ${ph.label} bloquée après ${strat.attempts} essais. Dis-moi "reprendre" pour retenter.`)
        saveProgress(progress)
        return
      }
      if (!progress.done.includes(ph.key)) progress.done.push(ph.key)
      saveProgress(progress)
      say(bot, `✅ Phase ${ph.label} terminée (${progress.done.length}/${PHASES.length})`)
    }
    say(bot, '🏆 MISSION ACCOMPLIE : le dragon est mort et les ateliers de succès sont passés !')
    say(bot, '📊 Dis-moi "succès" pour le bilan complet des advancements.')
  } catch (err) {
    if (err.aborted) {
      log('☠️ Mission interrompue par une mort — elle repartira automatiquement (progression remise à zéro)')
    } else {
      log(`erreur mission : ${err.stack}`)
      say(bot, `💥 Erreur inattendue : ${err.message}`)
    }
  } finally {
    state.running = false
    if (state.abort) {
      // la mort a eu lieu pendant la mission : au prochain lancement on
      // repart de zéro (handleDeath a remis progress.done à [])
      state.abort = false
      if (cfg.autoMission) {
        setTimeout(() => {
          if (!state.running) runMission(bot, cfg).catch((e) => log(`mission error : ${e.stack}`))
        }, 3000)
      }
    }
  }
}

// ---------- Commandes chat ----------

// Petites réponses "pote" aux politesses en /tell (anti-spam : 60 s par joueur)
const POLITENESS = [
  { re: /merci|thanks|\bthx\b/, replies: ['de rien ! 😄', 'avec plaisir ! 🙌', 'pas de souci {user} !'] },
  { re: /\b(salut|bonjour|coucou|hello|hey|yo)\b/, replies: ['salut {user} ! 👋', 'coucou {user} ! 😄', 'hey {user} !'] },
  { re: /\b(gg|bien jou[ée]|bravo)\b/, replies: ['merci {user} ! 💪', 'gg à toi aussi ! 🎉'] },
  { re: /comment (vas|va)\b|\b(ça|ca) va\b/, replies: ["ça va super, merci ! 😊 et toi {user} ?", 'tranquille {user}, et toi ? 🙂'] }
]
const politenessCooldown = new Map()

function handlePoliteness (bot, from, msg) {
  for (const p of POLITENESS) {
    if (!p.re.test(msg)) continue
    const last = politenessCooldown.get(from) ?? 0
    if (Date.now() - last < 60000) return true
    politenessCooldown.set(from, Date.now())
    say(bot, p.replies[randInt(0, p.replies.length - 1)].replaceAll('{user}', from))
    return true
  }
  return false
}

async function handleCommand (bot, cfg, from, message) {
  const msg = message.trim().toLowerCase()
  if (!msg) return
  log(`💬 ${from}: ${message}`)

  if (handlePoliteness(bot, from, msg)) return

  if (/(stop|pause|arrête|arrete)/.test(msg)) {
    stopAll(bot)
    state.paused = true
    say(bot, '⏸️ En pause. "reprendre" pour relancer.')
  } else if (/reprendre|resume|continue/.test(msg)) {
    resume(bot)
    if (!state.running) runMission(bot, cfg).catch((e) => log(e.stack))
  } else if (/construire|build|maison/.test(msg)) {
    // "construire" ou "construire 7" : taille optionnelle (3 à 11)
    const sizeMatch = msg.match(/(\d{1,2})/)
    const size = sizeMatch ? Math.min(11, Math.max(3, parseInt(sizeMatch[1], 10))) : 5
    stopAll(bot) // on coupe la mission en cours pour ne pas se battre pour le pathfinder
    say(bot, `🏠 Je construis une maison ${size}×${size} ici`)
    try { await build.buildHouse(bot, { size }) } catch (e) { say(bot, `échec construction : ${e.message}`) }
  } else if (/ferme|farm/.test(msg)) {
    stopAll(bot)
    say(bot, '🌾 Je construis une ferme automatique ici')
    try { await build.buildFarm(bot) } catch (e) { say(bot, `échec ferme : ${e.message}`) }
  } else if (/mur|enceinte|wall|cloture/.test(msg)) {
    stopAll(bot)
    say(bot, '🧱 Je construis une enceinte de protection autour de nous')
    try { await build.buildWall(bot) } catch (e) { say(bot, `échec enceinte : ${e.message}`) }
  } else if (/pont|bridge/.test(msg)) {
    stopAll(bot)
    say(bot, '🌉 Je construis un pont devant moi')
    try { await build.buildBridge(bot, 16) } catch (e) { say(bot, `échec pont : ${e.message}`) }
  } else if (/suivre|follow/.test(msg)) {
    followUser(bot, from)
  } else if (/statut|status|progress/.test(msg)) {
    status(bot)
  } else if (/succ[eè]s|success|avancement/.test(msg)) {
    const s = advancements.summary(bot)
    say(bot, `ℹ️ ${s.manual} succès restent 100% manuels (voir README). Dis "mission" pour lancer les ateliers restants.`)
  } else if (/reset|recommencer/.test(msg)) {
    saveProgress({ done: [] })
    say(bot, '🔄 Progression remise à zéro.')
  } else if (/mission|dragon|go/.test(msg)) {
    if (!state.running) runMission(bot, cfg).catch((e) => log(e.stack))
  } else if (/mémoire|memoire|apprentissage|learn|skills/.test(msg)) {
    say(bot, `🧠 Mémoire : ${learn.summary()}`)
  }
}

module.exports = { runMission, handleCommand, handleDeath, loadProgress, saveProgress, stopAll, followUser, status, state, PHASES }
