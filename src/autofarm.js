// ============================================================
// LibreBot — src/autofarm.js
// Farm automatique : laboure, sème, récolte en boucle près de la base.
// Assure une source de nourriture infinie (blé → pain, ou carottes/patates).
// ============================================================
const { Vec3, log, say, chat, sleep, mcData, countItem, equipName, goTo, GoalNear, craftItem, collectNearbyItems , actBlock, actItem, deactItem, placeSafe, equipSafe, lookSafe } = require('./utils')

// Trouve un terrain plat de N×N près du bot, transforme en farmland, sème
async function setupFarm (bot, size = 5) {
  const md = mcData(bot)
  const base = bot.entity.position.floored()
  // Chercher de l'eau à proximité (irrigation optimale, mais pas obligatoire)
  const waterId = md.blocksByName.water?.id
  const water = waterId ? bot.findBlock({ matching: waterId, maxDistance: 16 }) : null

  // Créer la houe si besoin
  if (countItem(bot, 'wooden_hoe') === 0 && countItem(bot, 'stone_hoe') === 0 && countItem(bot, 'iron_hoe') === 0) {
    await craftItem(bot, 'wooden_hoe', 1)
  }
  const hoe = bot.inventory.items().find(i => i.name.endsWith('_hoe'))
  if (!hoe) throw new Error('pas de houe pour le farm')

  // Graines
  if (countItem(bot, 'wheat_seeds') === 0 && countItem(bot, 'carrot') === 0 && countItem(bot, 'potato') === 0) {
    log("🌾 Pas de graines — récolte d'herbe d'abord")
    const { collectBlocks } = require('./utils')
    await collectBlocks(bot, ['short_grass', 'tall_grass', 'fern'], 16, { maxDistance: 48, maxMinutes: 2 })
  }

  let planted = 0
  for (let dx = 0; dx < size; dx++) {
    for (let dz = 0; dz < size; dz++) {
      // Un bloc sur deux = chemin, l'autre = culture (style ferme réelle)
      if ((dx + dz) % 2 === 1) continue
      const p = new Vec3(base.x + dx - Math.floor(size/2), base.y, base.z + dz - Math.floor(size/2))
      const ground = bot.blockAt(p.offset(0, -1, 0))
      const above = bot.blockAt(p)
      if (!ground || !above) continue
      if (!['dirt', 'grass_block'].includes(ground.name) || above.name !== 'air') continue
      try {
        await goTo(bot, new GoalNear(p.x, p.y, p.z, 2), { timeout: 10000, retries: 0 })
        await equipSafe(bot, hoe, 'hand')
        await actBlock(bot, ground) // labourer
        await sleep(200)
        const farmland = bot.blockAt(p.offset(0, -1, 0))
        if (!farmland || !farmland.name.includes('farmland')) continue
        // Semer
        const seed = bot.inventory.items().find(i => ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'].includes(i.name))
        if (seed) {
          await equipSafe(bot, seed, 'hand')
          await actBlock(bot, farmland)
          planted++
          await sleep(150)
        }
      } catch (e) {}
    }
  }
  log('🌾 Farm installé : ' + planted + ' plants')
  chat(bot, 'built', { x: base.x, y: base.y, z: base.z }) // réutilise catégorie built
  return planted
}

// Récolte les cultures mûres autour du bot
async function harvestFarm (bot, radius = 8) {
  const md = mcData(bot)
  const crops = ['wheat', 'carrots', 'potatoes', 'beetroot']
  const ids = crops.map(c => md.blocksByName[c]?.id).filter(Boolean)
  if (!ids.length) return 0
  const spots = bot.findBlocks({ matching: ids, maxDistance: radius, count: 32 })
  let harvested = 0
  for (const s of spots) {
    const b = bot.blockAt(s)
    if (!b) continue
    const maxAge = { wheat: '7', carrots: '7', potatoes: '7', beetroot: '3' }[b.name]
    if ((b.properties?.age ?? maxAge) !== maxAge) continue // pas encore mûr
    try {
      await goTo(bot, new GoalNear(s.x, s.y, s.z, 2), { timeout: 8000, retries: 0 })
      const { digBlock } = require('./utils')
      await digBlock(bot, b, 3000)
      harvested++
      await collectNearbyItems(bot, 6, 3000)
    } catch (e) {}
  }
  return harvested
}

// Boucle de farm : toutes les 60s, récolter ce qui est mûr
let _farmTimer = null
function startAutoFarm (bot, intervalMs = 60000) {
  if (_farmTimer) clearInterval(_farmTimer)
  _farmTimer = setInterval(async () => {
    try {
      // Ne farmer que si on a de la nourriture en stock faible OU toutes les X min
      const h = await harvestFarm(bot, 10)
      if (h > 0) log('🌾 Farm récolté : ' + h + ' cultures')
    } catch (e) {}
  }, intervalMs)
  // attacher AUSSI au bot : index.js nettoie bot._farmTimer à la déconnexion —
  // avant, le timer restait en variable module et « tournait » sur un bot mort
  try { bot._farmTimer = _farmTimer } catch {}
  log('🌾 Auto-farm actif (récolte toutes les ' + intervalMs / 1000 + 's)')
  return _farmTimer
}

module.exports = { setupFarm, harvestFarm, startAutoFarm }
