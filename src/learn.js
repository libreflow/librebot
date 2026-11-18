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
    skills: {},        // nom -> { tries, success, lastUsed } (tir à l'arc, minage…)
    episodes: [],      // mémoire épisodique : { state, action, reward, outcome, when }
    qtable: {},        // Q-learning : 'stateKey:action' -> { q, n }
    spatialMap: {},    // mémoire spatiale : kind -> [{ x, y, z, when, value? }] (ressources, dangers, structures, biomes)
    speedrun: { attempts: 0, wins: 0, bestMs: null, bestSplits: null, lastMs: null } // chrono any% legit
  }
}

let data = load()

// Migration : si learning.json existe avec un ancien format, compléter les clés manquantes
if (!data.episodes) data.episodes = []
if (!data.qtable) data.qtable = {}
if (!data.exploreAnchor) data.exploreAnchor = null
if (!data.explore) data.explore = { angle: 0, radius: 24 }
if (!data.spatialMap) data.spatialMap = {}
if (!data.speedrun) data.speedrun = { attempts: 0, wins: 0, bestMs: null, bestSplits: null, lastMs: null }
if (!Array.isArray(data.deaths)) data.deaths = []
if (!Array.isArray(data.flees)) data.flees = []
if (!Array.isArray(data.episodes)) data.episodes = []
if (!data.discoveries) data.discoveries = {}
if (!data.skills) data.skills = {}
if (!data.phases) data.phases = {}

// Debounce : chaque record*() appelle save() mais on n'écrit sur disque que
// toutes les 3 s (ou à la fermeture). Évite des dizaines de writeFileSync
// synchrones par minute qui bloquent l'event loop.
let _dirty = false
let _saveTimer = null
function save () {
  _dirty = true
  if (_saveTimer) return
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    if (!_dirty) return
    _dirty = false
    try { fs.writeFile(LEARN_PATH, JSON.stringify(data), () => {}) } catch {}
  }, 3000)
}

// flush synchrone à la fermeture du processus
process.on('exit', () => {
  if (_dirty) { try { fs.writeFileSync(LEARN_PATH, JSON.stringify(data, null, 2)) } catch {} }
})

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
  if (!p || p.fail === 0) return { attempts: 3, timeoutScale: 1 }
  if (p.fail >= 3) return { attempts: 5, timeoutScale: 2 }
  if (p.fail >= 1) return { attempts: 4, timeoutScale: 1.5 }
  return { attempts: 3, timeoutScale: 1 }
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
  // parcourt les 10 dernières morts sans allocation (slice(-10) créait un tableau à chaque appel,
  // et cette fonction tourne à chaque tick du watchdog de survie)
  const n = data.deaths.length
  for (let i = Math.max(0, n - 10); i < n; i++) {
    const d = data.deaths[i]
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
function getNearestDiscoveries (kind, fromPos, n = 3, maxDist = 600) {
  const arr = (data.discoveries[kind] ?? [])
    .map((d) => ({ ...d, dist: Math.hypot(d.x - fromPos.x, d.z - fromPos.z) }))
    .filter((d) => d.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
  return arr
}
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

// Point d'ancrage fixe de la spirale d'exploration : la position de spawn du bot,
// mémorisée une fois pour toutes (évite que le centre de la spirale dérive avec
// le bot et l'envoie à des milliers de blocs).
function getExploreAnchor (bot) {
  if (!data.exploreAnchor && bot?.entity?.position) {
    const p = bot.entity.position.floored()
    data.exploreAnchor = { x: p.x, z: p.z }
    save()
  }
  return data.exploreAnchor ?? { x: bot?.entity?.position?.x ?? 0, z: bot?.entity?.position?.z ?? 0 }
}

function bumpExplore (maxRadius) {
  const ex = (data.explore ??= { angle: 0, radius: 24 })
  ex.angle += 0.8 // ~46° à chaque exploration
  ex.radius = Math.min(maxRadius, ex.radius + 10)
  if (ex.angle > Math.PI * 6) { ex.angle = 0; ex.radius = 24 } // après ~3 tours, on repart du centre
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

const HOSTILE_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager',
  'vindicator', 'evoker', 'ravager', 'hoglin', 'blaze', 'ghast', 'wither',
  'phantom', 'drowned', 'husk', 'stray', 'zombie_villager', 'piglin',
  'piglin_brute', 'zombified_piglin', 'magma_cube', 'slime', 'guardian', 'warden', 'breeze'
]) /* fin Set */

function detectDeathCause (bot) {
  if (!bot?.entity?.position) return 'inconnue'
  const pos = bot.entity.position.floored()
  // un hostile était juste à côté (parcours sans allocation via for...in)
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (HOSTILE_NAMES.has(e.name) && e.position?.distanceTo(pos) < 12) return 'combat:' + e.name
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
  if (airBelow >= 3) return 'chute'
  return 'inconnue'
}

function summary () {
  const phases = Object.entries(data.phases)
    .map(([k, p]) => `${k}: ${p.ok} ok / ${p.fail} échecs`)
    .join(', ')
  return `morts: ${data.deaths.length}, fuites: ${data.flees.length}, découvertes: ${Object.keys(data.discoveries).join(',') || 'aucune'} — phases: ${phases || 'aucune encore'}`
}


// ---------- Mémoire épisodique & Q-learning ----------

// Sérialise un état en clé compacte pour la Q-table et la recherche de similarité
function stateKey (state) {
  return [state.health, state.food, state.oxygen, state.night ? 'N' : 'J',
    state.dim, state.yLevel, state.hostilesNear, state.hostileDist, state.armed ? 'A' : 'a'].join('|')
}

// Enregistre un épisode de décision (sera complété par completeEpisode avec la récompense)
let _pendingEpisode = null
function recordEpisode (state, action) {
  _pendingEpisode = { state: { ...state }, action, when: new Date().toISOString() }
}

// Complète l'épisode en cours avec le résultat et met à jour la Q-table.
// reward: +1 = bonne décision, -1 = mauvaise (mort, dégâts lourds), 0 = neutre
function completeEpisode (reward, outcome = '') {
  if (!_pendingEpisode) return
  const ep = _pendingEpisode
  _pendingEpisode = null
  ep.reward = reward
  ep.outcome = outcome
  ep.stateKey = stateKey(ep.state)
  data.episodes.push(ep)
  if (data.episodes.length > 200) data.episodes = data.episodes.slice(-200)

  // Mise à jour Q-learning (moyenne incrémentale)
  const key = ep.stateKey + ':' + String(ep.action).toUpperCase()
  const q = (data.qtable[key] ??= { q: 0, n: 0 })
  q.n++
  q.q += (reward - q.q) / q.n // moyenne mobile
  save()
}

// Bonus de Q-value pour une action dans un état donné.
// Retourne un score entre -1 et +1 (positif = cette action a historiquement payé ici)
function getQBonus (action, state) {
  const key = stateKey(state) + ':' + String(action).toUpperCase()
  const q = data.qtable[key]
  if (!q || q.n < 2) return 0 // pas assez de données
  // Normaliser : q est entre -1 et +1
  return Math.max(-1, Math.min(1, q.q))
}

// Trouve les épisodes similaires à l'état courant (même contexte approximatif)
// et retourne les actions qui ont le mieux marché.
function getSimilarEpisodes (state, limit = 10) {
  const sk = stateKey(state)
  // Similarité : même dimension + même bucket de vie + même nuit/jour
  const parts = sk.split('|')
  const matches = []
  const eps = data.episodes
  // seulement les 60 derniers épisodes (mémoire récente = plus pertinente, et O(60) au lieu de O(200))
  const start = Math.max(0, eps.length - 60)
  for (let ei = eps.length - 1; ei >= start; ei--) {
    const ep = eps[ei]
    if (!ep.stateKey) continue
    const epParts = ep.stateKey.split('|')
    let score = 0
    if (epParts[2] === parts[2]) score++ // oxygen
    if (epParts[3] === parts[3]) score++ // nuit/jour
    if (epParts[4] === parts[4]) score++ // dimension
    if (epParts[0] === parts[0]) score++ // vie
    if (epParts[7] === parts[7]) score++ // distance hostile
    if (epParts[8] === parts[8]) score++ // armé
    if (score >= 4) matches.push({ ...ep, similarity: score }) // score embarqué sur l'objet (avant : push(ep, score) cassait le tri)
  }
  matches.sort((a, b) => b.similarity - a.similarity || (b.reward ?? 0) - (a.reward ?? 0))
  return matches.slice(0, limit)
}

// Quelle action a le mieux marché dans des situations similaires ?
function bestActionInSimilarSituations (state) {
  const similar = getSimilarEpisodes(state, 20)
  if (!similar.length) return null
  const votes = {}
  for (const ep of similar) {
    if (ep.reward == null) continue
    votes[ep.action] ??= { total: 0, n: 0 }
    votes[ep.action].total += ep.reward
    votes[ep.action].n++
  }
  let best = null
  let bestAvg = -Infinity
  for (const [action, v] of Object.entries(votes)) {
    const avg = v.total / v.n
    if (avg > bestAvg) { bestAvg = avg; best = { action, avg, n: v.n } }
  }
  return best
}


// ---------- Speedrun (any% legit) ----------

// Enregistre le résultat d'un run : win = dragon tué. Garde le meilleur chrono + ses splits.
function recordSpeedrunResult (won, totalMs, splits, extra = {}) {
  const s = (data.speedrun ??= { attempts: 0, wins: 0, bestMs: null, bestSplits: null, lastMs: null })
  s.attempts++
  if (won) s.wins++
  s.lastMs = totalMs
  if (won && (s.bestMs === null || totalMs < s.bestMs)) {
    s.bestMs = totalMs
    s.bestSplits = splits
  }
  // Historique des runs (pour la baseline multi-runs), plafonné à 30
  s.history ??= []
  s.history.push({ t: Date.now(), won, totalMs, splits, phaseDeltas: extra.phaseDeltas ?? {}, deaths: extra.deaths ?? 0, deathsByPhase: extra.deathsByPhase ?? {}, order: extra.order ?? [] })
  if (s.history.length > 30) s.history = s.history.slice(-30)
  save()
  return s
}

// Baseline multi-runs : durée moyenne/min/max par phase + morts par phase
function getSpeedrunBaseline () {
  const s = data.speedrun ?? {}
  const history = s.history ?? []
  const phases = {}
  const deathsByPhase = {}
  for (const r of history) {
    for (const k of Object.keys(r.phaseDeltas ?? {})) {
      (phases[k] ??= []).push(r.phaseDeltas[k])
    }
    for (const [k, n] of Object.entries(r.deathsByPhase ?? {})) {
      deathsByPhase[k] = (deathsByPhase[k] ?? 0) + n
    }
  }
  const rows = Object.entries(phases).map(([phase, deltas]) => ({
    phase,
    n: deltas.length,
    avgDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    minDelta: Math.min(...deltas),
    maxDelta: Math.max(...deltas),
    deaths: deathsByPhase[phase] ?? 0
  })).sort((a, b) => b.avgDelta - a.avgDelta) // goulot d'abord
  return { runs: history.length, wins: history.filter((r) => r.won).length, phases: rows, deathsByPhase }
}

function getSpeedrunStats () {
  return data.speedrun ?? { attempts: 0, wins: 0, bestMs: null, bestSplits: null, lastMs: null }
}

// ---------- Mémoire spatiale (où sont les choses) ----------

// Enregistre un point spatial (ressource, danger, structure, biome)
function recordSpatial (kind, pos, value = 0) {
  const arr = (data.spatialMap[kind] ??= [])
  arr.push({ x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z), value, when: new Date().toISOString() })
  if (arr.length > 100) data.spatialMap[kind] = arr.slice(-100) // garder les 100 plus récents
  save()
}

// Point spatial le plus proche d'une position, pour un kind donné (ou préfixe 'resource:diamond_ore')
function nearestSpatial (kind, fromPos, maxDist = 500) {
  const arr = data.spatialMap[kind] ?? []
  // Essayer aussi avec préfixe resource:/danger:/structure: si kind ne contient pas ':'
  let candidates = arr
  if (!kind.includes(':')) {
    candidates = [...(data.spatialMap['resource:' + kind] ?? []), ...(data.spatialMap['danger:' + kind] ?? []), ...arr]
  }
  let best = null
  let bestD = Infinity
  for (const p of candidates) {
    const d = Math.hypot(p.x - fromPos.x, p.z - fromPos.z)
    if (d < bestD && d <= maxDist) { bestD = d; best = { ...p, dist: Math.round(d) } }
  }
  return best
}

// Tous les points d'un kind dans un rayon donné
function spatialInRadius (kind, fromPos, radius) {
  const arr = data.spatialMap[kind] ?? []
  const out = []
  for (const p of arr) {
    const d = Math.hypot(p.x - fromPos.x, p.z - fromPos.z)
    if (d <= radius) out.push({ ...p, dist: Math.round(d) })
  }
  return out.sort((a, b) => a.dist - b.dist)
}

// Ressource la plus proche par valeur (diamant > fer > bois...)
function bestResourceNear (fromPos, kinds, maxDist = 500) {
  let best = null
  for (const kind of kinds) {
    const p = nearestSpatial('resource:' + kind, fromPos, maxDist)
    if (p && (!best || p.value > best.value || (p.value === best.value && p.dist < best.dist))) {
      best = p
    }
  }
  return best
}

// Zone dangereuse la plus proche (à éviter)
function nearestDangerSpatial (fromPos, maxDist = 200) {
  let best = null
  let bestD = Infinity
  for (const key of Object.keys(data.spatialMap)) {
    if (!key.startsWith('danger:')) continue
    for (const p of data.spatialMap[key]) {
      const d = Math.hypot(p.x - fromPos.x, p.z - fromPos.z)
      if (d < bestD && d <= maxDist) { bestD = d; best = { ...p, kind: key, dist: Math.round(d) } }
    }
  }
  return best
}

// Quelles ressources avons-nous déjà vues (pour le log / le cerveau) ?
function knownResources () {
  return Object.keys(data.spatialMap).filter(k => k.startsWith('resource:')).map(k => k.slice(9))
}

// Nettoyer les points trop vieux (plus de 2h) pour éviter une carte périmée
function pruneSpatial (maxAgeMs = 2 * 3600 * 1000) {
  const now = Date.now()
  for (const [kind, arr] of Object.entries(data.spatialMap)) {
    data.spatialMap[kind] = arr.filter(p => {
      try { return now - new Date(p.when).getTime() < maxAgeMs } catch { return true }
    })
    if (!data.spatialMap[kind].length) delete data.spatialMap[kind]
  }
  save()
}


// Nouveau monde : la mémoire SPATIALE et les stats de morts/liée au monde
// précédent n'ont plus aucun sens (coords différentes) — on repart à zé,
// mais on garde l'apprentissage général (phases, skills, épisodes, qtable).
function resetWorldMemory () {
  data.spatialMap = {}
  data.explore = {}
  data.exploreAnchor = null
  data.discoveries = {}
  data.deaths = []
  data.flees = []
}
module.exports = {
  getNearestDiscoveries,
  recordPhaseSuccess, recordPhaseFailure, phaseStrategy, phaseReliability,
  recordDeath, detectDeathCause, getFleeThreshold, recordFlee,
  recordDiscovery, getDiscoveries, getNearestDiscovery, getExploreAnchor,
  bumpExplore, resetExplore,
  recordSkill, skillLevel,
  adjustTargets, summary,
  recordEpisode, completeEpisode, getQBonus, getSimilarEpisodes, bestActionInSimilarSituations, stateKey,
  resetWorldMemory,
  recordSpatial, nearestSpatial, spatialInRadius, bestResourceNear, nearestDangerSpatial, knownResources, pruneSpatial,
  recordSpeedrunResult, getSpeedrunStats, getSpeedrunBaseline
}
