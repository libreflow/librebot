// ============================================================
// LibreBot — src/speedrun.js
// Mode speedrun 100% legit (any% glitchless, comme un joueur humain) :
//  - chrono du run (démarré au premier spawn)
//  - splits par phase (comme les chronos de speedrun.com)
//  - meilleur run mémorisé dans learning.json (learn.recordSpeedrunResult)
//  - stratégie any% : bois minimal → portail 10 obsidiennes (sans les 4 coins,
//    autorisé en vanilla) → forteresse → blazes → perles la nuit → triangulation
//    du stronghold en 2 lancers d'yeux → portail de l'End → dragon.
// ============================================================
const learn = require('./learn')

let run = null // { startMs, splits: { phaseKey: elapsedMs }, phases: n }

function fmt (ms) {
  if (ms == null) return '—'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return (m > 0 ? m + 'm ' : '') + (s % 60) + 's'
}

function isRunning () { return !!run }

function startRun (log) {
  run = { startMs: Date.now(), splits: {}, done: 0 }
  if (log) log('⏱️ SPEEDRUN lancé — any% legit, objectif : le dragon le plus vite possible !')
  return run
}

// Enregistre le split d'une phase qui vient de se terminer
function split (phaseKey, label, log) {
  if (!run) return null
  const elapsed = Date.now() - run.startMs
  run.splits[phaseKey] = elapsed
  run.done++
  if (log) log(`⏱️ split ${label} : ${fmt(elapsed)} (total ${run.done} phases)`)
  return elapsed
}

// Termine le run (won = dragon tué) et persiste le résultat
function finish (won, log) {
  if (!run) return null
  const totalMs = Date.now() - run.startMs
  const stats = learn.recordSpeedrunResult(won, totalMs, run.splits)
  if (log) {
    log(`⏱️ Run terminé en ${fmt(totalMs)} — ${won ? '🏆 VICTOIRE (dragon tué)' : '❌ run interrompu'}`)
    if (stats.bestMs) log(`⏱️ Meilleur run : ${fmt(stats.bestMs)} (${stats.wins}/${stats.attempts} victoires)`)
  }
  const res = { totalMs, splits: run.splits, stats }
  run = null
  return res
}

// Redémarre le chrono si le bot meurt (en speedrun, chaque mort = restart du split courant)
function noteDeath (log) {
  if (!run) return
  if (log) log('☠️ Mort pendant le speedrun — le chrono continue (les splits restent valides)')
}

// Rapport textuel pour le chat / dashboard
function status () {
  const stats = learn.getSpeedrunStats()
  const cur = run ? { elapsed: Date.now() - run.startMs, splits: run.splits, done: run.done } : null
  return { current: cur, best: stats.bestMs, bestSplits: stats.bestSplits, attempts: stats.attempts, wins: stats.wins, lastMs: stats.lastMs }
}

function describe () {
  const s = status()
  const lines = []
  if (s.current) lines.push(`⏱️ Run en cours : ${fmt(s.current.elapsed)} (${s.current.done} phases)`)
  lines.push(`⏱️ Tentatives : ${s.attempts}, victoires : ${s.wins}` + (s.best ? `, meilleur : ${fmt(s.best)}` : ''))
  if (s.lastMs != null) lines.push(`⏱️ Dernier run : ${fmt(s.lastMs)}`)
  return lines.join(' | ')
}

module.exports = { startRun, split, finish, noteDeath, status, describe, fmt, isRunning }
