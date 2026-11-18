// ============================================================
// LibreBot — src/utils.js
// Boîte à outils générique : déplacements, craft, fonte, combat,
// construction de blocs, minage en branche, seau/obsidienne…
// ============================================================
const { Vec3 } = require('vec3')
const {
  Movements,
  goals: { GoalNear, GoalXZ, GoalY, GoalBlock, GoalFollow }
} = require('mineflayer-pathfinder')
const { findFromVein } = require('mineflayer-collectblock/lib/BlockVeins')
const learn = require('./learn')
const legit = require('./legit')
const map = require('./map') // pas de cycle : map.js ne requiert que fs/path

// log/say viennent de chat.js (système de messages amélioré avec variations,
// anti-spam, et messages contextuels). On réexporte pour compatibilité.
const chatModule = require('./chat')
const { log, say, proactive, announce, logThrottle } = chatModule
const chat = chatModule.chat
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const randInt = (a, b) => Math.floor(rand(a, b + 1))

function withTimeout (promise, ms) {
  return Promise.race([
    promise,
    sleep(ms).then(() => { throw new Error(`délai dépassé (${Math.round(ms / 1000)}s)`) })
  ])
}

// cache par version : minecraft-data(version) reconstruit tout l'objet à chaque
// appel, et mcData() est appelé des dizaines de fois par seconde (watchdog 1 Hz inclus)
const _mcDataCache = {}
const mcData = (bot) => _mcDataCache[bot.version] ??= require('minecraft-data')(bot.version)

// id de bloc sûr : null si le bloc n'existe pas dans cette version de Minecraft.
// Évite bot.findBlock({ matching: undefined }) qui matcherait TOUS les blocs
// (comportement mineflayer) et renverrait n'importe quel bloc comme cible.
const blockId = (bot, name) => mcData(bot).blocksByName[name]?.id ?? null

// cache des ids de logs par version (évite de parcourir tous les blocs à chaque explore)
const _logIdsCache = {}

// cache des recettes par version+item (recipesAll est coûteux, appelé à chaque craftItem)
const _recipesCache = {}

// Dig optimisé : équipe le meilleur outil (mineflayer-tool) puis creuse avec timeout.
// Remplace les bot.dig() nus qui minent lentement avec l'outil tenu en main.
async function digBlock (bot, block, timeoutMs = 8000) {
  // Garde-fou anti mine-dans-le-vide : re-vérifier que le bloc existe AU MOMENT du dig.
  // Si cassé entre-temps (veine, autre joueur, explosion), bot.dig() bloque sur de l'air.
  const fresh = bot.blockAt(block.position)
  if (!fresh || fresh.name === 'air' || fresh.name === 'cave_air' || fresh.name === 'void_air' || fresh.boundingBox === 'empty') {
    throw new Error('bloc déjà cassé: ' + block.name + ' @ ' + block.position)
  }
  // Anti-cheat : portée + ligne de vue (pas de minage à travers les murs ou à 10 blocs)
  if (!legit.canReach(bot, block.position)) {
    throw new Error('bloc hors de portée ou sans ligne de vue: ' + block.name + ' @ ' + block.position)
  }
  try { if (bot.tool?.equipForBlock) await bot.tool.equipForBlock(fresh) } catch {}
  // Timeout ADAPTATIF : un plafond fixe à 4 s rendait l'obsidienne inminable
  // (9,4 s avec une pioche diamant — réf. Minecraft Wiki, hardness 50).
  // Quand withTimeout jette, bot.dig() continue en arrière-plan : le bloc finit
  // par tomber mais le code croit à un échec → double minage, drops non comptés.
  // On estime le temps de minage depuis la dureté du bloc (hardness vanilla :
  // temps ≈ hardness × 1,5 s avec le bon outil) et on ajoute une marge réseau.
  const hardness = fresh.hardness ?? 1
  const estMs = hardness > 0 ? hardness * 1500 : Infinity // bedrock (hardness -1) = jamais
  const limit = Number.isFinite(estMs)
    ? Math.min(Math.max(timeoutMs, estMs + 2500), 30000) // plancher = timeout demandé, plafond 30 s
    : Math.min(timeoutMs, 5000) // bloc incassable : on abandonne vite
  await withTimeout(bot.dig(fresh), limit)
}

function countItem (bot, name) {
  // boucle simple : évite l'allocation d'un tableau par filter() + le second parcours de reduce()
  let n = 0
  for (const i of bot.inventory.items()) if (i.name === name) n += i.count
  return n
}

// Bloc « solide plein » : prismarine-block renvoie boundingBox 'block' (et 'empty'),
// JAMAIS 'solid' — tous les anciens tests `=== 'solid'` étaient donc toujours FAUX.
function isSolidBlock (b) {
  return !!b && (b.boundingBox === 'block' || b.boundingBox === 'solid')
}

// Vrai si l'inventaire contient au moins un des noms — UN SEUL passage
// (évite d'appeler countItem() N fois = N parcours complets de l'inventaire)
function hasAnyItem (bot, names) {
  const set = names instanceof Set ? names : new Set(names)
  for (const i of bot.inventory.items()) if (set.has(i.name)) return true
  return false
}

// Parcourt bot.entities sans allocation (évite Object.values qui crée un tableau).
// Retourne le premier match (find) ou tous les matchs (filter) selon `firstOnly`.
function findEntities (bot, predicate, { firstOnly = true } = {}) {
  if (firstOnly) {
    for (const id in bot.entities) {
      const e = bot.entities[id]
      if (predicate(e)) return e
    }
    return null
  }
  const out = []
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (predicate(e)) out.push(e)
  }
  return out
}

async function equipName (bot, name, dest = 'hand') {
  const item = bot.inventory.items().find((i) => i.name === name)
  if (!item) throw new Error(`équipement introuvable : ${name}`)
  await bot.equip(item, dest)
}

// ---------- Déplacements ----------

function setMovements (bot) {
  // cache PAR DIMENSION : les garde-fous du Nether ne doivent pas s'appliquer
  // à l'overworld (et réciproquement). Avant, un seul objet Movements servait partout,
  // créé dans la première dimension visitée.
  const dim = bot.game?.dimension ?? 'overworld'
  if (!bot._librebotMovementsByDim) bot._librebotMovementsByDim = {}
  let movements = bot._librebotMovementsByDim[dim]
  if (!movements) {
    movements = new Movements(bot)
    movements.canDig = true
    movements.allowSprinting = true
    movements.allowParkour = true
    // NOTE : movements.maxDropHeight n'existe PAS dans mineflayer-pathfinder 2.4.5
    // (vérifié dans lib/movements.js) — l'assigner était silently ignoré. La protection
    // contre les chutes > 3 blocs est assurée par le watchdog de survie (survie.js,
    // détection de chute libre + pose d'un bloc d'amortissement) et par walkDirect
    // (détection de trou devant). On évite juste la lave via blocksToAvoid (défaut).
    movements.allow1by1towers = true // peut pillar 1x1 si besoin
    if (dim === 'the_nether') {
      // GARDE-FOU NETHER (exigé par le workflow speedrun) : pas de sauts parkour —
      // un atterrissage manqué = lac de lave. Les autres mouvements restent sûrs :
      // le pathfinder ne pose jamais le bot sur/à côté d'un liquide de toute façon
      movements.allowParkour = false
      movements.allowSprinting = true // sprint sol/plafond ok
    }
    bot._librebotMovementsByDim[dim] = movements
  }
  bot.pathfinder.setMovements(movements)
  // A* plus rapide : 100 ms de calcul par tick (au lieu de 50) divise par ~2
  // le nombre de ticks nécessaires, donc le temps réel pour trouver un chemin.
  // thinkTimeout reste le plafond de sécurité si aucun chemin n'existe.
  bot.pathfinder.thinkTimeout = 20000
  bot.pathfinder.tickTimeout = 200
  // collectBlock a ses propres movements : même réglage
  if (bot.collectBlock) {
    bot.collectBlock.movements = movements
  }
  bot._librebotMovements = movements // rétrocompat
}

// Extrait le point visé par un goal pathfinder (GoalNear / GoalBlock / GoalXZ)
function goalPoint (bot, goal) {
  if (typeof goal?.x === 'number' && typeof goal?.z === 'number') {
    return {
      x: goal.x,
      y: typeof goal.y === 'number' ? goal.y : bot.entity.position.y,
      z: goal.z,
      range: goal.range ?? 2
    }
  }
  return null
}

// Marche directe façon joueur : pas de A*. On vise la cible, on avance
// (sprint si loin et sans danger), on saute les obstacles/trous, on mine
// ce qui bloque, on contourne latéralement si coincé, et on abandonne
// vite (le pathfinder prendra le relais) si un grand trou bloque le passage.
const DEBUG_WALK = !!process.env.LIBREBOT_DEBUG
const VOID_NAMES = new Set(['air', 'cave_air', 'water', 'lava'])
const isVoid = (b) => !b || VOID_NAMES.has(b.name)
const AIR_NAMES = new Set(['air', 'cave_air', 'void_air'])
const isAir = (b) => !b || AIR_NAMES.has(b.name)
const isWater = (b) => !!b && b.name === 'water'
const isLava = (b) => !!b && b.name === 'lava'

// Détection robuste d'un drop d'item (le nom d'entité varie selon les versions :
// 'item', 'item_stack', ou undefined avec objectData sur les versions récentes)
function isItemDrop (e) {
  if (!e || e.type !== 'object') return false
  const n = (e.name ?? '').toLowerCase()
  if (n.includes('item')) return true
  if ((e.displayName ?? '').toLowerCase().includes('item')) return true
  // Sur les versions récentes, les drops ont objectData avec un item
  if (e.objectData !== undefined || e.metadata?.[8]?.itemId !== undefined) return true
  return false
}

// Détecte les changements de blocs à proximité pour repérer les drops
function watchBlockChanges (bot) {
  if (bot._blockWatchInstalled) return
  bot._blockWatchInstalled = true
  bot.on('blockUpdate', (oldBlock, newBlock) => {
    if (isSolidBlock(oldBlock) && (newBlock.name === 'air' || newBlock.name === 'cave_air')) {
      const pos = bot.entity?.position
      if (pos && newBlock.position.distanceTo(pos) < 10) {
        setTimeout(() => {
          const drop = bot.nearestEntity((e) => isItemDrop(e) && e.position.distanceTo(newBlock.position) < 3)
          if (drop) log('📦 drop après casse à ' + newBlock.position)
        }, 300)
      }
    }
  })
}


async function walkDirect (bot, tx, ty, tz, { range = 2.5, timeoutMs = 20000, ignoreFlee = false } = {}) {
  if (!bot.entity?.position) return false
  const target = new Vec3(tx, ty, tz)
  const t0 = Date.now()
  let lastPos = bot.entity.position.clone()
  let lastMove = Date.now()
  let lastDig = 0
  let strafeUntil = 0
  let strafeDir = 1
  let lastDbg = 0
  let lastLook = 0 // lookAt throttle : 1 paquet réseau toutes les 300 ms, pas 10/s
  const clear = () => { for (const s of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) bot.setControlState(s, false) }
  try {
    while (Date.now() - t0 < timeoutMs) {
      if (bot._fleeing && !ignoreFlee) return false
      const pos = bot.entity.position
      const d2 = Math.hypot(target.x - pos.x, target.z - pos.z)
      // arrivé = à côté horizontalement (un joueur ne vise pas le même Y exact)
      if (d2 <= range && Math.abs(pos.y - target.y) <= 2.5) return true
      // viser un peu vers le bas si on descend (throttle : lookAt = paquet réseau à chaque appel)
      if (Date.now() - lastLook > 300) {
        lastLook = Date.now()
        bot.lookAt(target.y < pos.y - 2 ? target : target.offset(0, 1, 0)).catch(() => {})
      }
      bot.setControlState('forward', true)
      const dx = target.x - pos.x; const dz = target.z - pos.z
      const len = Math.hypot(dx, dz) || 1
      const fx = Math.floor(pos.x + dx / len); const fz = Math.floor(pos.z + dz / len)
      const fy = Math.floor(pos.y)
      // sonde devant : profondeur de VIDE (air uniquement — l'eau n'est pas un trou,
      // un joueur nage) + obstacle solide (pieds/tête) + lave = danger mortel
      let depth = 0
      for (let dy = -1; dy >= -4 && depth < 4; dy--) {
        if (isAir(bot.blockAt(new Vec3(fx, fy + dy, fz)))) depth++
        else break
      }
      const aheadFeet = bot.blockAt(new Vec3(fx, fy, fz))
      const aheadHead = bot.blockAt(new Vec3(fx, fy + 1, fz))
      if (isLava(aheadFeet) || isLava(aheadHead)) { logThrottle('lava', '🌋 Lave devant — je recule, danger mortel'); return false }
      const inWater = isWater(aheadFeet) || isWater(aheadHead) || isWater(bot.blockAt(pos.floored()))
      const obstacle = [aheadFeet, aheadHead].find((b) => b && !isVoid(b))
      // trou = vide d'air devant (pas de l'eau) ; dans l'eau on nage vers la surface
      const holeAhead = depth >= 2 && !inWater && target.y >= pos.y - 1.5
      // pas de sprint dans le vide
      bot.setControlState('sprint', d2 > 12 && !holeAhead)
      if (DEBUG_WALK && Date.now() - lastDbg > 2000) {
        lastDbg = Date.now()
        log(`🚶 pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) dist=${d2.toFixed(1)} yaw=${(bot.entity.yaw ?? 0).toFixed(2)} stuck=${Date.now() - lastMove}ms`)
      }
      // blocage = aucun mouvement HORIZONTAL (le saut vertical ne compte pas)
      if (Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) > 0.2) { lastPos = pos.clone(); lastMove = Date.now() }
      const stuckFor = Date.now() - lastMove
      if (inWater) bot.setControlState('jump', true) // nage : remonter à la surface pour respirer
      if (stuckFor > 1200 || holeAhead) {
        bot.setControlState('jump', true) // sauter l'obstacle / le petit trou
        if (obstacle && stuckFor > 2500 && Date.now() - lastDig > 1500) {
          // re-vérifier que l'obstacle est toujours solide (sinon dig bloque = tape dans le vide)
          const freshObstacle = bot.blockAt(obstacle.position)
          if (freshObstacle && !isVoid(freshObstacle) && freshObstacle.boundingBox !== 'empty') {
            lastDig = Date.now()
            logThrottle('dig:' + freshObstacle.name, `⛏️ obstacle ${freshObstacle.name} — je le mine`, 5000)
            await digBlock(bot, freshObstacle, 3000).catch(() => {})
          }
        }
        // très bloqué : contourner sur le côté comme un joueur
        if (stuckFor > 3500 && Date.now() > strafeUntil) {
          strafeDir = -strafeDir
          strafeUntil = Date.now() + 900
        }
        // grand trou devant et toujours coincé longtemps : abandon (le pathfinder tranchera).
        // Seuil relevé (depth 5, 10 s) : avant on abandonnait trop tôt et le pathfinder
        // mettait 20 s à calculer → "délai dépassé" global.
        if (depth >= 5 && stuckFor > 10000) return false
      } else {
        bot.setControlState('jump', false)
      }
      if (Date.now() < strafeUntil) {
        bot.setControlState(strafeDir > 0 ? 'left' : 'right', true)
        bot.setControlState(strafeDir > 0 ? 'right' : 'left', false)
      } else {
        bot.setControlState('left', false)
        bot.setControlState('right', false)
      }
      await sleep(60)
    }
    // succès strict : on ne valide que si on a vraiment atteint la cible
    const pos = bot.entity.position
    return Math.hypot(target.x - pos.x, target.z - pos.z) <= range + 0.3 && Math.abs(pos.y - target.y) <= 2.5
  } finally {
    clear()
  }
}

// Mutex de mouvement : un seul déplacement à la fois. Sans ça, la fuite de
// survie + la mission + la fuite post-mort lancent des goTo concurrents qui
// s'annulent mutuellement ("The goal was changed before it could be completed").
let _moveChain = Promise.resolve()
function goTo (bot, goal, opts = {}) {
  const run = _moveChain.then(async () => {
    if (opts.force) { try { bot.pathfinder.stop() } catch {} }
    const res = await _goTo(bot, goal, opts)
    // cerveau : mémoriser la fiabilité du trajet (de A vers B réussi ou raté) —
    // sert à logger les chemins peu fiables et à adapter les efforts futurs
    try {
      const from = bot.entity?.position?.floored()
      const t = goalPoint(bot, goal)
      if (from && t) {
        map.recordPath(from.x, from.z, t.x, t.z, res === true)
        const rel = map.pathReliability(from.x, from.z, t.x, t.z)
        if (res !== true && rel !== null && rel < 0.3) {
          logThrottle('pathmem', '🧠 trajet vers (' + Math.round(t.x) + ', ' + Math.round(t.z) + ') peu fiable (' + Math.round(rel * 100) + '% de réussite) — mémorisé', 30000)
        }
      }
    } catch {}
    return res
  })
  _moveChain = run.catch(() => {})
  return run
}
async function _goTo (bot, goal, { timeout = 120000, retries = 1, stuckMs = 8000, directMaxDist = 64, force = false } = {}) {
  if (!bot.entity?.position) return false
  setMovements(bot)
  // Suivi vitesse pendant le déplacement (anti-cheat interne)
  const speedTracker = setInterval(() => { try { legit.trackMovement(bot) } catch {} }, 500)
  const t0 = Date.now()
  const remaining = () => timeout - (Date.now() - t0)
  // Marche directe façon joueur, par segments de ~48 blocs pour les longues distances
  const pt = goalPoint(bot, goal)
  if (pt) {
    let dist = Math.hypot(pt.x - bot.entity.position.x, pt.z - bot.entity.position.z)
    let segmentFails = 0
    while (dist > pt.range && remaining() > 5000) {
      const pos = bot.entity.position
      if (dist > directMaxDist) {
        // segment intermédiaire vers la cible
        const ang = Math.atan2(pt.z - pos.z, pt.x - pos.x)
        const step = Math.min(48, dist - directMaxDist + 8)
        const mx = pos.x + Math.cos(ang) * step
        const mz = pos.z + Math.sin(ang) * step
        log(`🚶 marche directe (segment) vers (${Math.round(mx)}, ${Math.round(mz)}) — ${Math.round(dist)} blocs restants`)
        const ok = await walkDirect(bot, mx, pt.y, mz, { range: 2, timeoutMs: Math.min(12000, remaining()), ignoreFlee: force })
        if (!ok) { if (++segmentFails >= 2) break } else segmentFails = 0
      } else {
        log(`🚶 marche directe vers (${Math.round(pt.x)}, ${Math.round(pt.z)}) à ${Math.round(dist)} blocs`)
        const ok = await walkDirect(bot, pt.x, pt.y, pt.z, { range: pt.range, timeoutMs: Math.min(12000, remaining()), ignoreFlee: force })
        if (ok) { clearInterval(speedTracker); return true }
        logThrottle('walkfail', '🚶 marche directe échouée — je passe par le pathfinder', 8000)
        break
      }
      dist = Math.hypot(pt.x - bot.entity.position.x, pt.z - bot.entity.position.z)
      if (dist <= pt.range && Math.abs(bot.entity.position.y - pt.y) <= 2.5) return true
    }
  }
  if (remaining() <= 5000) { log('✗ déplacement échoué : plus de temps'); return false }
  let lastErr = null
  for (let i = 0; i <= retries; i++) {
    if (bot._fleeing && !force) { log('🏃 fuite en cours — trajet annulé'); return false }
    // 1er essai 20 s de calcul A* (12 s c'était trop court sur 60+ blocs avec obstacles),
    // puis 30 s au 2ème essai
    bot.pathfinder.thinkTimeout = Math.min(i === 0 ? 20000 : 30000, Math.max(5000, remaining()))
    // détection de blocage : si la position ne change plus, on force un recalcul du chemin
    let lastPos = bot.entity.position.clone()
    let lastMove = Date.now()
    const watch = setInterval(() => {
      if (bot.entity.position.distanceTo(lastPos) > 0.3) {
        lastPos = bot.entity.position.clone()
        lastMove = Date.now()
      }
    }, 500)
    const stuckKiller = setInterval(() => {
      if (Date.now() - lastMove > stuckMs) {
        logThrottle('stuck', '⚠️ bloqué depuis ' + stuckMs / 1000 + 's — recalcul du chemin', 10000)
        try { bot.pathfinder.stop() } catch {}
      }
    }, 2000)
    try {
      await withTimeout(bot.pathfinder.goto(goal), Math.min(20000, Math.max(5000, remaining())))
      clearInterval(watch); clearInterval(stuckKiller); clearInterval(speedTracker)
      return true
    } catch (err) {
      clearInterval(watch); clearInterval(stuckKiller); clearInterval(speedTracker)
      lastErr = err
      try { bot.pathfinder.stop() } catch {}
      await sleep(1000)
    }
  }
  clearInterval(speedTracker)
  
  logThrottle('gofail', `✗ déplacement échoué : ${lastErr?.message ?? lastErr}`, 8000)
  return false
}

// Direction (angle) où il y a le plus de terre autour — pour fuir océans/rivières
function landAngle (bot) {
  const pos = bot.entity.position.floored()
  let bestAng = null; let bestScore = -1
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2
    let score = 0
    for (let d = 8; d <= 32; d += 8) {
      const x = Math.floor(pos.x + Math.cos(ang) * d)
      const z = Math.floor(pos.z + Math.sin(ang) * d)
      const b = bot.blockAt(new Vec3(x, pos.y, z))
      const bUp = bot.blockAt(new Vec3(x, pos.y + 1, z))
      if (isSolidBlock(b)) score++
      if (isSolidBlock(bUp)) score -= 2 // mur = pas de la terre ouverte
    }
    if (score > bestScore) { bestScore = score; bestAng = ang }
  }
  return bestAng
}
// true si le bot est entouré d'eau (océan/rivière) : l'exploration doit viser la côte
function mostlyWater (bot) {
  const pos = bot.entity.position.floored()
  let water = 0; let total = 0
  for (let dx = -6; dx <= 6; dx += 3) for (let dz = -6; dz <= 6; dz += 3) {
    const b = bot.blockAt(new Vec3(pos.x + dx, pos.y, pos.z + dz))
    if (!b) continue
    total++
    if (b.name === 'water') water++
  }
  return total > 0 && water / total > 0.3
}

async function explore (bot, dist = 80) {
  // 1. arbre mémorisé le plus proche (apprentissage) : on y retourne directement
  const known = learn.getNearestDiscovery('tree', bot.entity.position)
  if (known && known.dist < 300) {
    chat(bot, 'foundTree', { dist: Math.round(known.dist) })
    log('🌲 arbre mémorisé à ' + Math.round(known.dist) + ' blocs (' + known.x + ', ' + known.z + ') — j\'y retourne')
    const okK = await goTo(bot, new GoalNear(known.x, known.y, known.z, 3), { timeout: 45000, retries: 0 }).catch(() => false)
    if (okK) return true
    log('🌲 arbre mémorisé inaccessible — je continue l\'exploration')
  }
  // 2. arbre visible dans les chunks chargés
  // logIds caché par version : Object.values(md.blocksByName) parcourt tous les
  // blocs du jeu (~1000+) avec filter+map à chaque appel d'explore()
  const md = mcData(bot)
  const logIds = (_logIdsCache[bot.version] ??= Object.values(md.blocksByName).filter((b) => b.name.endsWith('_log')).map((b) => b.id))
  if (logIds.length) {
    const spots = bot.findBlocks({ matching: logIds, maxDistance: 48, count: 6 })
    if (spots.length) {
      const s = spots.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0]
      chat(bot, 'foundTree', { dist: Math.round(s.distanceTo(bot.entity.position)) })
      log('🌲 arbre détecté à ' + Math.round(s.distanceTo(bot.entity.position)) + ' blocs — j\'y vais')
      const okS = await goTo(bot, new GoalNear(s.x, s.y, s.z, 3), { timeout: 45000, retries: 0 }).catch(() => false)
      if (okS) return true
    }
  }
  // 2b. Ressource connue la plus proche (mémoire spatiale) : on y retourne directement
  const wanted = ['diamond_ore', 'deepslate_diamond_ore', 'iron_ore', 'deepslate_iron_ore', 'water', 'chest', 'oak_log', 'spruce_log']
  for (const kind of wanted) {
    const knownRes = learn.nearestSpatial('resource:' + kind, bot.entity.position, 400)
    if (knownRes && knownRes.dist > 10) {
      log('🎯 ' + kind + ' mémorisé à ' + knownRes.dist + ' blocs (' + knownRes.x + ', ' + knownRes.z + ') — j\'y vais')
      const okR = await goTo(bot, new GoalNear(knownRes.x, knownRes.y, knownRes.z, 3), { timeout: 45000, retries: 0 }).catch(() => false)
      if (okR) return true
    }
  }
  // 3. sinon spirale ancrée sur un point fixe (spawn mémorisé) — sinon le centre
  // dérive avec le bot et l'envoie à des milliers de blocs (vu en prod : 1995 blocs)
  const ex = learn.bumpExplore(Math.min(dist, 200))
  const anchor = learn.getExploreAnchor(bot) // position de spawn mémorisée
  let angle = ex.angle
  try {
    if (mostlyWater(bot)) {
      const la = landAngle(bot)
      if (la !== null) { angle = la; log('🌊 Entouré d\'eau — je vise la côte (angle ' + Math.round(la * 180 / Math.PI) + '°)'); chat(bot, 'ocean', {}) }
    }
  } catch {}
  const tx = anchor.x + Math.cos(angle) * ex.radius
  const tz = anchor.z + Math.sin(angle) * ex.radius
  chat(bot, 'explore', { x: Math.round(tx), z: Math.round(tz) })
  log('🧭 j\'explore en spirale vers (' + Math.round(tx) + ', ' + Math.round(tz) + ') (rayon ' + Math.round(ex.radius) + ')')
  return goTo(bot, new GoalXZ(tx, tz), { timeout: 150000, retries: 1 })
}

// Attendre un changement de dimension (portail utilisé)
async function enterDimension (bot, dimensionName, timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const dim = bot.game?.dimension ?? ''
    if (dim.includes(dimensionName)) {
      if (dimensionName === 'the_nether') chat(bot, 'enterNether', {}, { force: true })
      else if (dimensionName === 'the_end') chat(bot, 'enterEnd', {}, { force: true })
      else if (dimensionName === 'overworld') chat(bot, 'backOverworld', {}, { force: true })
      return true
    }
    await sleep(1000)
  }
  return false
}

// ---------- Récolte de blocs ----------

async function collectBlocks (bot, names, count, { maxDistance = 48, maxMinutes = 10 } = {}) {
  setMovements(bot) // applique aussi thinkTimeout à collectBlock.movements
  const md = mcData(bot)
  const ids = names.map((n) => md.blocksByName[n]?.id).filter(Boolean)
  let got = 0
  let fails = 0
  let exploredOnce = false
  const t0 = Date.now()
  while (got < count && Date.now() - t0 < maxMinutes * 60000 && fails < 5) {
    const positions = bot.findBlocks({ matching: ids, maxDistance, count: 24 })
    if (!positions.length) {
      chat(bot, 'noBlocks', { names: names.join(', ') })
      log('🔍 aucun bloc [' + names.join(',') + '] à moins de ' + maxDistance + ' blocs')
      if (!exploredOnce) { exploredOnce = true; await explore(bot, 60); continue }
      break
    }
    // mémoriser les arbres vus pour y retourner plus tard
    if (names.some((n) => n.endsWith('_log'))) {
      for (const pos of positions.slice(0, 4)) learn.recordDiscovery('tree', pos)
    }
    positions.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
    let progressed = false
    for (const pos of positions) {
      const block = bot.blockAt(pos)
      if (!block) continue
      const dist = block.position.distanceTo(bot.entity.position)
      try {
        // signature réelle (BlockVeins.js) : findFromVein(bot, block, maxBlocks, maxDistance, floodRadius)
        const vein = await findFromVein(bot, block, 16, 8, 1)
        chat(bot, 'mining', { count: vein.length, dist: Math.round(dist) })
        log('⛏️ je mine ' + vein.length + ' bloc(s) à ' + Math.round(dist) + ' blocs')
        if (dist >= 8) {
          // se rapprocher à pied d'abord, comme un joueur (marche directe si < 48 blocs)
          await goTo(bot, new GoalNear(block.position.x, block.position.y, block.position.z, 5), { timeout: 45000, retries: 0 })
        }
        let mined = 0
        for (const b of vein) {
          if (b.position.distanceTo(bot.entity.position) < 8) {
            // re-vérifier que le bloc existe encore (la veine a pu être cassée entre-temps) :
            // dig sur de l'air bloque jusqu'au timeout = "tape dans le vide"
            const fresh = bot.blockAt(b.position)
            if (!fresh || isVoid(fresh) || fresh.boundingBox === 'empty') continue
            if (fresh.type !== b.type) continue // le bloc a changé entre-temps (cassé + remplacé)
            try {
              await digBlock(bot, fresh, 3500) // 6 s max : un bloc normal casse en < 2 s
              mined++
              // attendre que le serveur spawne l'item entity (délai réseau, surtout sur Aternos)
              // puis ramasser à nos pieds : poll 3 s avant de chercher ailleurs
              const bx = b.position.x, bz = b.position.z
              for (let w = 0; w < 6; w++) {
                await sleep(500)
                const drop = bot.nearestEntity((e) => isItemDrop(e) && Math.abs(e.position.x - bx) < 3 && Math.abs(e.position.z - bz) < 3)
                if (drop) {
                  if (drop.position.distanceTo(bot.entity.position) > 1.5) {
                    await walkDirect(bot, drop.position.x, drop.position.y, drop.position.z, { range: 1.2, timeoutMs: 5000 }).catch(() => {})
                  }
                  break
                }
              }
              await collectNearbyItems(bot, 12, 3000)
            } catch { continue } // dig échoué (cassé entre-temps, protégé, lag) : on passe au suivant
          }
        }
        if (mined === 0) {
          // repli : le plugin collectBlock si le minage direct n'a rien donné
          // (ne compter vein.length que si la collecte a vraiment réussi)
          const before = countItem(bot, names[0])
          try {
            await withTimeout(bot.collectBlock.collect(vein, { ignoreNoPath: true }), 45000)
            mined = Math.max(0, countItem(bot, names[0]) - before)
          } catch { mined = 0 }
          if (mined === 0) mined = vein.length // fallback si countItem ne reflète pas (veine multi-blocs)
        }
        await collectNearbyItems(bot, 16, 10000) // ramasser les drops restés au sol
        // compter l'inventaire RÉEL (pas les blocs minés) : un drop non ramassé ne compte pas
        got = names.reduce((a, n) => a + countItem(bot, n), 0)
        chat(bot, 'collected', { mined, got, count })
        log('⛏️ +' + mined + ' minés, total réel en inventaire ' + got + '/' + count)
        progressed = true
        if (got >= count) break
      } catch (err) {
        log(`collecte ratée (${err.message})`)
      }
    }
    if (!progressed) fails++
  }
  await collectNearbyItems(bot, 16, 10000)
  // log inventaire uniquement en debug : string building de 36+ items à chaque collectBlocks
  if (DEBUG_WALK) log(`🎒 inventaire: ${bot.inventory.items().map((i) => i.name + 'x' + i.count).join(', ') || 'vide'}`)
  return got
}

// Ramasser les objets au sol autour du bot (drops de mobs / blocs minés)

// ---------- Fouille de coffres (compétence apprise) ----------

// true si ce conteneur a déjà été vidé récemment (POI 'looted_chest' à proximité)
function isChestLooted (pos) {
  const p = map.nearestPOI('looted_chest', pos.x, pos.z, 2)
  return !!(p && Math.abs(p.y - pos.y) <= 2)
}

// Fouille UN conteneur (coffre/baril/shulker) : ouvre, vide tout, ferme,
// puis marque le bloc comme vidé dans la carte pour ne pas y retourner.
// Retourne le nombre d'items retirés. Basé sur l'exemple officiel
// PrismarineJS/mineflayer examples/chest.js (containerItems + withdraw).
async function lootSingleChest (bot, block) {
  if (!block || !block.position) throw new Error('bloc conteneur invalide')
  const pos = block.position
  if (isChestLooted(pos)) return 0
  const container = await bot.openContainer(block)
  let got = 0
  try {
    for (const item of container.containerItems()) {
      try { await container.withdraw(item.type, null, item.count); got += item.count } catch {}
    }
  } finally { try { container.close() } catch {} }
  map.addPOI('looted_chest', pos.x, pos.y, pos.z, got)
  learn.recordSpatial('chest', pos, got) // mémoire spatiale : zone à coffres
  learn.recordSkill('fouille_coffre', got >= 0)
  return got
}

// Fouille les coffres/barils à proximité. Ignore ceux déjà vidés (POI looted_chest).
async function lootNearbyChests (bot, maxDistance = 32, maxChests = 3) {
  const md = mcData(bot)
  const chestIds = ['chest', 'trapped_chest', 'barrel', 'shulker_box']
    .map((n) => md.blocksByName[n]?.id).filter(Boolean)
  if (!chestIds.length) return 0
  // count un peu plus grand pour pouvoir filtrer les déjà-vidés
  const spots = bot.findBlocks({ matching: chestIds, maxDistance, count: maxChests * 3 })
  let looted = 0
  for (const pos of spots) {
    if (looted >= maxChests) break
    const block = bot.blockAt(pos)
    if (!block || !chestIds.includes(block.type)) continue
    if (isChestLooted(pos)) continue // déjà vidé : on saute
    try {
      await goTo(bot, new GoalNear(pos.x, pos.y, pos.z, 2), { timeout: 10000, retries: 0 })
      const fresh = bot.blockAt(pos)
      const n = await lootSingleChest(bot, fresh ?? block)
      looted++
      chat(bot, 'chestFound', { dist: Math.round(pos.distanceTo(bot.entity.position)) })
      log('📦 Coffre vidé en (' + pos.x + ', ' + pos.y + ', ' + pos.z + ') — +' + n + ' items')
    } catch (e) {
      learn.recordSkill('fouille_coffre', false)
      log('📦 fouille ratée en (' + pos.x + ',' + pos.z + ') : ' + e.message)
    }
  }
  return looted
}

async function collectNearbyItems (bot, radius = 16, maxMs = 10000) {
  const t0 = Date.now()
  let misses = 0
  while (Date.now() - t0 < maxMs && misses < 4) { // 4 misses × 500 ms = 2 s min : le serveur met un délai avant de spawner l'item entity (lag Aternos)
    const item = bot.nearestEntity((e) => isItemDrop(e) && e.position.distanceTo(bot.entity.position) < radius)
    if (!item) { misses++; await sleep(500); continue }
    misses = 0
    const dist = item.position.distanceTo(bot.entity.position)
    // ignorer les drops vraiment lointains (> 20 blocs) : courir après bloque 30-40 s
    if (dist > 20) { await sleep(150); continue }
    log(`📦 item au sol à ${Math.round(dist)} blocs`)
    if (dist > 1.5) {
      // marche directe d'abord (rapide, comme un joueur qui ramasse à ses pieds)
      const ok = await walkDirect(bot, item.position.x, item.position.y, item.position.z, { range: 1.2, timeoutMs: 6000 })
      // repli pathfinder si la marche directe échoue (obstacle/terrain) et que l'item est à portée
      if (!ok && item.isValid !== false && item.position.distanceTo(bot.entity.position) < 20) {
        await goTo(bot, new GoalNear(item.position.x, item.position.y, item.position.z, 1), { timeout: 8000, retries: 0 })
        // puis on marche dessus franchement
        if (item.isValid !== false && item.position.distanceTo(bot.entity.position) < 5) {
          await walkDirect(bot, item.position.x, item.position.y, item.position.z, { range: 1.2, timeoutMs: 4000 })
        }
      }
    }
    await sleep(250)
  }
}

// ---------- Craft ----------

async function ensureCraftingTable (bot) {
  const md = mcData(bot)
  const tableId = md.blocksByName.crafting_table?.id
  if (!tableId) throw new Error('crafting_table inconnu pour cette version')
  // cache : éviter de rescanner les blocs à chaque craftItem récursif
  const cached = bot._librebotTablePos
  if (cached) {
    const b = bot.blockAt(cached)
    if (b && b.name === 'crafting_table') {
      if (b.position.distanceTo(bot.entity.position) <= 4) return b
      await goTo(bot, new GoalNear(b.position.x, b.position.y, b.position.z, 2), { timeout: 60000, retries: 0 })
      const near = bot.blockAt(cached)
      if (near && near.name === 'crafting_table') return near
    }
    bot._librebotTablePos = null // la table a été cassée/déplacée
  }
  let table = bot.findBlock({ matching: tableId, maxDistance: 48 })
  if (table && table.position.distanceTo(bot.entity.position) > 4) {
    await goTo(bot, new GoalNear(table.position.x, table.position.y, table.position.z, 2), { timeout: 60000, retries: 0 })
    table = bot.findBlock({ matching: tableId, maxDistance: 8 })
  }
  if (table) { bot._librebotTablePos = table.position.clone(); return table }
  if (countItem(bot, 'crafting_table') > 0) {
    await placeBlockFromInventory(bot, 'crafting_table')
  } else {
    // crafter une table directement dans l'inventaire (recette sans table)
    const recipes = bot.recipesFor(md.itemsByName.crafting_table?.id, null, 1, null)
    if (!recipes?.length) throw new Error('pas de planches pour crafter une table')
    await bot.craft(recipes[0], 1, null)
    await placeBlockFromInventory(bot, 'crafting_table')
  }
  table = bot.findBlock({ matching: tableId, maxDistance: 8 })
  if (!table) throw new Error('impossible de poser une table de craft')
  bot._librebotTablePos = table.position.clone()
  return table
}

async function ensureFurnace (bot) {
  const md = mcData(bot)
  const furnaceId = md.blocksByName.furnace?.id
  if (!furnaceId) throw new Error('furnace inconnu pour cette version')
  // cache : idem, éviter le findBlock à chaque smeltItem
  const cached = bot._librebotFurnacePos
  if (cached) {
    const b = bot.blockAt(cached)
    if (b && b.name === 'furnace') {
      if (b.position.distanceTo(bot.entity.position) <= 4) return b
      await goTo(bot, new GoalNear(b.position.x, b.position.y, b.position.z, 2), { timeout: 60000, retries: 0 })
      const near = bot.blockAt(cached)
      if (near && near.name === 'furnace') return near
    }
    bot._librebotFurnacePos = null
  }
  let furnace = bot.findBlock({ matching: furnaceId, maxDistance: 48 })
  if (furnace && furnace.position.distanceTo(bot.entity.position) > 4) {
    await goTo(bot, new GoalNear(furnace.position.x, furnace.position.y, furnace.position.z, 2), { timeout: 60000, retries: 0 })
    furnace = bot.findBlock({ matching: furnaceId, maxDistance: 8 })
  }
  if (furnace) { bot._librebotFurnacePos = furnace.position.clone(); return furnace }
  if (countItem(bot, 'furnace') === 0) await craftItem(bot, 'furnace', 1)
  await placeBlockFromInventory(bot, 'furnace')
  furnace = bot.findBlock({ matching: furnaceId, maxDistance: 8 })
  if (!furnace) throw new Error('impossible de poser un four')
  bot._librebotFurnacePos = furnace.position.clone()
  return furnace
}

// Craft récursif : fabrique les ingrédients manquants au besoin.
async function craftItem (bot, name, count) {
  const md = mcData(bot)
  const item = md.itemsByName[name]
  if (!item) throw new Error(`item inconnu : ${name}`)
  const have = countItem(bot, name)
  if (have >= count) return
  const need = count - have

  // cas particuliers obtenus par FONT/CUISINE (toutes les recettes du four vanilla) :
  // utilisé uniquement quand le craft de cet item est réellement demandé
  const smeltRaw = bestSmeltRaw(bot, name)
  if (smeltRaw) {
    // RÉCOLTE AU FUR ET À MESURE : pas assez de matière première (ex. raw_iron pour
    // un lingot) ? On va la MINER avant de fondre — on ne s'arrête plus sur
    // « il manque N x raw_iron » alors que le filon est à 20 blocs.
    const missingOut = count - countItem(bot, name)
    const rawAvailable = countItem(bot, smeltRaw)
    if (rawAvailable < missingOut) {
      const ok = await ensureResource(bot, smeltRaw, missingOut)
      if (!ok) throw new Error(`impossible de récolter ${smeltRaw} (requis : ${missingOut}, obtenu : ${countItem(bot, smeltRaw)})`)
    }
    await smeltItem(bot, smeltRaw, name, count)
    // smeltItem POST-VÉRIFIE désormais ; double contrôle de la production :
    if (countItem(bot, name) < count) throw new Error(`fonte de ${name} incomplète (${countItem(bot, name)}/${count})`)
    return
  }
  const NOT_CRAFTABLE = new Set(['raw_iron', 'flint', 'ender_pearl', 'blaze_rod', 'obsidian', 'feather',
    'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log', 'pale_oak_log'])
  if (NOT_CRAFTABLE.has(name)) throw new Error(`${name} ne se craft pas : phase récolte nécessaire`)

  const table = await ensureCraftingTable(bot)
  // Cache des recettes STRUCTURELLES uniquement (celles de recipesAll ne dépendent
  // PAS de l'inventaire). AVANT : le cache stockait le résultat de recipesFor(),
  // qui est FILTRÉ par l'inventaire au moment de l'appel — une recette mémorisée
  // alors qu'il manquait des ingrédients était ensuite rejouée telle quelle, et
  // bot.craft() Throwait « missing ingredient ».
  const recipesKey = `${bot.version}:${item.id}`
  let recipes = _recipesCache[recipesKey]
  if (!recipes) {
    recipes = (bot.recipesAll(item.id, null, true) ?? []).filter((r) => !r.requiresTable || !!table)
    _recipesCache[recipesKey] = recipes
  }
  if (!recipes.length) throw new Error(`pas de recette pour ${name}`)
  // inventaire LU FRAIS À CHAQUE PASSE : un instantané pris avant la boucle donnait
  // des comptes périmés après la fabrication récursive d'un ingrédient (double craft
  // ou faux « irrécupérables »). const snapshot = O(n) court, négligeable ici.
  let invCount = new Map()
  const refreshInv = () => {
    invCount = new Map()
    for (const i of bot.inventory.items()) invCount.set(i.name, (invCount.get(i.name) ?? 0) + i.count)
  }
  refreshInv()
  const countOf = (n) => invCount.get(n) ?? 0
  // item par id : itemsById (clé id) prioritaire, fallback md.items[id] (objet keyed-by-id
  // sur les versions récentes ; array sur d'anciennes versions de minecraft-data)
  const itemById = (id) => md.itemsById?.[id] ?? (Array.isArray(md.items) ? md.items.find((i) => i.id === id) : md.items[id])
  // recette immédiatement craftable (gère les variantes : cobblestone vs blackstone,
  // chaque type de planches…). Sinon on prend la première et on fabrique les manquants.
  const isCraftableNow = (r) => (r.ingredients ?? []).every((ing) => {
    const it = itemById(ing.id)
    return it && countOf(it.name) >= (ing.count ?? 1)
  })
  let recipe = recipes.find(isCraftableNow) ?? recipes[0]
  // fabriquer (récursivement) les ingrédients manquants de la recette choisie
  for (let pass = 0; pass < 3; pass++) {
    refreshInv() // comptes à jour (la passe précédente a pu fabriquer des ingrédients)
    let missing = false
    const resultCount = recipe.result?.count ?? 1
    const crafts = Math.ceil(need / resultCount)
    for (const ing of recipe.ingredients ?? []) {
      const ingItem = itemById(ing.id)
      if (!ingItem) continue
      const ingNeed = (ing.count ?? 1) * crafts
      if (countOf(ingItem.name) < ingNeed) {
        missing = true
        // ingrédient MINABLE (raw_iron, diamant, silex…) → récolte ciblée d'abord ;
        // sinon fabrication récursive (planches, bâtons…)
        if (GATHER_RULES[ingItem.name]) {
          const ok = await ensureResource(bot, ingItem.name, ingNeed)
          if (!ok) throw new Error(`récolte de ${ingItem.name} insuffisante (${countOf(ingItem.name)}/${ingNeed})`)
        } else {
          await craftItem(bot, ingItem.name, ingNeed) // fabrique l'ingrédient (récursion)
        }
      }
    }
    if (missing) {
      // l'inventaire a changé : RE-choisir une recette maintenant craftable
      // (ex. la récursion a produit des planches de bouleau → prendre la variante bouleau)
      recipe = recipes.find(isCraftableNow) ?? recipe
      continue
    }
    const freshTable = await ensureCraftingTable(bot)
    try {
      await bot.craft(recipe, crafts, freshTable)
      chat(bot, 'crafting', { count: crafts, item: name })
      log('✓ crafté ' + crafts + '× ' + name)
      return
    } catch (e) {
      // erreur mineflayer « missing ingredient » opaque → diagnostiquer précisément
      const resultCount2 = recipe.result?.count ?? 1
      const crafts2 = Math.ceil(need / resultCount2)
      const lacks = (recipe.ingredients ?? [])
        .map((ing) => ({ n: itemById(ing.id)?.name ?? ('id ' + ing.id), need: (ing.count ?? 1) * crafts2, have: countOf(itemById(ing.id)?.name ?? '') }))
        .filter((i) => i.have < i.need)
      if (lacks.length) throw new Error(`craft ${name} impossible : il manque ${lacks.map((l) => (l.need - l.have) + 'x ' + l.n).join(', ')}`)
      throw e
    }
  }
  throw new Error(`craft ${name} : ingrédients irrécupérables après 3 passes`)
}

// Fabrique des planches à partir de n'importe quels logs en inventaire
async function craftAnyPlanks (bot, count) {
  const md = mcData(bot)
  const logTypes = [...new Set(bot.inventory.items().filter((i) => i.name.endsWith('_log')).map((i) => i.name))]
  let made = 0
  for (const log of logTypes) {
    if (made >= count) break
    const planksItem = md.itemsByName[log.replace('_log', '_planks')]
    if (!planksItem) continue
    let recipes = bot.recipesFor(planksItem.id, null, 1, null)
    if (!recipes?.length) recipes = (bot.recipesAll(planksItem.id, null, null) ?? []).filter((r) => !r.requiresTable)
    if (!recipes?.length) continue
    const batch = Math.min(countItem(bot, log), Math.ceil((count - made) / 4))
    if (batch <= 0) continue
    await bot.craft(recipes[0], batch, null)
    made += batch * 4
  }
  if (made === 0) {
    log(`craftAnyPlanks: logs=[${logTypes.join(',') || 'aucun'}] inv=${bot.inventory.items().map((i) => i.name + 'x' + i.count).join(',') || 'vide'}`)
    throw new Error('pas de planches disponibles')
  }
}

// ---------- Fonte ----------

// Recettes du FOUR (vanilla 26.1) : sortie -> matières premières possibles.
// Absentes de minecraft-data : table maintenue ici. Plusieurs entrées possibles
// (ex. verre = sable OU sable rouge) : celle la plus présente en inventaire est choisie.
const SMELT_MAP = {
  iron_ingot: ['raw_iron'],
  gold_ingot: ['raw_gold'],
  copper_ingot: ['raw_copper'],
  netherite_scrap: ['ancient_debris'],
  glass: ['sand', 'red_sand'],
  charcoal: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log', 'pale_oak_log'],
  stone: ['cobblestone'],
  smooth_stone: ['stone'],
  deepslate: ['cobbled_deepslate'],
  terracotta: ['clay_ball'],
  cooked_beef: ['beef'],
  cooked_porkchop: ['porkchop'],
  cooked_chicken: ['chicken'],
  cooked_mutton: ['mutton'],
  cooked_rabbit: ['rabbit'],
  cooked_cod: ['raw_cod'],
  cooked_salmon: ['raw_salmon'],
  baked_potato: ['potato'],
  dried_kelp: ['kelp'],
  popped_chorus_fruit: ['chorus_fruit'],
  cracked_stone_bricks: ['stone_bricks'],
  cracked_nether_bricks: ['nether_bricks'],
  cracked_deepslate_bricks: ['deepslate_bricks'],
  cracked_deepslate_tiles: ['deepslate_tiles']
}

// Choisit la matière première de fonte la plus disponible (fallback : la première)
function bestSmeltRaw (bot, name) {
  const raws = SMELT_MAP[name]
  if (!raws?.length) return null
  let best = raws[0]
  let bestCount = -1
  for (const r of raws) {
    const c = countItem(bot, r)
    if (c > bestCount) { bestCount = c; best = r }
  }
  return best
}

async function smeltItem (bot, rawName, outName, count) {
  const md = mcData(bot)
  const furnaceBlock = await ensureFurnace(bot)
  let safety = 0
  while (countItem(bot, outName) < count && safety++ < 40) {
    const raw = bot.inventory.items().find((i) => i.name === rawName)
    if (!raw) break
    let fuel = bot.inventory.items().find((i) =>
      FUEL_NAMES.has(i.name))
    if (!fuel) {
      // récolte au fur et à mesure : le combustible manque mais le charbon est minable —
      // on va en chercher un peu au lieu d'abandonner la fonte
      log('🔥 plus de combustible — je vais chercher du charbon pour finir la fonte')
      try { await ensureResource(bot, 'coal', Math.max(1, Math.ceil((count - countItem(bot, outName)) / 8))) } catch {}
      fuel = bot.inventory.items().find((i) => FUEL_NAMES.has(i.name))
    }
    if (!fuel) { log('plus de combustible'); break }
    chat(bot, 'smelting', { out: outName })
    const furnace = await bot.openFurnace(furnaceBlock)
    try {
      const batch = Math.min(raw.count, count - countItem(bot, outName))
      await furnace.putInput(raw.type, null, batch)
      const perFuel = (fuel.name === 'coal' || fuel.name === 'charcoal') ? 8 : 2
      await furnace.putFuel(fuel.type, null, Math.min(fuel.count, Math.max(1, Math.ceil(batch / perFuel))))
      for (let t = 0; t < 90; t++) { // attendre la cuisson (max 3 min par lot, check toutes les 2 s)
        await sleep(2000)
        if (!furnace.inputItem() || (furnace.outputItem()?.count ?? 0) >= batch) break
      }
      if (furnace.outputItem()) await furnace.takeOutput()
    } finally {
      try { furnace.close() } catch {}
    }
    await sleep(500)
  }
  if (countItem(bot, outName) < count) throw new Error(`fonte incomplète : ${outName} (${countItem(bot, outName)}/${count})`)

  // POST-VÉRIFICATION (bug « missing ingredient » du 22:25) : avant, une fonte
  // sans matière première (ou sans four) REVENAIT SANS RIEN PRODUIRE, et le craft
  // appelant échouait plus loin avec l'opaque 'missing ingredient' de mineflayer.
  if (countItem(bot, outName) < count) {
    throw new Error(`fonte incomplète : ${outName} ${countItem(bot, outName)}/${count} — il manque ${(count - countItem(bot, outName))}x ${rawName} à cuire (four/combustible ?)`)
  }
}

// ---------- Nourriture ----------

const FOOD_NAMES = ['golden_apple', 'cooked_beef', 'beef', 'cooked_porkchop', 'porkchop', 'cooked_mutton', 'mutton',
  'cooked_chicken', 'chicken', 'cooked_cod', 'bread', 'apple', 'rotten_flesh']
// Set pour O(1) au lieu de includes() (14 comparaisons × N items à chaque find)
const FOOD_NAMES_SET = new Set(FOOD_NAMES)

// combustibles pour la fonte (Set : smeltItem fait un find sur tout l'inventaire par lot)
const FUEL_NAMES = new Set(['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks', 'oak_log', 'stick'])

async function eatUntil (bot, target = 18) {
  let safety = 0
  // RÉFLEXE CUISINE : si la seule nourriture est CRUE mais qu'on peut cuire
  // (four possible + combustible), on cuit d'abord — poulet cru = poison, et
  // la viande cuite restaure plus. Une seule fois par appel pour ne pas boucler.
  try {
    const hasCooked = FOOD_NAMES.some((f) => f.startsWith('cooked_') || ['golden_apple', 'bread', 'apple'].includes(f)) && countItem(bot, 'cooked_beef') + countItem(bot, 'cooked_porkchop') + countItem(bot, 'cooked_chicken') + countItem(bot, 'cooked_mutton') + countItem(bot, 'bread') + countItem(bot, 'golden_apple') > 0
    const hasFuel = [...FUEL_NAMES].some((f) => countItem(bot, f) > 0)
    const rawFood = ['beef', 'porkchop', 'chicken', 'mutton'].reduce((a, f) => a + countItem(bot, f), 0)
    if (!hasCooked && rawFood > 0 && hasFuel && bot.food < target) {
      const rawName = ['beef', 'porkchop', 'chicken', 'mutton'].find((f) => countItem(bot, f) > 0)
      const cookedName = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton' }[rawName]
      log('🍳 Réflexe cuisine : je cuis ' + Math.min(4, rawFood) + 'x ' + rawName + ' avant de manger cru')
      await smeltItem(bot, rawName, cookedName, Math.min(4, rawFood))
    }
  } catch {}
  while (bot.food < target && safety++ < 10) {
    // manger par PRIORITÉ (cuite avant crue, dorée/pain avant viande crue) :
    // avant, c'était le premier item de l'inventaire → poulet cru et risque de poison
    let food = null
    for (const fname of FOOD_NAMES) {
      const it = bot.inventory.items().find((i) => i.name === fname)
      if (it && countItem(bot, fname) > 0) { food = it; break }
    }
    if (!food) return false
    await bot.equip(food, 'hand')
    await sleep(150)
    await bot.activateItem()
    await sleep(1800) // temps de consommation
    try { bot.deactivateItem() } catch {}
    await sleep(200)
  }
  return bot.food >= target
}

// ---------- Combat ----------

const SWORD_PRIORITY = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe']
async function equipBestSword (bot) {
  // un seul items() puis find par priorité (évite 4× countItem = 4 parcours d'inventaire)
  const items = bot.inventory.items()
  for (const sword of SWORD_PRIORITY) {
    const item = items.find((i) => i.name === sword)
    if (item) { await bot.equip(item, 'hand'); return sword }
  }
  return null
}

async function equipShield (bot) {
  if (countItem(bot, 'shield') > 0) {
    try { await equipName(bot, 'shield', 'off-hand') } catch {}
  }
}

// Chasse un type de mob jusqu'à ce que la condition `until` soit vraie.
async function huntMob (bot, mobNames, { until, maxMinutes = 8 } = {}) {
  const t0 = Date.now()
  while (!until()) {
    if (Date.now() - t0 > maxMinutes * 60000) return false
    if (bot.health < 14) { await eatUntil(bot); if (bot.health < 12) await sleep(4000) }
    const mob = bot.nearestEntity((e) =>
      mobNames.includes(e.name) && e.isValid !== false &&
      e.position.distanceTo(bot.entity.position) < 48)
    if (!mob) { await sleep(2500); continue } // 2,5 s : réduit les scans d'entités
    // re-vérifier que la cible est toujours vivante et à portée (sinon pvp.attack tape dans le vide)
    if (mob.isValid === false || mob.position.distanceTo(bot.entity.position) > 48) { await sleep(500); continue }
    // équiper seulement quand un mob est trouvé (évite 2× inventory.items() par itération)
    await equipBestSword(bot)
    await equipShield(bot)
    // watchdog : si la vie chute pendant le combat, on interrompt
    let interrupt = false
    const watcher = setInterval(() => {
      if (bot.health < 8) { interrupt = true; try { bot.pvp.stop() } catch {} }
      // si la cible meurt ou sort de portée pendant l'attaque, on arrête immédiatement
      if (mob.isValid === false || mob.position.distanceTo(bot.entity.position) > 20) { try { bot.pvp.stop() } catch {} }
    }, 500)
    try {
      await withTimeout(bot.pvp.attack(mob), 15000) // 15 s max par attaque
    } catch (err) {
      try { bot.pvp.stop() } catch {}
      log(`combat interrompu (${interrupt ? 'vie trop basse' : err.message})`)
    }
    clearInterval(watcher)
    await collectNearbyItems(bot, 12, 6000)
    if (interrupt) { // fuir un peu et se soigner
      const { x, z } = bot.entity.position
      await goTo(bot, new GoalXZ(x + randInt(-16, 16), z + randInt(-16, 16)), { timeout: 15000, retries: 0 })
      await eatUntil(bot)
      await sleep(3000)
    }
  }
  return true
}

// Tir à l'arc : hawk-eye si dispo, sinon visée manuelle.
async function shootWithBow (bot, target, maxTries = 3) {
  if (countItem(bot, 'arrow') === 0 && !bot.hawkEye) throw new Error('plus de flèches')
  await equipShield(bot)
  for (let t = 0; t < maxTries; t++) {
    try {
      if (bot.hawkEye?.oneShot) {
        await withTimeout(bot.hawkEye.oneShot(target, 'bow'), 15000)
        await sleep(800)
        return true
      }
    } catch (e) { /* bascule sur la visée manuelle */ }
    try {
      await equipName(bot, 'bow', 'hand')
      await bot.lookAt(target.position.offset(0, (target.height ?? 1) / 2, 0))
      await sleep(300)
      await bot.activateItem()
      await sleep(1100) // bander l'arc
      try { bot.deactivateItem() } catch {}
      await sleep(600)
      return true
    } catch (e) {
      log(`tir raté : ${e.message}`)
      await sleep(500)
    }
  }
  return false
}

// ---------- Pose de blocs ----------

async function placeBlockFromInventory (bot, name) {
  if (countItem(bot, name) === 0) throw new Error(`pas de ${name} dans l'inventaire`)
  const base = bot.entity.position.floored()
  // anneaux de plus en plus larges (r max 2 : ~24 positions × 2 dy = 48 tests max),
  // et on teste y-1 (plat) puis y-2 (pente)
  const candidates = []
  for (let r = 1; r <= 2; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        candidates.push([dx, dz])
      }
    }
  }
  // passe 1 : emplacement idéal — sol solide, 2 blocs d'air au-dessus, ligne de vue libre
  for (const [dx, dz] of candidates) {
    for (const dy of [-1, -2]) {
      const groundPos = new Vec3(base.x + dx, base.y + dy, base.z + dz)
      const ground = bot.blockAt(groundPos)
      if (!isSolidBlock(ground)) continue
      const above = bot.blockAt(groundPos.offset(0, 1, 0))
      const above2 = bot.blockAt(groundPos.offset(0, 2, 0))
      if (!above || above.name !== 'air') continue
      if (above2 && above2.name !== 'air') continue
      if (groundPos.distanceTo(bot.entity.position) > 4.2) continue
      if (!legit.canReach(bot, groundPos.offset(0, 1, 0))) continue // ligne de vue + portée
      try {
        await equipName(bot, name, 'hand')
        await bot.placeBlock(ground, new Vec3(0, 1, 0))
        return bot.blockAt(groundPos.offset(0, 1, 0))
      } catch (e) {}
    }
  }
  // passe 2 : sous une canopée (dark forest…), aucun emplacement idéal n'existe :
  // on dégage les blocs « mous » (feuilles, herbe, neige) au-dessus du sol puis on pose.
  // Ces blocs sont solides pour la ligne de vue mais se minent instantanément.
  const isSoft = (b) => b && (b.name.endsWith('_leaves') || ['tall_grass', 'short_grass', 'grass', 'fern', 'dead_bush', 'snow'].includes(b.name))
  for (const [dx, dz] of candidates) {
    for (const dy of [-1, -2]) {
      const groundPos = new Vec3(base.x + dx, base.y + dy, base.z + dz)
      const ground = bot.blockAt(groundPos)
      if (!isSolidBlock(ground)) continue
      const above = bot.blockAt(groundPos.offset(0, 1, 0))
      const above2 = bot.blockAt(groundPos.offset(0, 2, 0))
      if (!isSoft(above)) continue
      if (above2 && !isSoft(above2) && above2.name !== 'air') continue
      if (groundPos.distanceTo(bot.entity.position) > 4.2) continue
      try {
        try { await digBlock(bot, above, 1500) } catch (e) {}
        if (above2 && isSoft(above2)) { try { await digBlock(bot, above2, 1500) } catch (e) {} }
        if (!legit.canReach(bot, groundPos.offset(0, 1, 0)) && bot.entity.position.offset(0, 1.62, 0).distanceTo(groundPos.offset(0.5, 1.5, 0.5)) > 4.2) continue
        await equipName(bot, name, 'hand')
        await bot.placeBlock(ground, new Vec3(0, 1, 0))
        return bot.blockAt(groundPos.offset(0, 1, 0))
      } catch (e) {}
    }
  }
  throw new Error(`aucun emplacement pour poser ${name}`)
}

function findSolidNeighbor (bot, pos) {
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (const [dx, dy, dz] of dirs) {
    const b = bot.blockAt(pos.offset(dx, dy, dz))
    if (isSolidBlock(b)) return b
  }
  return null
}

// Monte en pilier de blocs (jump + place sous les pieds)
async function pillarUp (bot, targetY, blockName = 'cobblestone') {
  await equipName(bot, blockName, 'hand')
  let fails = 0
  while (bot.entity.position.y < targetY - 0.5 && fails < 40) {
    const startY = bot.entity.position.y
    bot.setControlState('jump', true)
    for (let t = 0; t < 40; t++) {
      await sleep(50)
      if (bot.entity.position.y > startY + 1.0) break
    }
    const feet = bot.entity.position.floored()
    const ref = bot.blockAt(new Vec3(feet.x, feet.y - 2, feet.z))
    try {
      if (isSolidBlock(ref)) await bot.placeBlock(ref, new Vec3(0, 1, 0))
      else fails++
    } catch (e) { fails++ }
    bot.setControlState('jump', false)
    await sleep(300)
  }
  if (bot.entity.position.y < targetY - 1) throw new Error('impossible de monter plus haut (obstacle ?)')
}

// ---------- Creusement ----------

// depuis le "Flattening" (1.13), flowing_water/flowing_lava n'existent plus :
// ce sont des états (level) des blocs water/lava — le includes() ci-dessous les couvre.
const FLUIDS = new Set(['lava', 'water'])
const isFluid = (b) => b && (FLUIDS.has(b.name) || (b.name ?? '').includes('lava') || (b.name ?? '').includes('water'))

// Descendre en escalier sécurisé (vérifie la lave/eau à chaque pas)
async function digStaircase (bot, targetY) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let dirIdx = 0
  let stuck = 0
  while (bot.entity.position.y > targetY + 1 && stuck < 8) {
    const p = bot.entity.position.floored()
    let stepped = false
    for (let k = 0; k < 4 && !stepped; k++) {
      const d = dirs[(dirIdx + k) % 4]
      const foot = new Vec3(p.x + d[0], p.y - 1, p.z + d[1])
      const head = foot.offset(0, 1, 0)
      if (isFluid(bot.blockAt(foot)) || isFluid(bot.blockAt(head))) continue
      if (isFluid(bot.blockAt(foot.offset(0, -1, 0)))) continue
      try {
        for (const b of [bot.blockAt(foot), bot.blockAt(head)]) {
          if (b && b.boundingBox !== 'empty' && !isFluid(b)) await digBlock(bot, b, 4000).catch(() => {})
        }
        if (isFluid(bot.blockAt(foot.offset(0, -1, 0)))) continue // révélé après creusage
        await goTo(bot, new GoalNear(foot.x, foot.y, foot.z, 0.5), { timeout: 15000, retries: 0 })
        if (Math.abs(bot.entity.position.y - (p.y - 1)) < 0.7) {
          stepped = true
          dirIdx = (dirIdx + k) % 4
        }
      } catch (e) { /* essayer la direction suivante */ }
    }
    if (!stepped) stuck++; else stuck = 0
    if (stuck === 4) {
      // laisser le pathfinder tenter autre chose
      const ok = await goTo(bot, new GoalY(targetY), { timeout: 120000, retries: 0 })
      if (ok) break
      stuck = 0
    }
    if (bot.health < 15) await eatUntil(bot)
  }
}

// Remonter vers la surface (le pathfinder creuse un escalier vers le haut)
async function ascendTo (bot, targetY = 70) {
  await goTo(bot, new GoalY(targetY), { timeout: 300000, retries: 1 })
}

// Minage en branche : scan des minerais autour + tunnels réguliers
async function branchMine (bot, { y, need, ores = [], extraOres = [], maxMinutes = 30 }) {
  const md = mcData(bot)
  const oreIds = [...ores, ...extraOres].map((n) => md.blocksByName[n]?.id).filter(Boolean)
  const t0 = Date.now()
  let dir = 0
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  while (!need() && Date.now() - t0 < maxMinutes * 60000) {
    // ramasser les minerais visibles (rayon réduit : le scan complet est coûteux)
    let spots = bot.findBlocks({ matching: oreIds, maxDistance: 48, count: 24 })
    // mémoriser les minerais vus pour y retourner directement
    for (const pos of spots.slice(0, 6)) {
      const b = bot.blockAt(pos)
      if (b && b.name.includes('ore')) learn.recordDiscovery(b.name, pos)
    }
    // cerveau : rien de visible -> interroger la MÉMOIRE des gisements déjà vus
    // (runs précédents, miners repérés en creusant) avant de creuser à l'aveugle
    if (!spots.length) {
      const remembered = ores
        .flatMap((n) => learn.getNearestDiscoveries(n, bot.entity.position, 2, 128))
        .sort((a, b) => a.dist - b.dist)
      if (remembered.length) {
        log('🧠 mémoire : gisement ' + ores.join('/') + ' repéré à ' + Math.round(remembered[0].dist) + ' blocs — j\'y retourne')
        await goTo(bot, new GoalNear(remembered[0].x, remembered[0].y, remembered[0].z, 3), { timeout: 90000, retries: 0 }).catch(() => {})
        spots = bot.findBlocks({ matching: oreIds, maxDistance: 32, count: 24 })
      }
    }
    let collected = false
    for (const pos of spots.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))) {
      const b = bot.blockAt(pos)
      // re-vérifier que le minerai existe encore (sinon collectBlock bloque 150 s dans le vide)
      if (!b || isVoid(b) || !oreIds.includes(b.type)) continue
      try {
        // signature réelle : (bot, block, maxBlocks, maxDistance, floodRadius)
        const vein = await findFromVein(bot, b, 24, 12, 1)
        // filtrer la veine : ne garder que les blocs réellement présents
        const realVein = vein.filter((v) => { const fb = bot.blockAt(v.position); return fb && !isVoid(fb) && fb.boundingBox !== 'empty' })
        if (!realVein.length) continue
        await withTimeout(bot.collectBlock.collect(realVein, { ignoreNoPath: true }), 60000) // 60 s max, pas 150
        collected = true
        if (need()) break
      } catch (e) { /* minerai inaccessible */ }
    }
    if (need()) break
    // creuser un nouveau segment de tunnel
    const d = dirs[dir % 4]
    dir++
    const from = bot.entity.position.floored()
    const end = new Vec3(from.x + d[0] * 16, y, from.z + d[1] * 16)
    await goTo(bot, new GoalBlock(end.x, y, end.z), { timeout: 90000, retries: 0 })
    // torche de temps en temps
    if (countItem(bot, 'torch') > 0 && Math.random() < 0.5) {
      try { await placeBlockFromInventory(bot, 'torch') } catch {}
    }
    await eatUntil(bot, 15)
    if (bot.health < 15) await sleep(2000)
  }
  return need()
}

// ---------- Seau, eau et obsidienne ----------

async function getWaterBucket (bot) {
  if (countItem(bot, 'water_bucket') > 0) return
  await craftItem(bot, 'bucket', 1)
  const md = mcData(bot)
  const waterId = md.blocksByName.water?.id
  for (let attempt = 0; attempt < 8; attempt++) {
    const spots = bot.findBlocks({ matching: waterId, maxDistance: attempt < 4 ? 64 : 128, count: 32 })
    const source = spots
      .map((p) => bot.blockAt(p))
      .find((b) => b && b.name === 'water' && (b.properties?.level ?? '0') === '0')
    if (source) {
      await goTo(bot, new GoalNear(source.position.x, source.position.y + 1, source.position.z, 1), { timeout: 30000, retries: 0 })
      await equipName(bot, 'bucket', 'hand')
      await bot.lookAt(source.position.offset(0.5, 0.5, 0.5))
      await bot.activateItem()
      await sleep(500)
      if (countItem(bot, 'water_bucket') > 0) return
    }
    await explore(bot, 80)
  }
  throw new Error('aucune eau trouvée pour remplir le seau')
}

async function makeObsidian (bot, count) {
  const md = mcData(bot)
  const lavaId = md.blocksByName.lava?.id
  let safety = 0
  while (countItem(bot, 'obsidian') < count && safety++ < 25) {
    if (countItem(bot, 'water_bucket') === 0) {
      if (countItem(bot, 'bucket') > 0) {
        // le seau a été vidé quelque part : chercher de l'eau pour le reremplir
        try { await refillBucket(bot); continue } catch { throw new Error('seau d\'eau perdu') }
      }
      throw new Error('seau d\'eau perdu : relancer la mission')
    }
    const spots = bot.findBlocks({ matching: lavaId, maxDistance: 64, count: 32 })
    const sources = spots
      .map((p) => bot.blockAt(p))
      .filter((b) => b && b.name === 'lava' && (b.properties?.level ?? '0') === '0')
    if (!sources.length) { await explore(bot, 60); continue }
    const spot = sources[0]
    say(bot, '🪣 Je verse de l\'eau sur la lave pour fabriquer de l\'obsidienne')
    await goTo(bot, new GoalXZ(spot.position.x, spot.position.z), { timeout: 45000, retries: 0 })
    await equipName(bot, 'water_bucket', 'hand')
    // Viser LA LAVE elle-même (pas 2 blocs au-dessus) : le clic sur une source de
    // lave avec un seau d'eau la transforme directement en obsidienne (vanilla).
    await lookSafe(bot, spot.position.offset(0.5, 0.5, 0.5))
    await actBlock(bot, spot) // clic droit sur le bloc de lave avec le seau en main
    await sleep(1500)
    // repli : clic dans le vide (use_item) au cas où le raycast n'a pas accroché le bloc
    if (countItem(bot, 'obsidian') === 0) {
      await lookSafe(bot, spot.position.offset(0.5, 0.5, 0.5))
      await actItem(bot)
      await sleep(2500)
    }
    await collectBlocks(bot, ['obsidian'], count - countItem(bot, 'obsidian'), { maxDistance: 48, maxMinutes: 4 })
    // récupérer l'eau si on a un seau vide
    if (countItem(bot, 'bucket') > 0 && countItem(bot, 'water_bucket') === 0) {
      try { await refillBucket(bot) } catch {}
    }
  }
  if (countItem(bot, 'obsidian') < count) throw new Error('obsidienne insuffisante')
}

async function refillBucket (bot) {
  const md = mcData(bot)
  const waterId = md.blocksByName.water?.id
  const water = bot.findBlock({ matching: waterId, maxDistance: 32 })
  if (!water) throw new Error('pas d\'eau proche')
  await goTo(bot, new GoalNear(water.position.x, water.position.y + 1, water.position.z, 1), { timeout: 20000, retries: 0 })
  await equipName(bot, 'bucket', 'hand')
  await bot.lookAt(water.position.offset(0.5, 0.5, 0.5))
  await bot.activateItem()
  await sleep(400)
  if (countItem(bot, 'water_bucket') === 0) throw new Error('remplissage raté')
}

async function digGravelForFlint (bot, count) {
  let safety = 0
  while (countItem(bot, 'flint') < count && safety++ < 12) {
    const got = await collectBlocks(bot, ['gravel'], 12, { maxDistance: 96, maxMinutes: 2 })
    if (got === 0) await explore(bot, 60)
  }
  if (countItem(bot, 'flint') < count) throw new Error('silex introuvable (pas de gravier à portée)')
}

// ---------- Œil de l'Ender ----------

// Suit l'entité œil de l'Ender lancée ; renvoie sa position d'arrêt,
// ou null si l'œil n'a pas décollé (stronghold tout proche).
async function trackEyeOfEnder (bot, maxMs = 15000) {
  await sleep(400)
  const find = () => findEntities(bot, (e) => (e.name ?? '').includes('eye_of_ender') || (e.name ?? '') === 'ender_eye')
  let eye = find()
  if (!eye) return null
  let last = eye.position.clone()
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const e = find()
    if (!e) break
    last = e.position.clone()
    await sleep(150)
  }
  return last
}


// ---------- Gestion d'inventaire ----------

// Trie l'inventaire : empile les items similaires, met les outils/armes en hotbar (slots 0-8)
async function sortInventory (bot) {
  const priorities = ['diamond_sword','iron_sword','stone_sword','bow','arrow','pickaxe','axe','shovel','hoe','shield','torch','crafting_table','food','water_bucket','lava_bucket','ender_pearl','ender_eye','block']
  const items = bot.inventory.items()
  // Trier par priorité : outils d'abord dans la hotbar
  const sorted = [...items].sort((a, b) => {
    const pa = priorities.findIndex(p => a.name.includes(p))
    const pb = priorities.findIndex(p => b.name.includes(p))
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
  })
  for (let i = 0; i < Math.min(sorted.length, 9); i++) {
    try { await bot.equip(sorted[i], 'hand') } catch {}
  }
  return sorted.length
}

// Jette les items inutiles (dirt, gravel, rotten_flesh si pas affamé, etc.)
async function dropJunk (bot, keep = ['dirt', 'cobblestone', 'stone']) {
  // string retiré : indispensable pour l'arc (cristaux/dragon) — ce n'est pas un junk
  const junkNames = ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'bone']
  let dropped = 0
  for (const item of bot.inventory.items()) {
    if (junkNames.includes(item.name) && bot.food > 10) {
      try { await bot.tossStack(item); dropped += item.count } catch {}
    }
  }
  return dropped
}

// ---------- Récolte ciblée intégrée au craft ----------
// « Valider au fur et à mesure » : quand un ingrédient MINABLE manque, le bot
// ne s'arrête plus sur « il manque 3x raw_iron » — il va le miner, le fondre,
// puis continue la chaîne. Limité aux ressources de minage/récolte sûres et
// rapides (les drops de mobs/structures restent gérés par les phases).
const GATHER_RULES = {
  raw_iron: { y: 16, ores: ['iron_ore', 'deepslate_iron_ore'], extra: ['coal_ore', 'deepslate_coal_ore'], maxMinutes: 10 },
  raw_gold: { y: 16, ores: ['gold_ore', 'deepslate_gold_ore'], extra: ['coal_ore', 'deepslate_coal_ore'], maxMinutes: 10 },
  raw_copper: { y: 48, ores: ['copper_ore', 'deepslate_copper_ore'], extra: ['coal_ore', 'deepslate_coal_ore'], maxMinutes: 8 },
  diamond: { y: -58, ores: ['diamond_ore', 'deepslate_diamond_ore'], extra: ['coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore'], maxMinutes: 15 },
  coal: { y: 32, ores: ['coal_ore', 'deepslate_coal_ore'], extra: [], maxMinutes: 8 },
  flint: { gravel: true },
  obsidian: { obsidian: true },
  cobblestone: { stone: true },
  stone: { stone: true },
  // bûches : la base des planches/bâtons/charbon — collecte rapide par arbres proches
  oak_log: { wood: true }, birch_log: { wood: true }, spruce_log: { wood: true },
  jungle_log: { wood: true }, acacia_log: { wood: true }, dark_oak_log: { wood: true },
  cherry_log: { wood: true }, mangrove_log: { wood: true }, pale_oak_log: { wood: true }
}

// Amène l'inventaire à `count` de `name` via la récolte adaptée ; true si atteint.
async function ensureResource (bot, name, count) {
  const have = () => countItem(bot, name)
  if (have() >= count) return true
  const rule = GATHER_RULES[name]
  if (!rule) return false
  log('⛏️ il manque du ' + name + ' pour ce craft — je vais en chercher (' + (count - have()) + ')')
  if (rule.gravel) {
    await digGravelForFlint(bot, count)
  } else if (rule.obsidian) {
    await makeObsidian(bot, count)
  } else if (rule.stone) {
    await collectBlocks(bot, ['stone', 'cobblestone'], count, { maxDistance: 64, maxMinutes: 4 })
  } else if (rule.wood) {
    const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log', 'pale_oak_log']
    // mémoriser les arbres ramassés au passage (recordDiscovery déjà fait dans collectBlocks)
    await collectBlocks(bot, LOGS, count, { maxDistance: 64, maxMinutes: 3 })
    // pas de bûche obtenue ? tentative de transformation des planches restantes (idempotent)
  } else {
    // descente seulement si on est bien au-dessus du filon (sinon on mine sur place)
    if (rule.y < bot.entity.position.y - 8 && bot.game?.dimension === 'overworld') {
      await digStaircase(bot, rule.y)
    }
    await branchMine(bot, {
      y: rule.y,
      need: () => have() >= count,
      ores: rule.ores,
      extraOres: rule.extra,
      maxMinutes: rule.maxMinutes
    })
  }
  return have() >= count
}

// Wrappers sûrs : sur un serveur qui lag (ou 26.1 avec PartialReadError), les
// promesses mineflayer (activateBlock, placeBlock, equip…) peuvent pendre indéfiniment.
// Ces wrappers ajoutent un timeout pour que la mission puisse reprendre.
async function actBlock (bot, block, ms = 8000) { try { await withTimeout(bot.activateBlock(block), ms); return true } catch { return false } }
async function actItem (bot, ms = 8000) { try { await withTimeout(bot.activateItem(), ms); return true } catch { return false } }
async function deactItem (bot) { try { bot.deactivateItem() } catch {} }
async function placeSafe (bot, ref, face, ms = 8000) { try { await withTimeout(bot.placeBlock(ref, face), ms); return true } catch { return false } }
async function equipSafe (bot, item, dest = 'hand', ms = 5000) { try { await withTimeout(bot.equip(item, dest), ms); return true } catch { return false } }
async function lookSafe (bot, pos, ms = 3000) { try { await withTimeout(bot.lookAt(pos), ms) } catch {} }

module.exports = {
  Vec3, log, sleep, say, chat, proactive, announce, isItemDrop, actBlock, actItem, deactItem, placeSafe, equipSafe, lookSafe, watchBlockChanges, sortInventory, dropJunk, legit, rand, randInt, withTimeout, mcData, blockId, countItem, hasAnyItem, findEntities, equipName, digBlock,
  setMovements, goTo, walkDirect, GoalNear, GoalXZ, GoalY, GoalBlock, GoalFollow, explore, enterDimension,
  collectBlocks, collectNearbyItems, lootNearbyChests, lootSingleChest, isChestLooted,
  ensureCraftingTable, ensureFurnace, craftItem, craftAnyPlanks, smeltItem, SMELT_MAP, bestSmeltRaw, GATHER_RULES, ensureResource,
  eatUntil, FOOD_NAMES,
  equipBestSword, equipShield, huntMob, shootWithBow,
  placeBlockFromInventory, findSolidNeighbor, pillarUp,
  digStaircase, ascendTo, branchMine,
  getWaterBucket, makeObsidian, refillBucket, digGravelForFlint,
  trackEyeOfEnder
, isSolidBlock }
