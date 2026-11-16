// ============================================================
// LibreBot — src/mission.js
// Orchestrateur : séquence de phases, progression persistante,
// gestion des morts, commandes chat.
// ============================================================
const fs = require('fs')
const path = require('path')
const { log, say, sleep, goTo, GoalFollow } = require('./utils')
const P = require('./phases')
const P2 = require('./phases2')
const advancements = require('./advancements')
const learn = require('./learn')

const PROGRESS_PATH = path.join(__dirname, '..', 'progress.json')

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

function loadProgress () {
  try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')) } catch { return {} }
}

function saveProgress (p) {
  try { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2)) } catch (e) { log(`sauvegarde impossible : ${e.message}`) }
}

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
  saveProgress(p)
  const cause = learn.detectDeathCause(bot)
  learn.recordDeath(cause, bot)
  log(`☠️ Mort détectée (cause apprise : ${cause}) : progression remise à zéro (coordonnées conservées)`)
}

// ---------- État global ----------

const state = {
  paused: false,
  running: false,
  followTimer: null,
  bot: null
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
  try {
    const progress = fromStart ? { done: [] } : loadProgress()
    progress.done ??= []
    for (const ph of PHASES) {
      if (progress.done.includes(ph.key)) {
        log(`⏭️ Phase déjà faite : ${ph.label}`)
        continue
      }
      // attendre si en pause
      while (state.paused || bot._fleeing) await sleep(2000)
      say(bot, `━━━ ▶ Phase ${ph.label} ━━━`)
      let ok = false
      // stratégie apprise : une phase qui échoue souvent recevra plus de tentatives
      const strat = learn.phaseStrategy(ph.key)
      const reliability = learn.phaseReliability(ph.key)
      if (reliability !== null && reliability < 0.5) log(`📉 Phase ${ph.label} peu fiable (${Math.round(reliability * 100)}%) — j'insiste (${strat.attempts} essais)`)
      for (let attempt = 1; attempt <= strat.attempts && !ok; attempt++) {
        while (state.paused || bot._fleeing) await sleep(2000)
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
    log(`erreur mission : ${err.stack}`)
    say(bot, `💥 Erreur inattendue : ${err.message}`)
  } finally {
    state.running = false
  }
}

// ---------- Commandes chat ----------

async function handleCommand (bot, cfg, from, message) {
  const msg = message.trim().toLowerCase()
  if (!msg) return
  log(`💬 ${from}: ${message}`)

  if (/(stop|pause|arrête|arrete)/.test(msg)) {
    stopAll(bot)
    state.paused = true
    say(bot, '⏸️ En pause. "reprendre" pour relancer.')
  } else if (/reprendre|resume|continue/.test(msg)) {
    resume(bot)
    if (!state.running) runMission(bot, cfg).catch((e) => log(e.stack))
  } else if (/construire|build/.test(msg)) {
    say(bot, '🏠 Je construis une maison ici')
    try { await P.phaseBase(bot, cfg, loadProgress()) } catch (e) { say(bot, `échec construction : ${e.message}`) }
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
