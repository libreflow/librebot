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
  run = { startMs: Date.now(), splits: {}, order: [], done: 0, deaths: 0, deathsByPhase: {}, phase: null }
  if (log) log('⏱️ SPEEDRUN lancé — any% legit, objectif : le dragon le plus vite possible !')
  return run
}

// Phase en cours (pour attribuer les morts à la bonne phase)
function setPhase (phaseKey) {
  if (!run) return
  run.phase = phaseKey
}

// Enregistre le split d'une phase qui vient de se terminer
function split (phaseKey, label, log) {
  if (!run) return null
  const elapsed = Date.now() - run.startMs
  run.splits[phaseKey] = elapsed
  if (!run.order.includes(phaseKey)) run.order.push(phaseKey)
  run.done++
  if (log) log(`⏱️ split ${label} : ${fmt(elapsed)} (total ${run.done} phases)`)
  return elapsed
}

// Termine le run (won = dragon tué) et persiste le résultat
function finish (won, log) {
  if (!run) return null
  const totalMs = Date.now() - run.startMs
  const phaseDeltas = {}
  let prev = 0
  for (const k of run.order) { phaseDeltas[k] = (run.splits[k] ?? 0) - prev; prev = run.splits[k] ?? prev }
  const stats = learn.recordSpeedrunResult(won, totalMs, run.splits, { phaseDeltas, deaths: run.deaths, deathsByPhase: run.deathsByPhase, order: run.order })
  if (log) {
    log(`⏱️ Run terminé en ${fmt(totalMs)} — ${won ? '🏆 VICTOIRE (dragon tué)' : '❌ run interrompu'} (` + run.order.map((k) => `${k}:${fmt(phaseDeltas[k])}`).join(' ') + `)`)
    if (stats.bestMs) log(`⏱️ Meilleur run : ${fmt(stats.bestMs)} (${stats.wins}/${stats.attempts} victoires)`)
  }
  const res = { totalMs, splits: run.splits, phaseDeltas, deaths: run.deaths, deathsByPhase: run.deathsByPhase, stats }
  run = null
  return res
}

// Redémarre le chrono si le bot meurt (en speedrun, chaque mort = restart du split courant)
function noteDeath (log) {
  if (!run) return
  run.deaths++
  const ph = run.phase ?? '?'
  run.deathsByPhase[ph] = (run.deathsByPhase[ph] ?? 0) + 1
  if (log) log(`☠️ Mort pendant le speedrun (phase ${ph}) — le chrono continue (les splits restent valides)`)
}

// Baseline agrégée multi-runs : durée moyenne par phase + morts par phase
function baseline () {
  return learn.getSpeedrunBaseline()
}

function describeBaseline () {
  const b = baseline()
  if (!b.runs) return 'Pas encore assez de runs pour une baseline. Lance plusieurs runs rush !'
  const lines = [`${b.runs} run(s), ${b.wins} victoire(s)`]
  for (const row of b.phases) {
    lines.push(`${row.phase}: ${fmt(row.avgDelta)} moyen (${fmt(row.minDelta)}–${fmt(row.maxDelta)}), ${row.deaths} mort(s)`)
  }
  return lines.join(' | ')
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

module.exports = { startRun, setPhase, split, finish, noteDeath, status, describe, baseline, describeBaseline, fmt, isRunning }
