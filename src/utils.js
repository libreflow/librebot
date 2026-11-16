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

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (bot, msg) => { log(msg); try { bot.chat(String(msg)) } catch {} }
const rand = (a, b) => a + Math.random() * (b - a)
const randInt = (a, b) => Math.floor(rand(a, b + 1))

function withTimeout (promise, ms) {
  return Promise.race([
    promise,
    sleep(ms).then(() => { throw new Error(`délai dépassé (${Math.round(ms / 1000)}s)`) })
  ])
}

const mcData = (bot) => require('minecraft-data')(bot.version)

function countItem (bot, name) {
  return bot.inventory.items().filter((i) => i.name === name).reduce((a, i) => a + i.count, 0)
}

async function equipName (bot, name, dest = 'hand') {
  const item = bot.inventory.items().find((i) => i.name === name)
  if (!item) throw new Error(`équipement introuvable : ${name}`)
  await bot.equip(item, dest)
}

// ---------- Déplacements ----------

function setMovements (bot) {
  const movements = new Movements(bot)
  movements.canDig = true
  movements.allowSprinting = true
  movements.allowParkour = true
  bot.pathfinder.setMovements(movements)
  // Aternos / 26.x : laisser plus de temps au A* (défaut 5s, trop juste en latence)
  bot.pathfinder.thinkTimeout = 30000
  bot.pathfinder.tickTimeout = 50
  // collectBlock a ses propres movements : même réglage
  if (bot.collectBlock) {
    bot.collectBlock.movements = movements
  }
}

async function goTo (bot, goal, { timeout = 150000, retries = 2, stuckMs = 20000 } = {}) {
  setMovements(bot)
  let lastErr = null
  for (let i = 0; i <= retries; i++) {
    if (bot._fleeing) { log('🏃 fuite en cours — trajet annulé'); return false }
    // détection de blocage : si la position ne change plus, on force un recalcul du chemin
    let lastPos = bot.entity.position.clone()
    let lastMove = Date.now()
    const watch = setInterval(() => {
      if (bot.entity.position.distanceTo(lastPos) > 0.3) {
        lastPos = bot.entity.position.clone()
        lastMove = Date.now()
      }
    }, 1000)
    const stuckKiller = setInterval(() => {
      if (Date.now() - lastMove > stuckMs) {
        log('⚠️ bloqué depuis ' + stuckMs / 1000 + 's — recalcul du chemin')
        try { bot.pathfinder.stop() } catch {}
      }
    }, 5000)
    try {
      await withTimeout(bot.pathfinder.goto(goal), timeout)
      clearInterval(watch); clearInterval(stuckKiller)
      return true
    } catch (err) {
      clearInterval(watch); clearInterval(stuckKiller)
      lastErr = err
      try { bot.pathfinder.stop() } catch {}
      await sleep(2000)
    }
  }
  log(`✗ déplacement échoué : ${lastErr?.message ?? lastErr}`)
  return false
}

async function explore (bot, dist = 80) {
  // 1. arbre mémorisé le plus proche (apprentissage) : on y retourne directement
  const known = learn.getNearestDiscovery('tree', bot.entity.position)
  if (known && known.dist < 300) {
    log(`🌲 arbre mémorisé à ${Math.round(known.dist)} blocs (${known.x}, ${known.z}) — j'y retourne`)
    return goTo(bot, new GoalNear(known.x, known.y, known.z, 3), { timeout: 120000, retries: 1 })
  }
  // 2. arbre visible dans les chunks chargés
  const md = mcData(bot)
  const logIds = Object.values(md.blocksByName).filter((b) => b.name.endsWith('_log')).map((b) => b.id)
  if (logIds.length) {
    const spots = bot.findBlocks({ matching: logIds, maxDistance: 128, count: 8 })
    if (spots.length) {
      const s = spots.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0]
      log(`🌲 arbre détecté à ${Math.round(s.distanceTo(bot.entity.position))} blocs — j'y vais`)
      return goTo(bot, new GoalNear(s.x, s.y, s.z, 3), { timeout: 120000, retries: 1 })
    }
  }
  // 3. sinon spirale autour du point de départ (évite de tourner en rond)
  const ex = learn.bumpExplore(dist)
  const { x, z } = bot.entity.position
  const tx = x + Math.cos(ex.angle) * ex.radius
  const tz = z + Math.sin(ex.angle) * ex.radius
  log(`🧭 j'explore en spirale vers (${Math.round(tx)}, ${Math.round(tz)}) (rayon ${Math.round(ex.radius)})`)
  return goTo(bot, new GoalXZ(tx, tz), { timeout: 150000, retries: 1 })
}

// Attendre un changement de dimension (portail utilisé)
async function enterDimension (bot, dimensionName, timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const dim = bot.game?.dimension ?? ''
    if (dim.includes(dimensionName)) return true
    await sleep(1000)
  }
  return false
}

// ---------- Récolte de blocs ----------

async function collectBlocks (bot, names, count, { maxDistance = 128, maxMinutes = 10 } = {}) {
  setMovements(bot) // applique aussi thinkTimeout à collectBlock.movements
  const md = mcData(bot)
  const ids = names.map((n) => md.blocksByName[n]?.id).filter(Boolean)
  let got = 0
  let fails = 0
  const t0 = Date.now()
  while (got < count && Date.now() - t0 < maxMinutes * 60000 && fails < 8) {
    const positions = bot.findBlocks({ matching: ids, maxDistance, count: 32 })
    if (!positions.length) { log(`🔍 aucun bloc [${names.join(',')}] à moins de ${maxDistance} blocs`); break }
    // mémoriser les arbres vus pour y retourner plus tard
    if (names.some((n) => n.endsWith('_log'))) {
      for (const pos of positions.slice(0, 4)) learn.recordDiscovery('tree', pos)
    }
    positions.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))
    let progressed = false
    for (const pos of positions) {
      const block = bot.blockAt(pos)
      if (!block) continue
      try {
        const vein = await findFromVein(bot, block, 8, 16, 1)
        log(`⛏️ je mine ${vein.length} bloc(s) à ${Math.round(block.position.distanceTo(bot.entity.position))} blocs`)
        await withTimeout(bot.collectBlock.collect(vein, { ignoreNoPath: true }), 150000)
        await collectNearbyItems(bot, 12, 8000) // ramasser les drops restés au sol
        got += vein.length
        log(`⛏️ +${vein.length} blocs collectés (total ${got}/${count})`)
        progressed = true
        if (got >= count) break
      } catch (err) {
        log(`collecte ratée (${err.message})`)
      }
    }
    if (!progressed) fails++
  }
  await collectNearbyItems(bot, 16, 15000)
  return got
}

// Ramasser les objets au sol autour du bot (drops de mobs / blocs minés)
async function collectNearbyItems (bot, radius = 12, maxMs = 20000) {
  const t0 = Date.now()
  let misses = 0
  while (Date.now() - t0 < maxMs && misses < 3) {
    const item = bot.nearestEntity((e) =>
      (e.name === 'item' || e.displayName === 'Item') &&
      e.position.distanceTo(bot.entity.position) < radius)
    if (!item) { misses++; await sleep(500); continue }
    misses = 0
    // si l'item est déjà très proche, pas besoin de se déplacer précisément
    if (item.position.distanceTo(bot.entity.position) > 1.5) {
      await goTo(bot, new GoalNear(item.position.x, item.position.y, item.position.z, 1), { timeout: 8000, retries: 0 })
    }
    await sleep(300)
  }
}

// ---------- Craft ----------

async function ensureCraftingTable (bot) {
  const md = mcData(bot)
  const tableId = md.blocksByName.crafting_table.id
  let table = bot.findBlock({ matching: tableId, maxDistance: 48 })
  if (table && table.position.distanceTo(bot.entity.position) > 4) {
    await goTo(bot, new GoalNear(table.position.x, table.position.y, table.position.z, 2), { timeout: 60000, retries: 0 })
    table = bot.findBlock({ matching: tableId, maxDistance: 8 })
  }
  if (table) return table
  if (countItem(bot, 'crafting_table') > 0) {
    await placeBlockFromInventory(bot, 'crafting_table')
  } else {
    // crafter une table directement dans l'inventaire (recette sans table)
    const recipes = bot.recipesFor(md.itemsByName.crafting_table.id, null, 1, null)
    if (!recipes?.length) throw new Error('pas de planches pour crafter une table')
    await bot.craft(recipes[0], 1, null)
    await placeBlockFromInventory(bot, 'crafting_table')
  }
  table = bot.findBlock({ matching: tableId, maxDistance: 8 })
  if (!table) throw new Error('impossible de poser une table de craft')
  return table
}

async function ensureFurnace (bot) {
  const md = mcData(bot)
  const furnaceId = md.blocksByName.furnace.id
  let furnace = bot.findBlock({ matching: furnaceId, maxDistance: 48 })
  if (furnace && furnace.position.distanceTo(bot.entity.position) > 4) {
    await goTo(bot, new GoalNear(furnace.position.x, furnace.position.y, furnace.position.z, 2), { timeout: 60000, retries: 0 })
    furnace = bot.findBlock({ matching: furnaceId, maxDistance: 8 })
  }
  if (furnace) return furnace
  if (countItem(bot, 'furnace') === 0) await craftItem(bot, 'furnace', 1)
  await placeBlockFromInventory(bot, 'furnace')
  furnace = bot.findBlock({ matching: furnaceId, maxDistance: 8 })
  if (!furnace) throw new Error('impossible de poser un four')
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

  // cas particuliers obtenus par d'autres moyens
  if (name === 'iron_ingot') {
    await smeltItem(bot, 'raw_iron', 'iron_ingot', count)
    return
  }
  const NOT_CRAFTABLE = ['diamond', 'raw_iron', 'coal', 'charcoal', 'flint', 'ender_pearl', 'blaze_rod', 'obsidian', 'feather', 'arrow_punch_does_not_exist']
  if (NOT_CRAFTABLE.includes(name)) throw new Error(`${name} ne se craft pas : phase récolte nécessaire`)

  const table = await ensureCraftingTable(bot)
  let recipes = bot.recipesFor(item.id, null, 1, table) ?? []
  if (!recipes.length) recipes = (bot.recipesAll(item.id, null, table) ?? []).filter((r) => (table || !r.requiresTable))
  if (!recipes.length) throw new Error(`pas de recette pour ${name}`)
  // préférer une recette craftable immédiatement (gère les variantes de planches)
  const craftable = recipes.find((r) => (r.ingredients ?? []).every((ing) => {
    const it = md.items[ing.id]
    return it && countItem(bot, it.name) >= (ing.count ?? 1)
  }))
  const recipe = craftable ?? recipes[0]
  const resultCount = recipe.result?.count ?? 1
  const crafts = Math.ceil(need / resultCount)

  for (const ing of recipe.ingredients ?? []) {
    const ingItem = md.items[ing.id]
    if (!ingItem) continue
    const ingNeed = (ing.count ?? 1) * crafts
    if (countItem(bot, ingItem.name) < ingNeed) await craftItem(bot, ingItem.name, ingNeed)
  }

  const freshTable = await ensureCraftingTable(bot)
  await bot.craft(recipe, crafts, freshTable)
  log(`✓ crafté ${crafts}× ${name}`)
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

async function smeltItem (bot, rawName, outName, count) {
  const md = mcData(bot)
  const furnaceBlock = await ensureFurnace(bot)
  let safety = 0
  while (countItem(bot, outName) < count && safety++ < 40) {
    const raw = bot.inventory.items().find((i) => i.name === rawName)
    if (!raw) break
    const fuel = bot.inventory.items().find((i) =>
      ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks', 'oak_log', 'stick'].includes(i.name))
    if (!fuel) { log('plus de combustible'); break }
    const furnace = await bot.openFurnace(furnaceBlock)
    try {
      const batch = Math.min(raw.count, count - countItem(bot, outName))
      await furnace.putInput(raw.type, null, batch)
      const perFuel = (fuel.name === 'coal' || fuel.name === 'charcoal') ? 8 : 2
      await furnace.putFuel(fuel.type, null, Math.min(fuel.count, Math.max(1, Math.ceil(batch / perFuel))))
      for (let t = 0; t < 360; t++) { // attendre la cuisson (max 3 min par lot)
        await sleep(500)
        if (!furnace.inputItem() || (furnace.outputItem()?.count ?? 0) >= batch) break
      }
      if (furnace.outputItem()) await furnace.takeOutput()
    } finally {
      try { furnace.close() } catch {}
    }
    await sleep(500)
  }
  if (countItem(bot, outName) < count) throw new Error(`fonte incomplète : ${outName} (${countItem(bot, outName)}/${count})`)
}

// ---------- Nourriture ----------

const FOOD_NAMES = ['golden_apple', 'cooked_beef', 'beef', 'cooked_porkchop', 'porkchop', 'cooked_mutton', 'mutton',
  'cooked_chicken', 'chicken', 'cooked_cod', 'bread', 'apple', 'rotten_flesh']

async function eatUntil (bot, target = 18) {
  let safety = 0
  while (bot.food < target && safety++ < 10) {
    const food = bot.inventory.items().find((i) => FOOD_NAMES.includes(i.name))
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

async function equipBestSword (bot) {
  for (const sword of ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword']) {
    if (countItem(bot, sword) > 0) { await equipName(bot, sword, 'hand'); return sword }
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
    await equipBestSword(bot)
    await equipShield(bot)
    const mob = bot.nearestEntity((e) =>
      mobNames.includes(e.name) && e.isValid !== false &&
      e.position.distanceTo(bot.entity.position) < 48)
    if (!mob) { await sleep(3000); continue }
    // watchdog : si la vie chute pendant le combat, on interrompt
    let interrupt = false
    const watcher = setInterval(() => {
      if (bot.health < 8) { interrupt = true; try { bot.pvp.stop() } catch {} }
    }, 500)
    try {
      await withTimeout(bot.pvp.attack(mob), 45000)
    } catch (err) {
      try { bot.pvp.stop() } catch {}
      log(`combat interrompu (${interrupt ? 'vie trop basse' : err.message})`)
    }
    clearInterval(watcher)
    await collectNearbyItems(bot, 12, 12000)
    if (interrupt) { // fuir un peu et se soigner
      const { x, z } = bot.entity.position
      await goTo(bot, new GoalXZ(x + randInt(-16, 16), z + randInt(-16, 16)), { timeout: 15000, retries: 0 })
      await eatUntil(bot)
      await sleep(6000)
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
  // anneaux de plus en plus larges, et on teste y-1 (plat) puis y-2 (pente descendante)
  const candidates = []
  for (let r = 1; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        candidates.push([dx, dz])
      }
    }
  }
  for (const [dx, dz] of candidates) {
    for (const dy of [-1, -2]) {
      const groundPos = new Vec3(base.x + dx, base.y + dy, base.z + dz)
      const ground = bot.blockAt(groundPos)
      if (!ground || ground.boundingBox !== 'solid') continue
      const above = bot.blockAt(groundPos.offset(0, 1, 0))
      const above2 = bot.blockAt(groundPos.offset(0, 2, 0))
      if (!above || above.name !== 'air') continue
      if (above2 && above2.name !== 'air') continue
      if (groundPos.distanceTo(bot.entity.position) > 4.2) continue
      try {
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
    if (b && b.boundingBox === 'solid') return b
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
      if (ref && ref.boundingBox === 'solid') await bot.placeBlock(ref, new Vec3(0, 1, 0))
      else fails++
    } catch (e) { fails++ }
    bot.setControlState('jump', false)
    await sleep(300)
  }
  if (bot.entity.position.y < targetY - 1) throw new Error('impossible de monter plus haut (obstacle ?)')
}

// ---------- Creusement ----------

const FLUIDS = ['lava', 'water', 'flowing_lava', 'flowing_water']
const isFluid = (b) => b && (FLUIDS.includes(b.name) || (b.name ?? '').includes('lava') || (b.name ?? '').includes('water'))

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
          if (b && b.boundingBox !== 'empty' && !isFluid(b)) await bot.dig(b, true)
        }
        if (isFluid(bot.blockAt(foot.offset(0, -1, 0)))) continue // révélé après creusage
        await goTo(bot, new GoalNear(foot.x, foot.y, foot.z, 0), { timeout: 15000, retries: 0 })
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
    // ramasser les minerais visibles
    const spots = bot.findBlocks({ matching: oreIds, maxDistance: 64, count: 48 })
    // mémoriser les minerais vus pour y retourner directement
    for (const pos of spots.slice(0, 6)) {
      const b = bot.blockAt(pos)
      if (b && b.name.includes('ore')) learn.recordDiscovery(b.name, pos)
    }
    let collected = false
    for (const pos of spots.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))) {
      const b = bot.blockAt(pos)
      if (!b) continue
      try {
        const vein = await findFromVein(bot, b, 12, 24, 1)
        await withTimeout(bot.collectBlock.collect(vein, { ignoreNoPath: true }), 150000)
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
    const spots = bot.findBlocks({ matching: waterId, maxDistance: attempt < 4 ? 64 : 200, count: 32 })
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
    const spots = bot.findBlocks({ matching: lavaId, maxDistance: 96, count: 64 })
    const sources = spots
      .map((p) => bot.blockAt(p))
      .filter((b) => b && b.name === 'lava' && (b.properties?.level ?? '0') === '0')
    if (!sources.length) { await explore(bot, 60); continue }
    const spot = sources[0]
    say(bot, '🪣 Je verse de l\'eau sur la lave pour fabriquer de l\'obsidienne')
    await goTo(bot, new GoalXZ(spot.position.x, spot.position.z), { timeout: 45000, retries: 0 })
    await equipName(bot, 'water_bucket', 'hand')
    await bot.lookAt(spot.position.offset(0.5, 2, 0.5))
    await bot.activateItem()
    await sleep(4000)
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
  const find = () => Object.values(bot.entities).find((e) => (e.name ?? '').includes('eye_of_ender') || (e.name ?? '') === 'ender_eye')
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

module.exports = {
  Vec3, log, sleep, say, rand, randInt, withTimeout, mcData, countItem, equipName,
  setMovements, goTo, GoalNear, GoalXZ, GoalY, GoalBlock, GoalFollow, explore, enterDimension,
  collectBlocks, collectNearbyItems,
  ensureCraftingTable, ensureFurnace, craftItem, craftAnyPlanks, smeltItem,
  eatUntil, FOOD_NAMES,
  equipBestSword, equipShield, huntMob, shootWithBow,
  placeBlockFromInventory, findSolidNeighbor, pillarUp,
  digStaircase, ascendTo, branchMine,
  getWaterBucket, makeObsidian, refillBucket, digGravelForFlint,
  trackEyeOfEnder
}
