// ============================================================
// LibreBot — src/learn.js
// Apprentissage autonome : mémoire persistante des succès,
// échecs, morts et découvertes. Le bot ajuste tout seul ses
// seuils de fuite, ses cibles de récolte et ses stratégies de
// phase en fonction de son expérience passée.
// ============================================================
const fs = require('fs')
const path = require('path')

const LEARN_PATH = path.join(__dirname, '..', 'learning.json')

function load () {
  try { return JSON.parse(fs.readFileSync(LEARN_PATH, 'utf8')) } catch { /* premier run */ }
  return {
    version: 1,
    phases: {},        // key -> { ok, fail, totalMs, lastError, lastMs }
    deaths: [],        // { cause, x, y, z, health, timeOfDay, when }
    flees: [],         // { survived, healthAtFlee, threat }
    discoveries: {},   // kind -> [{ x, y, z, when }] (forteresse, village, ruche…)
    skills: {}         // nom -> { tries, success, lastUsed } (tir à l'arc, minage…)
  }
}

let data = load()

function save () {
  try { fs.writeFileSync(LEARN_PATH, JSON.stringify(data, null, 2)) } catch {}
}

// ---------- Phases ----------

function recordPhaseSuccess (key, ms) {
  const p = (data.phases[key] ??= { ok: 0, fail: 0, totalMs: 0, lastError: null, lastMs: 0 })
  p.ok++
  p.totalMs += ms
  p.lastMs = ms
  save()
}

function recordPhaseFailure (key, errMsg) {
  const p = (data.phases[key] ??= { ok: 0, fail: 0, totalMs: 0, lastError: null, lastMs: 0 })
  p.fail++
  p.lastError = String(errMsg).slice(0, 200)
  save()
}

// Stratégie apprise pour une phase : plus elle a échoué, plus on insiste
// longtemps la prochaine fois.
function phaseStrategy (key) {
  const p = data.phases[key]
  if (!p || p.fail === 0) return { attempts: 5, timeoutScale: 1 }
  if (p.fail >= 3) return { attempts: 8, timeoutScale: 2 }
  if (p.fail >= 1) return { attempts: 6, timeoutScale: 1.5 }
  return { attempts: 5, timeoutScale: 1 }
}

function phaseReliability (key) {
  const p = data.phases[key]
  if (!p || p.ok + p.fail === 0) return null
  return p.ok / (p.ok + p.fail)
}

// ---------- Mortalité ----------

function recordDeath (cause, bot) {
  const pos = bot?.entity?.position?.floored() ?? { x: 0, y: 0, z: 0 }
  data.deaths.push({
    cause,
    x: pos.x, y: pos.y, z: pos.z,
    health: Math.round(bot?.health ?? 0),
    timeOfDay: bot?.time?.timeOfDay ?? 0,
    when: new Date().toISOString()
  })
  if (data.deaths.length > 50) data.deaths = data.deaths.slice(-50)
  save()
}

// Seuil de fuite adaptatif : si le bot est mort avec plus de vie que le
// seuil actuel, il augmente le seuil (il fuit plus tôt la prochaine fois).
function getFleeThreshold () {
  let threshold = 8
  for (const d of data.deaths.slice(-10)) {
    if (d.cause !== 'combat' && d.cause !== 'mob') continue
    if (d.health >= threshold) threshold = Math.min(14, d.health + 2)
  }
  return threshold
}

function recordFlee (survived, healthAtFlee, threat) {
  data.flees.push({ survived, healthAtFlee: Math.round(healthAtFlee), threat, when: new Date().toISOString() })
  if (data.flees.length > 50) data.flees = data.flees.slice(-50)
  save()
}

// ---------- Découvertes ----------

function recordDiscovery (kind, pos) {
  const arr = (data.discoveries[kind] ??= [])
  arr.push({ x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z), when: new Date().toISOString() })
  if (arr.length > 20) data.discoveries[kind] = arr.slice(-20)
  save()
}

function getDiscoveries (kind) {
  return data.discoveries[kind] ?? []
}

// Découverte la plus proche d'une position donnée
function getNearestDiscovery (kind, fromPos) {
  const arr = data.discoveries[kind] ?? []
  let best = null
  let bestD = Infinity
  for (const d of arr) {
    const dist = Math.hypot(d.x - fromPos.x, d.z - fromPos.z)
    if (dist < bestD) { bestD = dist; best = d }
  }
  return best ? { ...best, dist: bestD } : null
}

// ---------- Exploration en spirale (évite de revisiter les mêmes zones) ----------

function bumpExplore (maxRadius) {
  const ex = (data.explore ??= { angle: 0, radius: 24 })
  ex.angle += 0.8 // ~46° à chaque exploration
  ex.radius = Math.min(maxRadius, ex.radius + 10)
  save()
  return ex
}

function resetExplore () {
  data.explore = { angle: 0, radius: 24 }
  save()
}

// ---------- Compétences ----------

function recordSkill (name, success) {
  const s = (data.skills[name] ??= { tries: 0, success: 0, lastUsed: null })
  s.tries++
  if (success) s.success++
  s.lastUsed = new Date().toISOString()
  save()
}

function skillLevel (name) {
  const s = data.skills[name]
  if (!s || s.tries === 0) return 0
  return s.success / s.tries
}

// ---------- Ajustement auto des cibles ----------

// Réduit les objectifs de récolte selon ce qu'on a déjà en inventaire,
// pour ne pas farmer inutilement (ex: 32 diamants alors qu'on en a 20).
function adjustTargets (cfg, bot) {
  const inv = {}
  for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] ?? 0) + i.count
  const map = {
    rawIron: 'raw_iron', diamonds: 'diamond', obsidian: 'obsidian',
    blazeRods: 'blaze_rod', enderPearls: 'ender_pearl', enderEyes: 'ender_eye'
  }
  for (const [key, item] of Object.entries(map)) {
    const have = inv[item] ?? 0
    if (have >= cfg.targets[key]) cfg.targets[key] = 0
    else cfg.targets[key] = Math.max(0, cfg.targets[key] - have)
  }
  return cfg.targets
}

// ---------- Détection de la cause de mort ----------

const HOSTILE_NAMES = [
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager',
  'vindicator', 'evoker', 'ravager', 'hoglin', 'blaze', 'ghast', 'wither',
  'phantom', 'drowned', 'husk', 'stray', 'zombie_villager', 'piglin',
  'piglin_brute', 'zombified_piglin', 'magma_cube', 'slime', 'guardian', 'warden', 'breeze'
]

function detectDeathCause (bot) {
  if (!bot?.entity?.position) return 'inconnue'
  const pos = bot.entity.position.floored()
  // un hostile était juste à côté
  for (const e of Object.values(bot.entities)) {
    if (HOSTILE_NAMES.includes(e.name) && e.position?.distanceTo(pos) < 8) return 'combat:' + e.name
  }
  // lave / feu autour
  for (const [dx, dy, dz] of [[0, -1, 0], [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    if (b && ['lava', 'fire', 'magma_block'].includes(b.name)) return 'environnement:' + b.name
  }
  // vide sous les pieds (chute probable)
  let airBelow = 0
  for (let dy = -1; dy >= -6; dy--) {
    const b = bot.blockAt(pos.offset(0, dy, 0))
    if (!b || b.name === 'air' || b.name === 'cave_air') airBelow++
    else break
  }
  if (airBelow >= 5) return 'chute'
  return 'inconnue'
}

function summary () {
  const phases = Object.entries(data.phases)
    .map(([k, p]) => `${k}: ${p.ok} ok / ${p.fail} échecs`)
    .join(', ')
  return `morts: ${data.deaths.length}, fuites: ${data.flees.length}, découvertes: ${Object.keys(data.discoveries).join(',') || 'aucune'} — phases: ${phases || 'aucune encore'}`
}

module.exports = {
  recordPhaseSuccess, recordPhaseFailure, phaseStrategy, phaseReliability,
  recordDeath, detectDeathCause, getFleeThreshold, recordFlee,
  recordDiscovery, getDiscoveries, getNearestDiscovery,
  bumpExplore, resetExplore,
  recordSkill, skillLevel,
  adjustTargets, summary
}
