// ============================================================
// LibreBot — src/build.js
// Construction : pose d'un plan de blocs + maison de base.
// ============================================================
const { Vec3, log, say, sleep, goTo, GoalNear, GoalXZ, equipName, findSolidNeighbor, pillarUp,
  countItem, collectBlocks, mcData, craftItem, craftAnyPlanks, smeltItem, getWaterBucket } = require('./utils')

const ALL_PLANKS = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks',
  'dark_oak_planks', 'cherry_planks', 'mangrove_planks', 'pale_oak_planks']
const ALL_LOGS = ALL_PLANKS.map((p) => p.replace('_planks', '_log'))

// ---------- Générateurs de plans (fonctions pures, testables) ----------

// Premier matériau de la liste présent en quantité suffisante dans l'inventaire
function pickMaterial (inv, candidates, min = 16) {
  for (const c of candidates) if ((inv[c] ?? 0) >= min) return c
  return null
}

// Plan d'une maison size×size, hauteur `height` : murs (porte au sud, fenêtres
// vitrées est/ouest), toit plat ou pyramide, et équipement intérieur utile
// (coffre, table de craft, four, torches).
function housePlan (anchor, { size = 5, height = 3, wallBlock = 'oak_planks', roofBlock = 'cobblestone', roof = 'pyramid', windows = true } = {}) {
  const entries = []
  const door = []
  const mid = Math.floor(size / 2)
  const winY = height >= 3 ? 1 : 0
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const isWall = x === 0 || x === size - 1 || z === 0 || z === size - 1
      if (!isWall) continue
      for (let y = 0; y < height; y++) {
        const p = anchor.offset(x, y, z)
        if (z === size - 1 && x === mid && y < 2) { door.push(p); continue } // porte 1×2 au sud
        if (windows && y === winY && (x === 0 || x === size - 1) && z % 2 === 1 && z > 0 && z < size - 1) {
          entries.push({ pos: p, block: 'glass' })
          continue
        }
        entries.push({ pos: p, block: wallBlock })
      }
    }
  }
  // toit (débord d'un bloc) : dalle plate ou pyramide
  for (let x = -1; x <= size; x++) {
    for (let z = -1; z <= size; z++) {
      let h = 1
      if (roof === 'pyramid') h = Math.max(1, Math.min(x + 1, size - x, z + 1, size - z))
      entries.push({ pos: anchor.offset(x, height + h - 1, z), block: roofBlock })
    }
  }
  // équipement intérieur (au niveau du sol)
  entries.push({ pos: anchor.offset(1, 0, 1), block: 'chest' })
  entries.push({ pos: anchor.offset(size - 2, 0, 1), block: 'crafting_table' })
  entries.push({ pos: anchor.offset(1, 0, size - 2), block: 'furnace' })
  for (const [tx, tz] of [[mid, 1], [1, mid], [size - 2, mid]]) {
    entries.push({ pos: anchor.offset(tx, 0, tz), block: 'torch' })
  }
  return { entries, door }
}

// Plan d'une ferme w×d : croix centrale de fossés d'eau (irrigue 4 blocs autour),
// reste en terre labourée, clôture autour, torches aux coins intérieurs.
function farmLayout (anchor, { w = 9, d = 9 } = {}) {
  const midX = Math.floor(w / 2); const midZ = Math.floor(d / 2)
  const farmland = []; const water = []; const fence = []; const torches = []
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const ground = new Vec3(anchor.x + x, anchor.y - 1, anchor.z + z)
      if (x === midX || z === midZ) water.push(ground)
      else farmland.push(ground)
      if (x === 0 || x === w - 1 || z === 0 || z === d - 1) {
        fence.push(new Vec3(anchor.x + x, anchor.y, anchor.z + z))
      }
    }
  }
  // une source d'eau tous les ~5 blocs le long de la croix suffit (l'eau s'étend à 4 blocs)
  const waterSources = [
    new Vec3(anchor.x + midX, anchor.y - 1, anchor.z + 2),
    new Vec3(anchor.x + midX, anchor.y - 1, anchor.z + d - 3),
    new Vec3(anchor.x + 2, anchor.y - 1, anchor.z + midZ),
    new Vec3(anchor.x + w - 3, anchor.y - 1, anchor.z + midZ)
  ]
  for (const [cx, cz] of [[1, 1], [w - 2, 1], [1, d - 2], [w - 2, d - 2]]) {
    torches.push(new Vec3(anchor.x + cx, anchor.y, anchor.z + cz))
  }
  return { farmland, water, waterSources, fence, torches }
}

// Plan d'une enceinte rectangulaire w×d, hauteur h, avec torches sur le dessus.
function wallPlan (center, { w = 17, d = 17, h = 3, block = 'cobblestone', torchEvery = 4 } = {}) {
  const entries = []
  const torches = []
  const x0 = center.x - Math.floor(w / 2); const z0 = center.z - Math.floor(d / 2)
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (x !== 0 && x !== w - 1 && z !== 0 && z !== d - 1) continue
      for (let y = 0; y < h; y++) entries.push({ pos: new Vec3(x0 + x, center.y + y, z0 + z), block })
      if ((x + z) % torchEvery === 0) torches.push(new Vec3(x0 + x, center.y + h, z0 + z))
    }
  }
  return { entries, torches }
}

// Plan d'un pont droit devant le bot, le long de son yaw.
function bridgePlan (from, yaw, length = 16, block = 'cobblestone') {
  const entries = []
  const dirX = -Math.sin(yaw); const dirZ = -Math.cos(yaw)
  for (let i = 2; i < length; i++) {
    entries.push({ pos: new Vec3(Math.round(from.x + dirX * i), from.y - 1, Math.round(from.z + dirZ * i)), block })
  }
  return entries
}

// ---------- Pose de plans ----------

// Pose une liste d'entrées { pos, block } (ou de Vec3 + blockName unique).
async function placePlan (bot, entries, blockName) {
  const list = entries.map((e) => (e && e.pos) ? e : { pos: e, block: blockName })
  const sorted = [...list].sort((a, b) =>
    (a.pos.y - b.pos.y) || (a.pos.distanceTo(bot.entity.position) - b.pos.distanceTo(bot.entity.position)))
  let placed = 0
  let fails = 0
  const scaffold = countItem(bot, 'cobblestone') > 0 ? 'cobblestone' : 'dirt'
  for (const entry of sorted) {
    if (fails > 20) break
    const p = entry.pos
    const name = entry.block
    const current = bot.blockAt(p)
    if (current && current.name === name) { placed++; continue }
    if (current && current.boundingBox === 'solid' && current.name !== 'air') { fails++; continue }
    // s'élever si la cible est trop haute (échafaudage)
    const dy = p.y - bot.entity.position.y
    if (dy > 3) {
      try { await pillarUp(bot, p.y - 1, scaffold) } catch (e) { fails++; continue }
    }
    const ref = findSolidNeighbor(bot, p)
    if (!ref) { fails++; continue }
    if (bot.entity.position.distanceTo(ref.position) > 4.2) {
      const ok = await goTo(bot, new GoalNear(ref.position.x, ref.position.y, ref.position.z, 1), { timeout: 25000, retries: 0 })
      if (!ok) { fails++; continue }
    }
    try {
      await equipName(bot, name, 'hand')
      const face = p.minus(ref.position)
      await bot.placeBlock(ref, face)
      placed++
      fails = 0
      await sleep(120)
    } catch (e) { fails++ }
  }
  return placed
}

// Trouve un terrain plat de `size` × `size` autour du bot
async function findFlatSpot (bot, size = 6) {
  const { x, y, z } = bot.entity.position.floored()
  for (let r = 0; r < 24; r += 4) {
    for (let dx = -r; dx <= r; dx += 4) {
      for (let dz = -r; dz <= r; dz += 4) {
        const cx = x + dx
        const cz = z + dz
        // trouver le sol au-dessus (colonne la plus proche)
        let ground = null
        for (let dy = 6; dy > -6; dy--) {
          const b = bot.blockAt(new Vec3(cx, y + dy, cz))
          if (b && b.boundingBox === 'solid') { ground = y + dy + 1; break }
        }
        if (ground === null) continue
        let flat = true
        for (let i = 0; i < size && flat; i++) {
          for (let j = 0; j < size && flat; j++) {
            const g = bot.blockAt(new Vec3(cx + i, ground - 1, cz + j))
            const a1 = bot.blockAt(new Vec3(cx + i, ground, cz + j))
            const a2 = bot.blockAt(new Vec3(cx + i, ground + 1, cz + j))
            if (!g || g.boundingBox !== 'solid' || !a1 || a1.name !== 'air' || !a2 || a2.name !== 'air') flat = false
          }
        }
        if (flat) return new Vec3(cx, ground, cz)
      }
    }
  }
  return new Vec3(x, y, z) // tant pis : on construit où on est
}

// ---------- Matériaux ----------

function inventoryMap (bot) {
  const inv = {}
  for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] ?? 0) + i.count
  return inv
}

// Récolte/crafte ce qu'il faut pour avoir `count` blocs de blockName
async function ensureMaterial (bot, blockName, count) {
  const missing = count - countItem(bot, blockName)
  if (missing <= 0) return
  if (blockName.endsWith('_planks')) {
    await collectBlocks(bot, ALL_LOGS, Math.ceil(missing / 4) + 2, { maxDistance: 160, maxMinutes: 6 })
    await craftAnyPlanks(bot, missing)
  } else if (blockName === 'cobblestone' || blockName === 'stone') {
    await collectBlocks(bot, ['stone'], missing + 4, { maxDistance: 96, maxMinutes: 8 })
  } else if (blockName === 'dirt') {
    await collectBlocks(bot, ['dirt'], missing + 4, { maxDistance: 64, maxMinutes: 4 })
  } else if (blockName === 'glass') {
    const sand = await collectBlocks(bot, ['sand'], missing + 2, { maxDistance: 96, maxMinutes: 4 })
    if (sand > 0) { try { await smeltItem(bot, 'sand', 'glass', missing) } catch (e) { log(`verre : ${e.message}`) } }
  } else if (blockName.endsWith('_fence')) {
    const planks = blockName.replace('_fence', '_planks')
    await ensureMaterial(bot, planks, Math.ceil(missing / 2) + 2)
    try { await craftItem(bot, blockName, missing) } catch (e) { log(`clôture : ${e.message}`) }
  }
}

// ---------- Construction ----------

// Construit une maison size×size : matériaux choisis selon l'inventaire,
// toit plat ou pyramide, fenêtres, et équipement intérieur (coffre, table, four).
async function buildHouse (bot, { size = 5, height = 3, roof = 'pyramid' } = {}) {
  say(bot, `🏠 Je construis une maison ${size}×${size}`)
  const inv = inventoryMap(bot)
  const wallBlock = pickMaterial(inv, ALL_PLANKS, 20) ?? pickMaterial(inv, ['cobblestone', 'stone'], 20) ?? 'dirt'
  const roofBlock = pickMaterial(inv, ['cobblestone', 'stone'], 30) ?? pickMaterial(inv, ALL_PLANKS, 30) ?? wallBlock
  const wallCount = (4 * size - 4) * height
  const roofCount = (size + 2) * (size + 2)
  await ensureMaterial(bot, wallBlock, wallCount + 8)
  await ensureMaterial(bot, roofBlock, roofCount + 8)
  await ensureMaterial(bot, 'glass', 4) // fenêtres (best-effort)
  await ensureMaterial(bot, 'chest', 1)
  await ensureMaterial(bot, 'crafting_table', 1)
  await ensureMaterial(bot, 'furnace', 1)
  if (countItem(bot, 'torch') < 3) { try { await craftItem(bot, 'torch', 3) } catch {} }

  const anchor = await findFlatSpot(bot, size + 2)
  const plan = housePlan(anchor, { size, height, wallBlock, roofBlock, roof })
  const placed = await placePlan(bot, plan.entries)
  say(bot, `🏠 Maison construite en (${anchor.x}, ${anchor.y}, ${anchor.z}) — ${placed} blocs posés`)
  return anchor
}

// Ferme automatique w×d : fossés d'eau en croix, terre labourée, graines, clôture, torches.
async function buildFarm (bot, { w = 9, d = 9 } = {}) {
  say(bot, `🌾 Je construis une ferme ${w}×${d}`)
  if (countItem(bot, 'water_bucket') === 0) await getWaterBucket(bot)
  const hoe = countItem(bot, 'iron_ingot') >= 3 ? 'iron_hoe' : 'wooden_hoe'
  await craftItem(bot, hoe, 1)
  const anchor = await findFlatSpot(bot, Math.max(w, d) + 2)
  const layout = farmLayout(anchor, { w, d })
  // creuser les fossés d'eau
  for (const p of layout.water) {
    const b = bot.blockAt(p)
    if (b && b.boundingBox !== 'empty' && b.name !== 'water') {
      try { await bot.dig(b, true) } catch {}
    }
  }
  // poser les sources d'eau au fond des fossés
  for (const p of layout.waterSources) {
    try {
      await goTo(bot, new GoalNear(p.x, p.y + 1, p.z, 1), { timeout: 20000, retries: 0 })
      await equipName(bot, 'water_bucket', 'hand')
      await bot.lookAt(p.offset(0.5, -0.4, 0.5))
      await bot.activateItem()
      await sleep(400)
    } catch (e) { log(`eau ratée en ${p} : ${e.message}`) }
  }
  // labourer la terre
  for (const p of layout.farmland) {
    const soil = bot.blockAt(p)
    if (!soil || soil.name === 'farmland') continue
    try {
      await goTo(bot, new GoalNear(p.x, p.y + 1, p.z, 1), { timeout: 15000, retries: 0 })
      await equipName(bot, hoe, 'hand')
      await bot.activateBlock(soil)
      await sleep(200)
    } catch (e) {}
  }
  // planter les graines si on en a
  const seed = bot.inventory.items().find((i) => i.name === 'wheat_seeds')
  if (seed) {
    for (const p of layout.farmland) {
      const soil = bot.blockAt(p)
      if (!soil || soil.name !== 'farmland') continue
      try {
        await goTo(bot, new GoalNear(p.x, p.y + 1, p.z, 1), { timeout: 15000, retries: 0 })
        await bot.equip(seed, 'hand')
        await bot.activateBlock(soil)
        await sleep(150)
      } catch (e) {}
    }
  }
  // clôture + torches (best-effort)
  const inv = inventoryMap(bot)
  const fenceBlock = pickMaterial(inv, ALL_PLANKS.map((p) => p.replace('_planks', '_fence')), 20)
  if (fenceBlock) {
    await ensureMaterial(bot, fenceBlock, layout.fence.length)
    await placePlan(bot, layout.fence.map((pos) => ({ pos, block: fenceBlock })))
  }
  if (countItem(bot, 'torch') < 4) { try { await craftItem(bot, 'torch', 4) } catch {} }
  await placePlan(bot, layout.torches.map((pos) => ({ pos, block: 'torch' })))
  say(bot, `🌾 Ferme prête en (${anchor.x}, ${anchor.y}, ${anchor.z})`)
  return anchor
}

// Enceinte de protection w×d autour d'un centre (base par défaut), avec torches dessus.
async function buildWall (bot, { center, w = 17, d = 17, h = 3 } = {}) {
  say(bot, `🧱 Je construis une enceinte ${w}×${d}`)
  const c = center ?? bot.entity.position.floored()
  const inv = inventoryMap(bot)
  const block = pickMaterial(inv, ['cobblestone', 'stone', ...ALL_PLANKS, 'dirt'], 40) ?? 'cobblestone'
  const count = (2 * w + 2 * d - 4) * h
  await ensureMaterial(bot, block, count + 10)
  if (countItem(bot, 'torch') < 8) { try { await craftItem(bot, 'torch', 8) } catch {} }
  const plan = wallPlan(new Vec3(Math.round(c.x), Math.round(c.y), Math.round(c.z)), { w, d, h, block })
  const placed = await placePlan(bot, plan.entries)
  await placePlan(bot, plan.torches.map((pos) => ({ pos, block: 'torch' })))
  say(bot, `🧱 Enceinte construite (${placed} blocs) autour de (${c.x}, ${c.z})`)
  return plan
}

// Pont droit de `length` blocs devant le bot (dans la direction où il regarde).
async function buildBridge (bot, length = 16) {
  say(bot, `🌉 Je construis un pont de ${length} blocs`)
  const from = bot.entity.position.floored()
  const inv = inventoryMap(bot)
  const block = pickMaterial(inv, ['cobblestone', 'stone', ...ALL_PLANKS], 8) ?? 'dirt'
  await ensureMaterial(bot, block, length + 4)
  const entries = bridgePlan(from, bot.entity.yaw, length, block)
  const placed = await placePlan(bot, entries)
  say(bot, `🌉 Pont posé (${placed}/${entries.length} blocs)`)
  return placed
}

// Cadre de portail du Nether (14 obsidienne), puis allumage.
async function buildNetherPortal (bot) {
  say(bot, '🔥 Je construis le portail du Nether')
  const anchor = await findFlatSpot(bot, 6)
  const w = 4
  const h = 5
  const plan = []
  for (let x2 = 0; x2 < w; x2++) plan.push(anchor.offset(x2, 0, 0)) // base
  for (let y2 = 1; y2 <= 3; y2++) {
    plan.push(anchor.offset(0, y2, 0))
    plan.push(anchor.offset(w - 1, y2, 0))
  }
  for (let x2 = 0; x2 < w; x2++) plan.push(anchor.offset(x2, h - 1, 0)) // sommet
  const placed = await placePlan(bot, plan, 'obsidian')
  if (placed < 12) throw new Error(`portail incomplet (${placed}/14 blocs posés)`)
  // allumer
  const inner = anchor.offset(1, 1, 0)
  await goTo(bot, new GoalNear(inner.x, inner.y, inner.z, 1), { timeout: 20000, retries: 0 })
  await equipName(bot, 'flint_and_steel', 'hand')
  const obsidian = bot.blockAt(anchor.offset(1, 0, 0))
  await bot.lookAt(obsidian.position.offset(0.5, 1.1, 0.5))
  let ignited = false
  try { await bot.activateBlock(obsidian); ignited = true } catch {}
  if (!ignited) {
    try { await bot.activateItem() } catch {}
  }
  await sleep(1500)
  const md = mcData(bot)
  const portalBlock = bot.findBlock({ matching: md.blocksByName.nether_portal?.id, maxDistance: 8 })
  if (!portalBlock) throw new Error('le portail ne s\'allume pas')
  say(bot, '🔥 Portail allumé !')
  return portalBlock.position
}

module.exports = {
  placePlan, findFlatSpot,
  pickMaterial, housePlan, farmLayout, wallPlan, bridgePlan,
  buildHouse, buildFarm, buildWall, buildBridge, buildNetherPortal
}
