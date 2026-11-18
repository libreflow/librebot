// ============================================================
// LibreBot — src/build.js
// Construction : pose d'un plan de blocs + maison de base.
// ============================================================
const { Vec3, log, say, chat, sleep, goTo, GoalNear, GoalXZ, equipName, findSolidNeighbor, pillarUp,
  countItem, collectBlocks, mcData, blockId, actBlock, actItem, deactItem, placeSafe, equipSafe, lookSafe } = require('./utils')

// Pose une liste de blocs (triés du bas vers le haut).
async function placePlan (bot, positions, blockName) {
  const sorted = [...positions].sort((a, b) =>
    (a.y - b.y) || (a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)))
  let placed = 0
  let fails = 0
  for (const p of sorted) {
    if (fails > 15) break
    const current = bot.blockAt(p)
    if (current && current.name === blockName) { placed++; continue }
    if (current && current.boundingBox === 'solid' && current.name !== 'air') { fails++; continue }
    // s'élever si la cible est trop haute (échafaudage en cobble)
    const dy = p.y - bot.entity.position.y
    if (dy > 3) {
      try { await pillarUp(bot, p.y - 1, 'cobblestone') } catch (e) { fails++; continue }
    }
    const ref = findSolidNeighbor(bot, p)
    if (!ref) { fails++; continue }
    if (bot.entity.position.distanceTo(ref.position) > 4.2) {
      const ok = await goTo(bot, new GoalNear(ref.position.x, ref.position.y, ref.position.z, 1), { timeout: 25000, retries: 0 })
      if (!ok) { fails++; continue }
    }
    try {
      await equipName(bot, blockName, 'hand')
      const face = p.minus(ref.position)
      await placeSafe(bot, ref, face)
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
  // pas de 6 au lieu de 4 : divise par ~2 le nombre de positions testées
  // (avant : jusqu'à ~15 000 blockAt avec le pas de 4)
  for (let r = 0; r < 24; r += 6) {
    for (let dx = -r; dx <= r; dx += 6) {
      for (let dz = -r; dz <= r; dz += 6) {
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

// Construit une petite maison 5×5 (murs en planches, toit en cobble).
async function buildHouse (bot) {
  chat(bot, 'building', {}, { force: true })
  say(bot, '🏠 Je construis la base')
  const md = mcData(bot)
  const size = 5
  const h = 3
  // matériaux : planches + cobble pour le toit
  if (countItem(bot, 'oak_planks') < 40) {
    const needLogs = Math.ceil((48 - countItem(bot, 'oak_planks')) / 4)
    await collectBlocks(bot, ['oak_log', 'birch_log', 'spruce_log', 'acacia_log'], needLogs, { maxDistance: 160, maxMinutes: 6 })
    const { craftAnyPlanks } = require('./utils')
    await craftAnyPlanks(bot, 48)
  }
  if (countItem(bot, 'cobblestone') < 56) {
    await collectBlocks(bot, ['stone', 'cobblestone'], 56 - countItem(bot, 'cobblestone'), { maxDistance: 64, maxMinutes: 6 })
  }

  const anchor = await findFlatSpot(bot, size + 2)
  const wallBlock = countItem(bot, 'oak_planks') >= 40 ? 'oak_planks' : 'cobblestone'

  const plan = []
  for (let x2 = 0; x2 < size; x2++) {
    for (let z2 = 0; z2 < size; z2++) {
      const isWall = (x2 === 0 || x2 === size - 1 || z2 === 0 || z2 === size - 1)
      if (!isWall) continue
      for (let y2 = 0; y2 < h; y2++) {
        // porte (trou 1×2) au milieu du côté sud
        if (z2 === size - 1 && x2 === Math.floor(size / 2) && y2 < 2) continue
        plan.push(anchor.offset(x2, y2, z2))
      }
    }
  }
  // toit 7×7 (dépasse d'un bloc de chaque côté)
  for (let x2 = -1; x2 <= size; x2++) {
    for (let z2 = -1; z2 <= size; z2++) {
      plan.push(anchor.offset(x2, h, z2))
    }
  }
  await placePlan(bot, plan, wallBlock)
  // toit en cobble par-dessus les planches
  const roof = []
  for (let x2 = -1; x2 <= size; x2++) {
    for (let z2 = -1; z2 <= size; z2++) {
      roof.push(anchor.offset(x2, h, z2))
    }
  }
  await placePlan(bot, roof, 'cobblestone')
  // torches à l'intérieur
  try {
    await goTo(bot, new GoalNear(anchor.x + 2, anchor.y, anchor.z + 2, 1), { timeout: 20000, retries: 0 })
    const { placeBlockFromInventory } = require('./utils')
    if (countItem(bot, 'torch') >= 1) await placeBlockFromInventory(bot, 'torch')
  } catch (e) { log(`torche intérieure ratée : ${e.message}`) }
  chat(bot, 'built', { x: anchor.x, y: anchor.y, z: anchor.z }, { force: true })
  say(bot, '🏠 Base construite en (' + anchor.x + ', ' + anchor.y + ', ' + anchor.z + ')')
  return anchor
}

// Cadre de portail du Nether (14 obsidienne), puis allumage.
async function buildNetherPortal (bot) {
  chat(bot, 'building', {}, { force: true })
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
  // 10 obsidiennes suffisent : les 4 coins d'un portail 4×5 sont optionnels (speedrun)
  if (placed < 10) throw new Error(`portail incomplet (${placed}/14 blocs posés, 10 minimum)`)
  // allumer
  const inner = anchor.offset(1, 1, 0)
  await goTo(bot, new GoalNear(inner.x, inner.y, inner.z, 1), { timeout: 20000, retries: 0 })
  await equipName(bot, 'flint_and_steel', 'hand')
  const obsidian = bot.blockAt(anchor.offset(1, 0, 0))
  await lookSafe(bot, obsidian.position.offset(0.5, 1.1, 0.5))
  let ignited = false
  try { await actBlock(bot, obsidian); ignited = true } catch {}
  if (!ignited) {
    try { await actItem(bot) } catch {}
  }
  await sleep(1500)
  const portalId = blockId(bot, 'nether_portal')
  // guard : matching undefined matcherait tous les blocs
  const portalBlock = portalId ? bot.findBlock({ matching: portalId, maxDistance: 8 }) : null
  if (!portalBlock) throw new Error('le portail ne s\'allume pas')
  chat(bot, 'portalBuilt', {}, { force: true })
  say(bot, '🔥 Portail allumé !')
  return portalBlock.position
}

module.exports = { placePlan, findFlatSpot, buildHouse, buildNetherPortal }
