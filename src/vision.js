// ============================================================
// LibreBot — src/vision.js
// "Yeux" du bot : scan périodique de l'environnement pour
// reconnaître le biome, les ressources, les dangers, les
// structures et les entités proches. Alimente la mémoire
// spatiale (learn.js) et la prise de décision (decision.js).
// ============================================================
const { log, mcData, findEntities, isItemDrop } = require('./utils')
const learn = require('./learn')

// ---------- Tables de reconnaissance ----------

// Blocs marqueurs de structures générées
const STRUCTURE_MARKERS = {
  village: ['bell', 'hay_block', 'composter', 'barrel', 'smoker', 'loom', 'cartography_table'],
  desert_temple: ['tnt', 'chiseled_sandstone', 'cut_sandstone'],
  jungle_temple: ['tnt', 'mossy_cobblestone', 'chiseled_stone_bricks'],
  ocean_monument: ['prismarine', 'sea_lantern', 'dark_prismarine'],
  fortress: ['nether_bricks', 'nether_brick_fence', 'nether_wart'],
  bastion: ['polished_blackstone_bricks', 'gilded_blackstone', 'polished_blackstone'],
  stronghold: ['stone_bricks', 'mossy_stone_bricks', 'end_portal_frame', 'iron_bars'],
  mineshaft: ['oak_fence', 'rail', 'chest', 'cobweb', 'dark_oak_fence'],
  ruined_portal: ['obsidian', 'nether_portal', 'crying_obsidian', 'chest'],
  mansion: ['dark_oak_log', 'dark_oak_planks', 'birch_planks', 'wool'],
  outpost: ['dark_oak_log', 'chest', 'crossbow'],
  shipwreck: ['chest', 'dark_oak_log', 'oak_planks']
}

// Blocs marqueurs de biomes (pour reconnaître où on est)
const BIOME_MARKERS = {
  desert: ['sand', 'cactus', 'dead_bush', 'terracotta'],
  savanna: ['acacia_log', 'acacia_planks', 'coarse_dirt', 'terracotta'],
  jungle: ['jungle_log', 'vine', 'melon', 'cocoa'],
  forest: ['oak_log', 'birch_log', 'dark_oak_log', 'fern', 'lilac'],
  taiga: ['spruce_log', 'podzol', 'sweet_berry_bush', 'campfire'],
  swamp: ['vine', 'lily_pad', 'blue_orchid', 'slime_ball'],
  mountains: ['stone', 'gravel', 'snow', 'emerald_ore', 'iron_ore'],
  ocean: ['water', 'sand', 'kelp', 'seagrass', 'prismarine'],
  nether_wastes: ['netherrack', 'nether_wart'],
  crimson_forest: ['crimson_nylium', 'crimson_fungus', 'nether_wart_block'],
  warped_forest: ['warped_nylium', 'warped_fungus', 'warped_wart_block'],
  soul_sand_valley: ['soul_sand', 'soul_soil', 'soul_fire'],
  basalt_deltas: ['basalt', 'blackstone', 'magma_block'],
  the_end: ['end_stone', 'obsidian', 'end_gateway', 'purpur_block']
}

// Ressources utiles à mémoriser (avec leur "valeur")
const RESOURCE_BLOCKS = {
  water: 100, lava: 50,
  oak_log: 20, spruce_log: 20, birch_log: 20, jungle_log: 20, acacia_log: 20, dark_oak_log: 20, cherry_log: 20, mangrove_log: 20, pale_oak_log: 20,
  iron_ore: 60, deepslate_iron_ore: 60, copper_ore: 40, deepslate_copper_ore: 40,
  gold_ore: 50, deepslate_gold_ore: 50,
  diamond_ore: 200, deepslate_diamond_ore: 200,
  coal_ore: 30, deepslate_coal_ore: 30,
  lapis_ore: 40, deepslate_lapis_ore: 40,
  redstone_ore: 40, deepslate_redstone_ore: 40,
  emerald_ore: 150, deepslate_emerald_ore: 150,
  ancient_debris: 300,
  chest: 80, barrel: 60, spawner: 200,
  beehive: 70, pumpkin: 30, melon: 30,
  crafting_table: 50, furnace: 50, enchanting_table: 100,
  nether_portal: 100, end_portal: 300, end_portal_frame: 300,
  bed: 60
}

// Blocs dangereux à mémoriser comme zones à éviter
const DANGER_BLOCKS = new Set(['lava', 'magma_block', 'fire', 'campfire', 'soul_campfire', 'soul_fire', 'powder_snow'])


// Classification complète de TOUTES les entités Minecraft
const ENTITY_TYPES = {
  // Hostiles
  hostile: ['zombie','skeleton','creeper','spider','enderman','witch','pillager','vindicator','evoker','ravager','hoglin','blaze','ghast','wither','phantom','drowned','husk','stray','zombie_villager','piglin','piglin_brute','zombified_piglin','magma_cube','slime','guardian','elder_guardian','vex','warden','breeze','bogged'],
  // Animaux passifs (nourriture / élevage)
  animal: ['cow','pig','sheep','chicken','rabbit','horse','donkey','mule','llama','goat','bee','cat','wolf','parrot','turtle','frog','axolotl','ocelot','fox','panda','polar_bear','strider'],
  // Villageois & golems
  villager: ['villager','wandering_trader','iron_golem','snow_golem'],
  // Mobs aquatiques
  aquatic: ['cod','salmon','tropical_fish','pufferfish','squid','dolphin','turtle'],
  // Boss
  boss: ['ender_dragon','wither'],
  // Neutres utiles
  utility: ['item','armor_stand','item_frame','painting','arrow','egg','ender_pearl','eye_of_ender','potion','experience_bottle','tnt'],
  // Joueurs
  player: []
}
const HOSTILE_SET = new Set(ENTITY_TYPES.hostile)

// ---------- État du scan ----------
let _scanTimer = null
let _currentEnv = {
  biome: 'unknown',
  dimension: 'overworld',
  structures: [],
  resources: [],      // [{ kind, x, y, z, value, dist }]
  dangers: [],        // [{ kind, x, y, z, dist }]
  entities: [],       // [{ name, kind, dist, hostile }]
  light: 15,
  timeOfDay: 0,
  weather: 'clear',
  y: 64,
  lastScan: 0
}

// ---------- Scan principal ----------
function scan (bot) {
  const pos = bot.entity?.position
  if (!pos) return _currentEnv
  const md = mcData(bot)
  if (!md || !md.blocksByName) return _currentEnv // version non supportée ou pas encore détectée
  const now = Date.now()
  _currentEnv.lastScan = now
  _currentEnv.dimension = bot.game?.dimension ?? 'overworld'
  _currentEnv.y = Math.round(pos.y)
  _currentEnv.light = bot.blockAt(pos.floored())?.light ?? 15
  _currentEnv.timeOfDay = bot.time?.timeOfDay ?? 0
  _currentEnv.weather = bot.thunderState > 0 ? 'thunder' : (bot.rainState > 0 ? 'rain' : 'clear')

  // 1. Biome : bot.world.getBiome est ASYNC (prismarine-world) — sans traitement,
  // on récupérait une Promise et String(promise) = "[object Promise]".
  // On consomme la promesse (mise à jour différée) + fallback synchrone par blocs.
  let biome = 'unknown'
  try {
    const b = bot.world?.getBiome?.(pos.floored())
    if (b && typeof b.then === 'function') {
      b.then((realBiome) => {
        try {
          const name = (typeof realBiome === 'number' && md.biomes)
            ? (Object.values(md.biomes).find(x => x.id === realBiome)?.name ?? 'biome_' + realBiome)
            : String(realBiome)
          if (name && name !== '[object Promise]' && name !== 'unknown') {
            _currentEnv.biome = name
            learn.recordDiscovery('biome:' + name, pos)
            log('🌍 Biome reconnu : ' + name)
          }
        } catch {}
      }).catch(() => {})
    } else if (b != null && typeof b !== 'object') {
      // b peut être un ID numérique ou un nom — convertir via minecraft-data
      if (typeof b === 'number' && md.biomes) {
        const found = Object.values(md.biomes).find(x => x.id === b)
        biome = found ? found.name : 'biome_' + b
      } else {
        biome = String(b)
      }
    }
  } catch {}
  if (biome === 'unknown' || biome === '0' || biome === '[object Promise]') {
    biome = detectBiomeByBlocks(bot, md, pos)
  }
  if (biome !== _currentEnv.biome) {
    _currentEnv.biome = biome
    learn.recordDiscovery('biome:' + biome, pos)
    log('🌍 Biome reconnu : ' + biome)
  }

  // 2. Ressources et dangers dans un rayon de 48 blocs
  const resources = []
  const dangers = []
  const resourceIds = {}
  for (const [name, value] of Object.entries(RESOURCE_BLOCKS)) {
    const id = md.blocksByName[name]?.id
    if (id !== undefined) resourceIds[id] = { name, value }
  }
  const dangerIds = []
  for (const name of DANGER_BLOCKS) {
    const id = md.blocksByName[name]?.id
    if (id !== undefined) dangerIds.push(id)
  }

  // Scanner par couches de Y pour limiter le coût (le bot voit surtout autour de son Y)
  const yLevels = [-6, 0, 6].map(dy => Math.round(pos.y + dy))
  for (const y of yLevels) {
    // findBlocks avec matching combiné ressources + dangers
    const allIds = [...Object.keys(resourceIds).map(Number), ...dangerIds]
    if (!allIds.length) break
    const spots = bot.findBlocks({ matching: allIds, maxDistance: 32, count: 8 })
    for (const s of spots) {
      const b = bot.blockAt(s)
      if (!b) continue
      const dist = Math.round(s.distanceTo(pos))
      const res = resourceIds[b.type]
      if (res) {
        resources.push({ kind: res.name, x: s.x, y: s.y, z: s.z, value: res.value, dist })
      } else if (DANGER_BLOCKS.has(b.name)) {
        dangers.push({ kind: b.name, x: s.x, y: s.y, z: s.z, dist })
      }
    }
  }

  // Dédupliquer et trier par valeur/distance
  const seen = new Set()
  _currentEnv.resources = resources.filter(r => {
    const k = r.kind + ':' + r.x + ':' + r.z
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort((a, b) => (b.value - a.value) || (a.dist - b.dist)).slice(0, 20)

  _currentEnv.dangers = dangers.slice(0, 10)

  // Mémoriser les ressources de haute valeur (diamants, minerais rares, structures)
  // + les coffres (value 80) même vus de loin : ce sont des zones à fouiller plus tard
  for (const r of _currentEnv.resources) {
    if (r.value >= 100 || r.kind === 'chest' || r.kind === 'trapped_chest' || r.kind === 'barrel' || r.kind === 'shulker_box') {
      learn.recordDiscovery('resource:' + r.kind, { x: r.x, y: r.y, z: r.z })
      learn.recordSpatial('resource:' + r.kind, { x: r.x, y: r.y, z: r.z }, r.value)
    }
  }
  for (const d of _currentEnv.dangers) {
    if (d.dist < 16) learn.recordDiscovery('danger:' + d.kind, { x: d.x, y: d.y, z: d.z })
  }

  // 3. Structures détectées
  const structures = detectStructures(bot, md, pos)
  if (structures.length !== _currentEnv.structures.length || structures.some((s, i) => s !== _currentEnv.structures[i])) {
    for (const s of structures) {
      if (!_currentEnv.structures.includes(s)) {
        log('🏛️ Structure reconnue : ' + s)
        learn.recordDiscovery('structure:' + s, pos)
      }
    }
    _currentEnv.structures = structures
  }

  // 4. Entités proches — classification complète de tous les types
  const entities = []
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e.position) continue
    const dist = Math.round(e.position.distanceTo(pos))
    if (dist > 48) continue
    let kind = 'other'
    let hostile = false
    if (isItemDrop(e)) {
      kind = 'drop'
      entities.push({ name: 'item_drop', kind, dist })
    } else if (e.name) {
      if (HOSTILE_SET.has(e.name)) { kind = 'hostile'; hostile = true }
      else if (ENTITY_TYPES.animal.includes(e.name)) kind = 'animal'
      else if (ENTITY_TYPES.villager.includes(e.name)) kind = 'villager'
      else if (ENTITY_TYPES.aquatic.includes(e.name)) kind = 'aquatic'
      else if (ENTITY_TYPES.boss.includes(e.name)) { kind = 'boss'; hostile = true }
      else if (ENTITY_TYPES.utility.includes(e.name)) kind = 'projectile'
      else if (e.type === 'player' || bot.players?.[e.username ?? '']) kind = 'player'
      entities.push({ name: e.name, kind, dist, hostile })
    }
  }
  _currentEnv.entities = entities.sort((a, b) => (a.hostile ? -1 : 1) || a.dist - b.dist).slice(0, 20)

  return _currentEnv
}

// ---------- Détection de biome par blocs ----------
function detectBiomeByBlocks (bot, md, pos) {
  // UN seul findBlocks avec tous les marqueurs de biomes combinés
  const idToBiome = new Map()
  const allIds = []
  for (const [biome, blocks] of Object.entries(BIOME_MARKERS)) {
    for (const name of blocks) {
      const id = md.blocksByName[name]?.id
      if (id === undefined) continue
      idToBiome.set(id, biome)
      allIds.push(id)
    }
  }
  if (!allIds.length) return 'unknown'
  const spots = bot.findBlocks({ matching: allIds, maxDistance: 32, count: 30 })
  const counts = {}
  for (const s of spots) {
    const b = bot.blockAt(s)
    if (!b) continue
    const biome = idToBiome.get(b.type)
    if (biome) counts[biome] = (counts[biome] ?? 0) + 1
  }
  let best = 'unknown'; let bestCount = 0
  for (const [biome, count] of Object.entries(counts)) {
    if (count > bestCount) { bestCount = count; best = biome }
  }
  return best
}

// ---------- Détection de structures ----------
function detectStructures (bot, md, pos) {
  // UN seul findBlocks avec tous les marqueurs combinés (sinon ~45 findBlocks rayon 64 par scan)
  const idToStructures = new Map()
  const allIds = []
  for (const [structure, markers] of Object.entries(STRUCTURE_MARKERS)) {
    for (const name of markers) {
      const id = md.blocksByName[name]?.id
      if (id === undefined) continue
      let set = idToStructures.get(id)
      if (!set) { set = new Set(); idToStructures.set(id, set) }
      set.add(structure)
      allIds.push(id)
    }
  }
  if (!allIds.length) return []
  const spots = bot.findBlocks({ matching: allIds, maxDistance: 32, count: 40 })
  const idsSeen = new Map() // structure -> Set d'ids de marqueurs vus
  for (const s of spots) {
    const b = bot.blockAt(s)
    if (!b) continue
    const set = idToStructures.get(b.type)
    if (!set) continue
    for (const st of set) {
      let seen = idsSeen.get(st)
      if (!seen) { seen = new Set(); idsSeen.set(st, seen) }
      seen.add(b.type)
    }
  }
  const found = []
  for (const [st, seen] of idsSeen) if (seen.size >= 2) found.push(st) // 2 marqueurs différents = confirmé
  return found
}

// ---------- Démarrage du scan périodique ----------
let _entityTimer = null
function startVision (bot, intervalMs = 5000) {
  if (_scanTimer) clearInterval(_scanTimer)
  if (_entityTimer) clearInterval(_entityTimer)
  // Premier scan immédiat
  scan(bot)
  _scanTimer = setInterval(() => {
    try { scan(bot) } catch (e) { /* le scan ne doit jamais bloquer */ }
  }, intervalMs)
  // Scan d'entités rapide (1 s) pour le suivi temps réel des mobs/joueurs
  _entityTimer = setInterval(() => {
    try {
      const pos = bot.entity?.position
      if (!pos) return
      const entities = []
      for (const id in bot.entities) {
        const e = bot.entities[id]
        if (!e.position) continue
        const dist = Math.round(e.position.distanceTo(pos))
        if (dist > 32) continue
        let kind = 'other'; let hostile = false
        if (isItemDrop(e)) kind = 'drop'
        else if (e.name) {
          if (HOSTILE_SET.has(e.name)) { kind = 'hostile'; hostile = true }
          else if (ENTITY_TYPES.animal.includes(e.name)) kind = 'animal'
          else if (ENTITY_TYPES.villager.includes(e.name)) kind = 'villager'
          else if (ENTITY_TYPES.boss.includes(e.name)) { kind = 'boss'; hostile = true }
          else if (e.type === 'player') kind = 'player'
        }
        entities.push({ name: e.name ?? kind, kind, dist, hostile })
      }
      _currentEnv.entities = entities.sort((a, b) => (a.hostile ? -1 : 1) || a.dist - b.dist).slice(0, 20)
      _currentEnv.lastScan = Date.now()
    } catch {}
  }, 1000)
  log('👁️ Vision active : scan environnement ' + intervalMs / 1000 + 's + entités temps réel 1s')
  return _scanTimer
}

function stopVision () {
  if (_scanTimer) { clearInterval(_scanTimer); _scanTimer = null }
  if (_entityTimer) { clearInterval(_entityTimer); _entityTimer = null }
}

// ---------- API pour les autres modules ----------
function getEnv () { return _currentEnv }

// Ressource la plus proche d'un type donné
function nearestResource (kind) {
  const r = _currentEnv.resources.find(r => r.kind === kind)
  return r ?? null
}

// Y a-t-il un danger proche ?
function nearestDanger (maxDist = 16) {
  return _currentEnv.dangers.find(d => d.dist <= maxDist) ?? null
}

// Structure la plus proche reconnue
function hasStructure (name) {
  return _currentEnv.structures.includes(name)
}

// Résumé textuel de l'environnement (pour logs / chat)
function describe () {
  const e = _currentEnv
  const parts = []
  parts.push('biome=' + e.biome)
  parts.push('dim=' + e.dimension)
  parts.push('y=' + e.y)
  parts.push('lumière=' + e.light)
  parts.push(e.weather)
  if (e.structures.length) parts.push('structures=' + e.structures.join(','))
  if (e.resources.length) parts.push('ressources=' + e.resources.slice(0, 5).map(r => r.kind + '@' + r.dist + 'm').join(','))
  if (e.dangers.length) parts.push('dangers=' + e.dangers.slice(0, 3).map(d => d.kind + '@' + d.dist + 'm').join(','))
  const hostiles = e.entities.filter(x => x.hostile)
  if (hostiles.length) parts.push('hostiles=' + hostiles.map(h => h.name + '@' + h.dist + 'm').join(','))
  const animals = e.entities.filter(x => x.kind === 'animal')
  if (animals.length) parts.push('animaux=' + animals.slice(0,3).map(a => a.name + '@' + a.dist + 'm').join(','))
  const players = e.entities.filter(x => x.kind === 'player')
  if (players.length) parts.push('joueurs=' + players.map(p => p.name).join(','))
  return parts.join(' | ')
}

module.exports = { startVision, stopVision, scan, getEnv, nearestResource, nearestDanger, hasStructure, describe }
