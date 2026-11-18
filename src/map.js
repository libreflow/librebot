// ============================================================
// LibreBot — src/map.js
// Carte 2D persistante du monde exploré.
//
// Enregistre les chunks visités, les ressources trouvées, les dangers,
// les structures, et les "raccourcis" (chemins sûrs entre deux points).
// Permet au bot de naviguer intelligemment : aller vers la ressource
// connue la plus proche, éviter les zones dangereuses mémorisées,
// emprunter les chemins déjà empruntés avec succès.
// ============================================================
const fs = require('fs')
const path = require('path')

const MAP_PATH = path.join(__dirname, '..', 'worldmap.json')

let map = loadMap()

function loadMap () {
  try { return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) } catch {}
  return {
    version: 1,
    chunks: {},        // "cx,cz" -> { visited: timestamp, biome, y, danger: 0-10, resources: {kind: count} }
    pois: [],          // points d'intérêt : { kind, x, y, z, value, when } (ressource, structure, danger)
    paths: {},         // "x1,z1->x2,z2" -> { success: n, fail: n, lastUsed }
    home: null,
    spawn: null
  }
}

let _dirty = false
let _saveTimer = null
function save () {
  _dirty = true
  if (_saveTimer) return
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    if (!_dirty) return
    _dirty = false
    try { fs.writeFile(MAP_PATH, JSON.stringify(map), () => {}) } catch {}
  }, 5000)
}
process.on('exit', () => { if (_dirty) { try { fs.writeFileSync(MAP_PATH, JSON.stringify(map)) } catch {} } })

// ---------- Chunks ----------
function chunkKey (cx, cz) { return cx + ',' + cz }

function visitChunk (cx, cz, biome = null, y = null) {
  const k = chunkKey(cx, cz)
  const existed = !!map.chunks[k]
  const c = (map.chunks[k] ??= { visited: 0, biome: null, y: null, danger: 0, resources: {} })
  c.visited = Date.now()
  // cap mémoire : au-delà de 3000 chunks, on oublie les 500 plus vieux
  if (!existed) {
    const keys = Object.keys(map.chunks)
    if (keys.length > 3000) {
      keys.sort((a, b) => (map.chunks[a].visited ?? 0) - (map.chunks[b].visited ?? 0))
      for (let i = 0; i < 500; i++) delete map.chunks[keys[i]]
    }
  }
  if (biome) c.biome = biome
  if (y != null) c.y = y
  save()
  return c
}

function markDanger (cx, cz, level = 1) {
  const k = chunkKey(cx, cz)
  const c = (map.chunks[k] ??= { visited: 0, biome: null, y: null, danger: 0, resources: {} })
  c.danger = Math.min(10, c.danger + level)
  save()
}

function markResource (cx, cz, kind) {
  const k = chunkKey(cx, cz)
  const c = (map.chunks[k] ??= { visited: 0, biome: null, y: null, danger: 0, resources: {} })
  c.resources[kind] = (c.resources[kind] ?? 0) + 1
  save()
}

function chunkDanger (cx, cz) {
  return map.chunks[chunkKey(cx, cz)]?.danger ?? 0
}

// ---------- POIs (points d'intérêt) ----------
function addPOI (kind, x, y, z, value = 0) {
  const rx = Math.round(x); const ry = Math.round(y); const rz = Math.round(z)
  // dédup : même kind à moins de 6 blocs = on rafraîchit au lieu de créer un doublon
  // (sinon le scan vision toutes les 10s recrée les mêmes POIs à l'infini)
  const from = Math.max(0, map.pois.length - 120)
  for (let i = map.pois.length - 1; i >= from; i--) {
    const p = map.pois[i]
    if (p.kind === kind && Math.abs(p.x - rx) <= 6 && Math.abs(p.z - rz) <= 6) {
      p.when = new Date().toISOString()
      if (value > p.value) p.value = value
      save()
      return
    }
  }
  map.pois.push({ kind, x: rx, y: ry, z: rz, value, when: new Date().toISOString() })
  if (map.pois.length > 300) map.pois = map.pois.slice(-300)
  save()
}

// POI le plus proche d'un type donné
function nearestPOI (kind, fromX, fromZ, maxDist = 1000) {
  let best = null; let bestD = Infinity
  for (const p of map.pois) {
    if (p.kind !== kind && !p.kind.startsWith(kind)) continue
    const d = Math.hypot(p.x - fromX, p.z - fromZ)
    if (d < bestD && d <= maxDist) { bestD = d; best = { ...p, dist: Math.round(d) } }
  }
  return best
}

// Tous les POIs d'un type dans un rayon
function poisInRadius (kind, fromX, fromZ, radius) {
  return map.pois
    .filter(p => (p.kind === kind || p.kind.startsWith(kind)) && Math.hypot(p.x - fromX, p.z - fromZ) <= radius)
    .map(p => ({ ...p, dist: Math.round(Math.hypot(p.x - fromX, p.z - fromZ)) }))
    .sort((a, b) => a.dist - b.dist)
}

// ---------- Chemins (raccourcis appris) ----------
function recordPath (fromX, fromZ, toX, toZ, success) {
  const k = Math.round(fromX) + ',' + Math.round(fromZ) + '->' + Math.round(toX) + ',' + Math.round(toZ)
  const p = (map.paths[k] ??= { success: 0, fail: 0, lastUsed: 0 })
  if (success) p.success++; else p.fail++
  p.lastUsed = Date.now()
  save()
}

// Ce chemin a-t-il déjà réussi ?
function pathReliability (fromX, fromZ, toX, toZ) {
  const k = Math.round(fromX) + ',' + Math.round(fromZ) + '->' + Math.round(toX) + ',' + Math.round(toZ)
  const p = map.paths[k]
  if (!p || p.success + p.fail === 0) return null
  return p.success / (p.success + p.fail)
}

// ---------- Zones sûres / dangereuses ----------
// Chunk sûr = visité, danger faible
function isSafeChunk (cx, cz) {
  const c = map.chunks[chunkKey(cx, cz)]
  return c && c.danger <= 3
}

// ---------- Stats ----------
function stats () {
  const chunks = Object.keys(map.chunks).length
  const pois = map.pois.length
  const paths = Object.keys(map.paths).length
  const dangers = Object.values(map.chunks).filter(c => c.danger > 5).length
  return { chunks, pois, paths, dangerZones: dangers, home: map.home, spawn: map.spawn }
}

module.exports = {
  visitChunk, markDanger, markResource, chunkDanger,
  addPOI, nearestPOI, poisInRadius,
  recordPath, pathReliability, isSafeChunk,
  setHome: (x, y, z) => { map.home = [Math.round(x), Math.round(y), Math.round(z)]; save() },
  setSpawn: (x, y, z) => { map.spawn = [Math.round(x), Math.round(y), Math.round(z)]; save() },
  getHome: () => map.home,
  getSpawn: () => map.spawn,
  stats, _map: map
}
