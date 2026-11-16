// ============================================================
// LibreBot — src/skills.js
// Compétences des ateliers de succès : agriculture, élevage,
// sommeil, pêche, commerce, golem, biomes, Nether, etc.
// ============================================================
const {
  Vec3, log, say, sleep, withTimeout, mcData, countItem, equipName, equipShield,
  goTo, GoalNear, GoalXZ, GoalY, GoalBlock, explore, enterDimension,
  collectBlocks, collectNearbyItems, craftItem, smeltItem, eatUntil,
  huntMob, equipBestSword, placeBlockFromInventory, findSolidNeighbor,
  pillarUp, digStaircase, ascendTo, shootWithBow, isNight
} = require('./utils')
const { saveProgress } = require('./storage')

// ---------- Nourriture ciblée ----------

async function eatItem (bot, name, count = 1) {
  for (let i = 0; i < count; i++) {
    if (countItem(bot, name) === 0) return false
    const item = bot.inventory.items().find((it) => it.name === name)
    await bot.equip(item, 'hand')
    await sleep(150)
    await bot.activateItem()
    await sleep(1800)
    try { bot.deactivateItem() } catch {}
    await sleep(200)
  }
  return true
}

// ---------- Laine, lit, sommeil ----------

async function shearSheepForWool (bot, count = 3) {
  await craftItem(bot, 'shears', 1)
  for (let attempt = 0; attempt < 10 && countItem(bot, 'white_wool') < count; attempt++) {
    const sheep = bot.nearestEntity((e) => (e.name === 'sheep') && e.position.distanceTo(bot.entity.position) < 48)
    if (!sheep) { await explore(bot, 60); continue }
    try {
      await goTo(bot, new GoalNear(sheep.position.x, sheep.position.y, sheep.position.z, 2), { timeout: 20000, retries: 0 })
      await equipName(bot, 'shears', 'hand')
      await bot.useOn(sheep)
      await sleep(600)
      await collectNearbyItems(bot, 8, 8000)
    } catch (e) { await sleep(1000) }
  }
  return countItem(bot, 'white_wool') >= count
}

async function sleepInBed (bot) {
  say(bot, '🛏️ Je me fabrique un lit et je dors')
  if (countItem(bot, 'white_wool') < 3) await shearSheepForWool(bot, 3)
  if (countItem(bot, 'white_wool') < 3) throw new Error('pas de laine pour le lit')
  await craftItem(bot, 'white_bed', 1)
  const bed = await placeBlockFromInventory(bot, 'white_bed')
  if (!bed) throw new Error('impossible de poser le lit')
  let waited = 0
  while (!isNight(bot) && waited < 10 * 60000) { await sleep(5000); waited += 5000 }
  try {
    await withTimeout(bot.sleep(bed), 20000)
    await sleep(3000)
    try { await bot.wake() } catch {}
    return true
  } catch (e) {
    log(`dodo raté : ${e.message}`)
    return false
  }
}

// ---------- Agriculture & élevage ----------

async function farmWheat (bot) {
  say(bot, '🌾 Je laboure et je sème du blé')
  await craftItem(bot, 'wooden_hoe', 1)
  let attempts = 0
  while (countItem(bot, 'wheat_seeds') < 4 && attempts++ < 8) {
    const got = await collectBlocks(bot, ['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern'], 16, { maxDistance: 64, maxMinutes: 2 })
    if (got === 0) await explore(bot, 40)
  }
  if (countItem(bot, 'wheat_seeds') === 0) throw new Error('pas de graines')
  let planted = 0
  const base = bot.entity.position.floored()
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
    const p = new Vec3(base.x + dx, base.y, base.z + dz)
    const block = bot.blockAt(p.offset(0, -1, 0))
    const above = bot.blockAt(p)
    if (!block || !above) continue
    if (['dirt', 'grass_block'].includes(block.name) && above.name === 'air') {
      try {
        await equipName(bot, 'wooden_hoe', 'hand')
        await bot.activateBlock(block)
        const farmland = bot.blockAt(p.offset(0, -1, 0))
        if (farmland && farmland.name.includes('farmland')) {
          const seed = bot.inventory.items().find((i) => i.name === 'wheat_seeds')
          if (seed) {
            await bot.equip(seed, 'hand')
            await bot.activateBlock(farmland)
            planted++
            await sleep(300)
          }
        }
      } catch (e) { /* continuer */ }
    }
  }
  return planted
}

async function growWithBonemeal (bot, minutes = 4) {
  const md = mcData(bot)
  const wheatId = md.blocksByName.wheat?.id
  const t0 = Date.now()
  while (Date.now() - t0 < minutes * 60000) {
    const crops = bot.findBlocks({ matching: wheatId, maxDistance: 24, count: 8 })
    for (const c of crops) {
      const b = bot.blockAt(c)
      if (!b || (b.properties?.age ?? '7') === '7') continue
      if (countItem(bot, 'bone_meal') === 0 && countItem(bot, 'bone') > 0) {
        try { await craftItem(bot, 'bone_meal', 3) } catch (e) {}
      }
      if (countItem(bot, 'bone_meal') === 0) break
      try {
        await equipName(bot, 'bone_meal', 'hand')
        await bot.activateBlock(b)
        await sleep(400)
      } catch (e) {}
    }
    const mature = bot.findBlocks({ matching: wheatId, maxDistance: 24, count: 4 })
      .map((p) => bot.blockAt(p))
      .filter((b) => b && (b.properties?.age ?? '7') === '7')
    if (mature.length >= 2) {
      await collectBlocks(bot, ['wheat'], 4, { maxDistance: 24, maxMinutes: 1 })
      return countItem(bot, 'wheat') >= 2
    }
    await sleep(3000)
  }
  return countItem(bot, 'wheat') >= 2
}

async function breedPair (bot, mobName, foodName) {
  const find = () => bot.nearestEntity((e) => e.name === mobName && e.position.distanceTo(bot.entity.position) < 48)
  let a = find()
  if (!a) { await explore(bot, 80); a = find() }
  if (!a) throw new Error(`pas de ${mobName} à portée`)
  if (countItem(bot, foodName) < 2) throw new Error(`pas assez de ${foodName}`)
  const second = find()
  for (const target of [a, second].filter(Boolean).slice(0, 2)) {
    try {
      await goTo(bot, new GoalNear(target.position.x, target.position.y, target.position.z, 2), { timeout: 20000, retries: 0 })
      await equipName(bot, foodName, 'hand')
      await bot.useOn(target)
      await sleep(800)
    } catch (e) {}
  }
  return true
}

// ---------- Apprivoisement & pêche ----------

async function tameHorse (bot) {
  say(bot, '🐴 J\'essaie d\'apprivoiser un cheval')
  for (let attempt = 0; attempt < 8; attempt++) {
    const horse = bot.nearestEntity((e) => ['horse', 'donkey'].includes(e.name) && e.position.distanceTo(bot.entity.position) < 64)
    if (!horse) { await explore(bot, 100); continue }
    for (let tries = 0; tries < 8; tries++) {
      try {
        await goTo(bot, new GoalNear(horse.position.x, horse.position.y, horse.position.z, 1), { timeout: 20000, retries: 0 })
        await bot.mount(horse)
        await sleep(1500)
        try { await bot.dismount() } catch {}
        await sleep(600)
      } catch (e) { await sleep(600) }
    }
    try {
      await bot.mount(horse)
      await sleep(1000)
      await bot.dismount()
      return true // si pas éjecté → apprivoisé
    } catch (e) {
      await sleep(500)
    }
  }
  return false
}

const FISH_NAMES = ['cod', 'salmon', 'pufferfish', 'tropical_fish']

async function tryFish (bot, attempts = 5) {
  say(bot, '🎣 Pêche à la ligne')
  if (countItem(bot, 'fishing_rod') === 0) {
    await huntMob(bot, ['spider'], { until: () => countItem(bot, 'string') >= 3, maxMinutes: 6 })
    await craftItem(bot, 'fishing_rod', 1)
  }
  if (countItem(bot, 'fishing_rod') === 0) throw new Error('pas de canne à pêche')
  const md = mcData(bot)
  const water = bot.findBlock({ matching: md.blocksByName.water?.id, maxDistance: 64 })
  if (!water) throw new Error('pas d\'eau à portée')
  await goTo(bot, new GoalNear(water.position.x, water.position.y + 1, water.position.z, 2), { timeout: 30000, retries: 0 })
  for (let i = 0; i < attempts; i++) {
    await equipName(bot, 'fishing_rod', 'hand')
    await bot.lookAt(water.position.offset(0, 1, 0))
    await sleep(300)
    await bot.activateItem()
    await sleep(8000 + Math.random() * 12000) // attendre une touche
    try { bot.deactivateItem() } catch {}
    await sleep(800)
    if (FISH_NAMES.some((f) => countItem(bot, f) > 0)) return true
  }
  return FISH_NAMES.some((f) => countItem(bot, f) > 0)
}

// ---------- Village & commerce ----------

async function findVillage (bot, maxMinutes = 12) {
  const md = mcData(bot)
  const t0 = Date.now()
  while (Date.now() - t0 < maxMinutes * 60000) {
    const villager = bot.nearestEntity((e) => e.name === 'villager' && e.position.distanceTo(bot.entity.position) < 96)
    if (villager) return villager
    const bell = bot.findBlock({ matching: md.blocksByName.bell?.id, maxDistance: 128 })
    if (bell) {
      await goTo(bot, new GoalNear(bell.position.x, bell.position.y, bell.position.z, 4), { timeout: 60000, retries: 0 })
      continue
    }
    await explore(bot, 150)
  }
  return null
}

async function tryTrade (bot, villager) {
  say(bot, '💰 Je tente un échange avec un villageois')
  try {
    await goTo(bot, new GoalNear(villager.position.x, villager.position.y, villager.position.z, 2), { timeout: 20000, retries: 0 })
    const v = await bot.openVillager(villager)
    try {
      // vendre du blé (les fermiers l'achètent) — n'importe quel échange valide fait l'affaire
      const trades = v.trades ?? []
      log(`${trades.length} échanges visibles`)
      for (let i = 0; i < trades.length; i++) {
        try {
          await v.tradeSelect(i)
          await sleep(800)
          return true
        } catch (e) { /* essayer l'échange suivant */ }
      }
      return false
    } finally {
      try { v.close() } catch {}
    }
  } catch (e) {
    log(`échange raté : ${e.message}`)
    return false
  }
}

async function buildIronGolem (bot) {
  say(bot, '🗿 Je tente un golem de fer (Hired Help)')
  // 3 blocs de fer (27 lingots) + citrouille sculptée
  if (countItem(bot, 'iron_ingot') < 27) {
    await digStaircase(bot, 16)
    const { branchMine } = require('./utils')
    await branchMine(bot, { y: 16, need: () => countItem(bot, 'raw_iron') >= 30, ores: ['iron_ore', 'deepslate_iron_ore'], extraOres: [], maxMinutes: 20 })
    await smeltItem(bot, 'raw_iron', 'iron_ingot', 30)
    await ascendTo(bot, 68)
  }
  await craftItem(bot, 'iron_block', 3)
  // trouver une citrouille
  let pumpkin = bot.findBlock({ matching: mcData(bot).blocksByName.pumpkin?.id, maxDistance: 96 })
  if (!pumpkin) { await explore(bot, 120); pumpkin = bot.findBlock({ matching: mcData(bot).blocksByName.pumpkin?.id, maxDistance: 96 }) }
  if (!pumpkin) throw new Error('pas de citrouille pour le golem')
  await collectBlocks(bot, ['pumpkin'], 1, { maxDistance: 96, maxMinutes: 2 })
  // sculpter la citrouille avec des cisailles
  const p = await placeBlockFromInventory(bot, 'pumpkin')
  await equipName(bot, 'shears', 'hand')
  await bot.activateBlock(p)
  await sleep(400)
  // T du golem
  const anchor = bot.entity.position.floored().offset(2, 0, 0)
  const plan = [anchor, anchor.offset(0, 1, 0), anchor.offset(1, 1, 0), anchor.offset(-1, 1, 0), anchor.offset(0, 2, 0)]
  for (const pos of plan) {
    const ref = findSolidNeighbor(bot, pos)
    if (!ref) continue
    try {
      await goTo(bot, new GoalNear(ref.position.x, ref.position.y, ref.position.z, 1), { timeout: 20000, retries: 0 })
      await equipName(bot, pos.y === anchor.y + 2 ? 'carved_pumpkin' : 'iron_block', 'hand')
      await bot.placeBlock(ref, pos.minus(ref.position))
      await sleep(300)
    } catch (e) { log(`pose golem ratée : ${e.message}`) }
  }
  return true
}

// ---------- Seau de lave, cuivre, cibles, arc ----------

async function fillLavaBucket (bot) {
  say(bot, '🌋 Je remplis un seau de lave (Hot Stuff)')
  if (countItem(bot, 'bucket') === 0) await craftItem(bot, 'bucket', 1)
  const md = mcData(bot)
  let lava = null
  for (let d of [64, 128]) {
    lava = bot.findBlock({ matching: md.blocksByName.lava?.id, maxDistance: d })
    if (lava) break
  }
  if (!lava) { await digStaircase(bot, -30); lava = bot.findBlock({ matching: md.blocksByName.lava?.id, maxDistance: 64 }) }
  if (!lava) throw new Error('pas de lave à portée')
  await goTo(bot, new GoalNear(lava.position.x, lava.position.y + 1, lava.position.z, 1), { timeout: 30000, retries: 0 })
  await equipName(bot, 'bucket', 'hand')
  await bot.lookAt(lava.position.offset(0.5, 0.5, 0.5))
  await bot.activateItem()
  await sleep(500)
  if (countItem(bot, 'lava_bucket') > 0) return true
  throw new Error('remplissage raté')
}

async function copperBulbWorkshop (bot) {
  say(bot, '💡 Ampoule en cuivre (Lighten Up)')
  // 27 cuivres -> 3 blocs ; ampoule = 3 blocs de cuivre + tige de blaze + redstone
  const { branchMine } = require('./utils')
  await digStaircase(bot, 40)
  await branchMine(bot, { y: 40, need: () => countItem(bot, 'raw_copper') >= 27, ores: ['copper_ore', 'deepslate_copper_ore'], extraOres: [], maxMinutes: 15 })
  await smeltItem(bot, 'raw_copper', 'copper_ingot', 27)
  await ascendTo(bot, 68)
  await craftItem(bot, 'copper_block', 3)
  await craftItem(bot, 'copper_bulb', 1)
  const bulb = await placeBlockFromInventory(bot, 'copper_bulb')
  await equipName(bot, 'iron_axe', 'hand')
  await bot.activateBlock(bulb)
  await sleep(400)
  return true
}

async function targetBlockShoot (bot) {
  say(bot, '🎯 Bloc cible à 30 m (Bullseye)')
  await craftItem(bot, 'target', 1) // 4 redstone + bloc de paille... hay: blé !
  if (countItem(bot, 'hay_block') === 0) {
    await craftItem(bot, 'hay_block', 1) // 9 blés
  }
  const target = await placeBlockFromInventory(bot, 'target')
  // reculer de 32 blocs et tirer
  const dir = new Vec3(32, 0, 0)
  await goTo(bot, new GoalNear(target.position.x + 32, target.position.y, target.position.z, 1), { timeout: 60000, retries: 0 })
  for (let i = 0; i < 5; i++) {
    if (countItem(bot, 'arrow') === 0) throw new Error('plus de flèches')
    await equipName(bot, 'bow', 'hand')
    // viser au-dessus de la cible pour compenser la gravité
    await bot.lookAt(target.position.offset(0.5, 1.2 + i * 0.15, 0.5))
    await sleep(300)
    await bot.activateItem()
    await sleep(1100)
    try { bot.deactivateItem() } catch {}
    await sleep(1000)
  }
  return true
}

async function crossbowShot (bot) {
  say(bot, '🏹 Arbalète (Ol\' Betsy)')
  await craftItem(bot, 'crossbow', 1) // 3 bâtons + 2 cordes + 1 lingot de fer + 1 planche de chêne
  if (countItem(bot, 'string') < 1) {
    await huntMob(bot, ['spider'], { until: () => countItem(bot, 'string') >= 1, maxMinutes: 4 })
    await craftItem(bot, 'crossbow', 1)
  }
  await equipName(bot, 'crossbow', 'hand')
  // charger : clic maintenu
  await bot.activateItem()
  await sleep(1400)
  try { bot.deactivateItem() } catch {}
  await sleep(500)
  // tirer
  await bot.look(bot.entity.yaw, 0.3)
  await bot.activateItem()
  await sleep(500)
  return true
}

async function enchantAttempt (bot) {
  say(bot, '✨ Table d\'enchantement (Enchanter)')
  // 4 obsidiennes + 2 diamants + 1 livre (cuir + papiers -> paille)
  if (countItem(bot, 'obsidian') < 4) throw new Error('pas assez d\'obsidienne')
  await craftItem(bot, 'book', 1) // cuir de vache + 3 papiers
  await craftItem(bot, 'enchanting_table', 1)
  if (countItem(bot, 'lapis_lazuli') < 9) {
    // le lapis ne se crafte pas : il faut miner le minerai
    const { branchMine } = require('./utils')
    await digStaircase(bot, 16)
    await branchMine(bot, { y: 16, need: () => countItem(bot, 'lapis_lazuli') >= 9, ores: ['lapis_ore', 'deepslate_lapis_ore'], extraOres: [], maxMinutes: 10 })
    await ascendTo(bot, 68)
  }
  const table = await placeBlockFromInventory(bot, 'enchanting_table')
  if (!table) return false
  // ouvrir et tenter un enchantement
  try {
    const et = await bot.openEnchantmentTable(table)
    try {
      // choisir une arme à enchanter
      await equipName(bot, 'diamond_sword', 'hand')
      const options = et.enchantOptions ?? et.enchantments ?? []
      log(`${options.length} options d'enchantement`)
      if (options.length > 0) {
        await withTimeout(et.enchant(options.length - 1), 10000)
        await sleep(1500)
        return true
      }
      return false
    } finally {
      try { et.close() } catch {}
    }
  } catch (e) {
    log(`enchantement raté : ${e.message}`)
    return false
  }
}

// ---------- Biomes & Nether ----------

const NETHER_BIOME_MARKERS = [
  { biome: 'nether_wastes', blocks: ['netherrack'] },
  { biome: 'crimson_forest', blocks: ['crimson_nylium', 'crimson_fungus'] },
  { biome: 'warped_forest', blocks: ['warped_nylium', 'warped_fungus'] },
  { biome: 'soul_sand_valley', blocks: ['soul_sand', 'soul_soil'] },
  { biome: 'basalt_deltas', blocks: ['basalt', 'blackstone'] }
]

async function exploreNetherBiomes (bot, progress, maxMinutes = 25) {
  const md = mcData(bot)
  const visited = progress.netherBiomes ?? []
  const t0 = Date.now()
  let lastMove = 0
  while (Date.now() - t0 < maxMinutes * 60000) {
    // scanner les blocs marqueurs autour
    for (const marker of NETHER_BIOME_MARKERS) {
      if (visited.includes(marker.biome)) continue
      const ids = marker.blocks.map((b) => md.blocksByName[b]?.id).filter(Boolean)
      const found = bot.findBlocks({ matching: ids, maxDistance: 96, count: 1 })
      if (found.length) {
        visited.push(marker.biome)
        progress.netherBiomes = visited
        say(bot, `🗺️ Biome du Nether visité : ${marker.biome} (${visited.length}/5)`)
        await saveProgress(progress)
      }
    }
    if (visited.length >= 5) return true
    if (Date.now() - lastMove > 30000) {
      lastMove = Date.now()
      await explore(bot, 180)
    }
    await sleep(2000)
  }
  return visited.length >= 5
}

async function goldToPiglin (bot) {
  say(bot, '🐷 De l\'or aux piglins (Oh Shiny + troc)')
  if (countItem(bot, 'gold_ingot') === 0) {
    const { branchMine } = require('./utils')
    await branchMine(bot, { y: 100, need: () => countItem(bot, 'gold_ingot') >= 8, ores: ['nether_gold_ore', 'gold_ore', 'deepslate_gold_ore'], extraOres: [], maxMinutes: 10 })
    await smeltItem(bot, 'raw_gold', 'gold_ingot', 8)
  }
  const piglin = bot.nearestEntity((e) => e.name === 'piglin' && e.position.distanceTo(bot.entity.position) < 32)
  if (!piglin) throw new Error('pas de piglin à portée')
  // jeter des lingots d'or au sol près du piglin (troc)
  for (let i = 0; i < 6; i++) {
    const gold = bot.inventory.items().find((it) => it.name === 'gold_ingot')
    if (!gold) break
    await goTo(bot, new GoalNear(piglin.position.x, piglin.position.y, piglin.position.z, 2), { timeout: 15000, retries: 0 })
    try {
      await bot.tossStack(gold)
      await sleep(6000) // le piglin ramasse, regarde, puis jette le troc
      await collectNearbyItems(bot, 10, 8000)
    } catch (e) {}
    if (countItem(bot, 'crying_obsidian') > 0 || countItem(bot, 'obsidian_crying') > 0) break
  }
  return true
}

async function huntGhastsForTears (bot, tearsNeeded = 4, maxMinutes = 15) {
  say(bot, '👻 Chasse aux ghasts (larmes pour les cristaux de l\'End)')
  return huntMob(bot, ['ghast'], {
    until: () => countItem(bot, 'ghast_tear') >= tearsNeeded,
    maxMinutes
  })
}

async function mineAncientDebris (bot, need = 4) {
  say(bot, '⛏️ Minerai antique à Y=15 (Hidden in the Depths)')
  const { branchMine } = require('./utils')
  // descendre à Y=15 dans le Nether (méthode des escaliers)
  await digStaircase(bot, 15)
  return branchMine(bot, {
    y: 15,
    need: () => countItem(bot, 'ancient_debris') >= need,
    ores: ['ancient_debris'],
    extraOres: ['nether_gold_ore', 'gold_ore'],
    maxMinutes: 25
  })
}

// ---------- End ----------

async function throwPearlAt (bot, targetPos) {
  await goTo(bot, new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3), { timeout: 60000, retries: 0 })
  await equipName(bot, 'ender_pearl', 'hand')
  await bot.lookAt(targetPos.offset(0.5, 1, 0.5))
  await sleep(300)
  await bot.activateItem()
  await sleep(3000)
  return true
}

// monter en tour (wrapper sûr utilisé par l'atelier chute libre)
async function pillarUpSafe (bot, targetY, blockName) {
  return pillarUp(bot, targetY, blockName)
}

module.exports = {
  eatItem, shearSheepForWool, isNight, sleepInBed,
  farmWheat, growWithBonemeal, breedPair,
  tameHorse, tryFish, FISH_NAMES,
  findVillage, tryTrade, buildIronGolem,
  fillLavaBucket, copperBulbWorkshop, targetBlockShoot, crossbowShot, enchantAttempt,
  exploreNetherBiomes, goldToPiglin, huntGhastsForTears, mineAncientDebris,
  throwPearlAt, pillarUpSafe
}
