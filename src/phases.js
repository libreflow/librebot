// ============================================================
// LibreBot — src/phases.js
// Les 13 phases de la mission : du premier arbre au dragon.
// ============================================================
const {
  Vec3, log, say, sleep, withTimeout, mcData, countItem, equipName, equipShield,
  equipBestSword, pillarUp,
  goTo, GoalNear, GoalXZ, GoalY, GoalBlock, explore, enterDimension,
  collectBlocks, collectNearbyItems, craftItem, craftAnyPlanks, smeltItem,
  eatUntil, huntMob, shootWithBow, placeBlockFromInventory,
  digStaircase, ascendTo, branchMine, getWaterBucket, makeObsidian,
  digGravelForFlint, trackEyeOfEnder
} = require('./utils')
const { buildHouse, buildNetherPortal } = require('./build')

const md = (bot) => mcData(bot)

// ---------- Phase 1 : bois, outils, nourriture ----------

async function phaseWood (bot, cfg, progress) {
  say(bot, '🪓 Phase 1 : bois et premiers outils')
  const ALL_LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log', 'pale_oak_log']
  let logs = await collectBlocks(bot, ALL_LOGS, 12, { maxDistance: 96, maxMinutes: 6 })
  if (logs === 0) {
    say(bot, "Pas d'arbre à portée, j'explore…")
    for (let i = 0; i < 5; i++) {
      await explore(bot, 80)
      logs = await collectBlocks(bot, ALL_LOGS, 12, { maxDistance: 96, maxMinutes: 6 })
      if (logs > 0) break
    }
    if (logs === 0) throw new Error('aucun arbre trouvé (désert ?) — déplace le bot vers une forêt')
  }
  await craftAnyPlanks(bot, 40)
  await craftItem(bot, 'crafting_table', 2)
  await craftItem(bot, 'stick', 12)
  await craftItem(bot, 'wooden_pickaxe', 1)
  await craftItem(bot, 'wooden_axe', 1)
  await craftItem(bot, 'wooden_sword', 1)
  // nourriture et plumes (pour les flèches plus tard)
  await huntMob(bot, ['cow', 'pig', 'sheep', 'chicken'], {
    until: () => bot.food >= 16 || ['beef', 'porkchop', 'mutton', 'chicken'].some((f) => countItem(bot, f) >= 6),
    maxMinutes: 4
  })
  await huntMob(bot, ['chicken'], {
    until: () => countItem(bot, 'feather') >= 10,
    maxMinutes: 6
  })
  await eatUntil(bot)
}

// ---------- Phase 2 : pierre ----------

async function phaseStone (bot, cfg, progress) {
  say(bot, '🪨 Phase 2 : outils en pierre')
  await collectBlocks(bot, ['stone', 'cobblestone'], 64, { maxDistance: 96, maxMinutes: 8 })
  await craftItem(bot, 'stone_pickaxe', 1)
  await craftItem(bot, 'stone_axe', 1)
  await craftItem(bot, 'stone_sword', 1)
  await craftItem(bot, 'stone_shovel', 1)
  await craftItem(bot, 'furnace', 2)
  await eatUntil(bot, 15)
}

// ---------- Phase 3 : fer ----------

async function phaseIron (bot, cfg, progress) {
  say(bot, '⛏️ Phase 3 : le fer (descente vers Y=16)')
  await getWaterBucket(bot) // seau d'eau gardé pour l'obsidienne
  await digStaircase(bot, 16)
  const ok = await branchMine(bot, {
    y: 16,
    need: () => countItem(bot, 'raw_iron') >= cfg.targets.rawIron,
    ores: ['iron_ore', 'deepslate_iron_ore'],
    extraOres: ['coal_ore', 'deepslate_coal_ore'],
    maxMinutes: 25
  })
  if (!ok) throw new Error('pas assez de fer trouvé')
  say(bot, '🔥 Fonte du fer…')
  await smeltItem(bot, 'raw_iron', 'iron_ingot', cfg.targets.rawIron)
  // équipement complet en fer
  for (const piece of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
    await craftItem(bot, piece, 1)
  }
  await craftItem(bot, 'iron_sword', 1)
  await craftItem(bot, 'iron_pickaxe', 1)
  await craftItem(bot, 'iron_shovel', 1)
  await craftItem(bot, 'iron_axe', 1)
  await craftItem(bot, 'shield', 1)
  await craftItem(bot, 'bucket', 2)
  await digGravelForFlint(bot, 10)
  await craftItem(bot, 'flint_and_steel', 1)
  await craftItem(bot, 'arrow', 32) // silex + bâton + plume
  await craftItem(bot, 'torch', 32)
  await eatUntil(bot, 18)
}

// ---------- Phase 4 : diamants ----------

async function phaseDiamond (bot, cfg, progress) {
  say(bot, '💎 Phase 4 : les diamants (descente vers Y=-58)')
  await digStaircase(bot, -58)
  const ok = await branchMine(bot, {
    y: -58,
    need: () => countItem(bot, 'diamond') >= cfg.targets.diamonds,
    ores: ['diamond_ore', 'deepslate_diamond_ore'],
    extraOres: ['coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore'],
    maxMinutes: 45
  })
  if (!ok) throw new Error('pas assez de diamants trouvés (mauvaise chance…)')
  for (const piece of ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots']) {
    await craftItem(bot, piece, 1)
  }
  await craftItem(bot, 'diamond_sword', 1)
  await craftItem(bot, 'diamond_pickaxe', 1)
  await equipShield(bot)
  await eatUntil(bot, 18)
}

// ---------- Phase 5 : obsidienne ----------

async function phaseObsidian (bot, cfg, progress) {
  say(bot, '🟪 Phase 5 : obsidienne (eau + lave)')
  if (countItem(bot, 'obsidian') < cfg.targets.obsidian) {
    await makeObsidian(bot, cfg.targets.obsidian)
  }
  say(bot, `✓ ${countItem(bot, 'obsidian')} obsidiennes en stock`)
}

// ---------- Phase 6 : construction de la base ----------

async function phaseBase (bot, cfg, progress) {
  say(bot, '🏠 Phase 6 : construction de la base')
  await ascendTo(bot, 68)
  await buildHouse(bot)
  // stocker quelques coordonnées utiles
  progress.home = [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z]
  await eatUntil(bot, 18)
}

// ---------- Phase 7 : portail du Nether ----------

async function phaseNether (bot, cfg, progress) {
  say(bot, '🔥 Phase 7 : portail du Nether')
  if (countItem(bot, 'obsidian') < 14) {
    await makeObsidian(bot, 14)
  }
  if (countItem(bot, 'flint_and_steel') === 0) {
    await digGravelForFlint(bot, 1)
    await craftItem(bot, 'flint_and_steel', 1)
  }
  await ascendTo(bot, 68)
  const portalPos = await buildNetherPortal(bot)
  progress.netherPortal = [portalPos.x, portalPos.y, portalPos.z]
  // entrer dans le portail
  await goTo(bot, new GoalNear(portalPos.x, portalPos.y, portalPos.z, 0), { timeout: 30000, retries: 1 })
  const inNether = await enterDimension(bot, 'the_nether', 45000)
  if (!inNether) throw new Error('je n\'arrive pas à traverser le portail')
  say(bot, '🌋 Bienvenue au Nether !')
  await equipShield(bot)
}

// ---------- Phase 8 : recherche de la forteresse ----------

async function phaseFortress (bot, cfg, progress) {
  say(bot, '🏰 Phase 8 : recherche de la forteresse')
  const bricksId = md(bot).blocksByName.nether_bricks?.id
  let fortress = null
  for (let i = 0; i < 40 && !fortress; i++) {
    const spots = bot.findBlocks({ matching: bricksId, maxDistance: 128, count: 8 })
    if (spots.length) fortress = spots[0]
    else {
      const { x, z } = bot.entity.position
      await goTo(bot, new GoalXZ(x + (Math.random() * 2 - 1) * 150, z + (Math.random() * 2 - 1) * 150), { timeout: 90000, retries: 0 })
    }
    if (bot.health < 14) await eatUntil(bot)
  }
  if (!fortress) throw new Error('forteresse introuvable dans cette zone — relancer la phase')
  say(bot, `🏰 Forteresse repérée en (${fortress.x}, ${fortress.y}, ${fortress.z})`)
  await goTo(bot, new GoalNear(fortress.x, fortress.y, fortress.z, 2), { timeout: 120000, retries: 1 })
  progress.fortress = [fortress.x, fortress.y, fortress.z]
}

// ---------- Phase 9 : chasse aux blazes ----------

async function phaseBlaze (bot, cfg, progress) {
  say(bot, '🔥 Phase 9 : chasse aux blazes')
  // se rapprocher d'un spawner (les blazes apparaissent dessus)
  const spawnerId = md(bot).blocksByName.spawner?.id
  let spawner = bot.findBlock({ matching: spawnerId, maxDistance: 64 })
  if (spawner) {
    await goTo(bot, new GoalNear(spawner.position.x, spawner.position.y, spawner.position.z, 3), { timeout: 60000, retries: 0 })
  }
  const ok = await huntMob(bot, ['blaze'], {
    until: () => countItem(bot, 'blaze_rod') >= cfg.targets.blazeRods,
    maxMinutes: 18
  })
  if (!ok) throw new Error(`seulement ${countItem(bot, 'blaze_rod')} bâtons de blaze`)
  say(bot, `✓ ${countItem(bot, 'blaze_rod')} bâtons de blaze`)
}

// ---------- Phase 10 : retour et chasse aux endermen ----------

async function phasePearls (bot, cfg, progress) {
  say(bot, '🟣 Phase 10 : retour à la surface, chasse aux endermen')
  // repasser le portail vers l'overworld
  const portal = progress.netherPortal
  if (!portal) throw new Error('position du portail perdue')
  const spots = bot.findBlocks({ matching: md(bot).blocksByName.nether_portal?.id, maxDistance: 128, count: 4 })
  const target = spots[0] ?? new Vec3(portal[0], portal[1], portal[2])
  await goTo(bot, new GoalNear(target.x, target.y, target.z, 0), { timeout: 180000, retries: 2 })
  const back = await enterDimension(bot, 'overworld', 45000)
  if (!back) throw new Error('retour impossible dans l\'overworld')
  say(bot, '🌍 De retour à la surface !')
  await ascendTo(bot, 68)
  const ok = await huntMob(bot, ['enderman'], {
    until: () => countItem(bot, 'ender_pearl') >= cfg.targets.enderPearls,
    maxMinutes: 45
  })
  if (!ok) say(bot, `⚠️ Seulement ${countItem(bot, 'ender_pearl')} perles… on continue avec ce qu'on a`)
  await eatUntil(bot, 18)
}

// ---------- Phase 11 : yeux de l'Ender ----------

async function phaseEyes (bot, cfg, progress) {
  say(bot, '👁️ Phase 11 : fabrication des yeux de l\'Ender')
  await craftItem(bot, 'blaze_powder', Math.ceil(cfg.targets.enderEyes / 1) + 2)
  const pearls = countItem(bot, 'ender_pearl')
  const powder = countItem(bot, 'blaze_powder')
  const eyes = Math.min(cfg.targets.enderEyes, pearls, powder)
  if (eyes < 10) throw new Error(`matériel insuffisant : ${pearls} perles / ${powder} poudres`)
  await craftItem(bot, 'ender_eye', eyes)
  say(bot, `✓ ${countItem(bot, 'ender_eye')} yeux de l'Ender`)
}

// ---------- Phase 12 : recherche du stronghold + portail de l'End ----------

const BRICK_NAMES = ['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'infested_stone_bricks',
  'infested_mossy_stone_bricks', 'infested_cracked_stone_bricks', 'chiseled_stone_bricks']

async function seekStronghold (bot, progress) {
  // lancers d'œil itératifs : suivre l'œil jusqu'à ce qu'il retombe sur place
  let est = progress.strongholdXZ ?? null
  for (let t = 0; t < 30; t++) {
    const eye = bot.inventory.items().find((i) => i.name === 'ender_eye')
    if (!eye) throw new Error('plus d\'yeux de l\'Ender pour chercher le stronghold')
    await bot.equip(eye, 'hand')
    if (est) {
      // regarder vers la dernière estimation avant de lancer
      const dx = est[0] - bot.entity.position.x
      const dz = est[1] - bot.entity.position.z
      const yaw = Math.atan2(-dx, -dz)
      await bot.look(yaw, -0.6)
    } else {
      await bot.look(Math.random() * Math.PI * 2, -0.6)
    }
    await sleep(300)
    await bot.activateItem()
    const end = await trackEyeOfEnder(bot)
    if (!end) {
      say(bot, "📍 L'œil retombe : le stronghold est juste en dessous !")
      progress.strongholdXZ = [bot.entity.position.x, bot.entity.position.z]
      return
    }
    say(bot, `🧭 L'œil vole vers x=${Math.round(end.x)} z=${Math.round(end.z)}`)
    progress.strongholdXZ = [end.x, end.z]
    const arrived = await goTo(bot, new GoalXZ(end.x, end.z), { timeout: 300000, retries: 0 })
    if (arrived) return
  }
  throw new Error('stronghold introuvable après 30 lancers')
}

async function findPortalRoom (bot, progress) {
  const frameId = md(bot).blocksByName.end_portal_frame?.id
  const bricksIds = BRICK_NAMES.map((n) => md(bot).blocksByName[n]?.id).filter(Boolean)
  for (let i = 0; i < 60; i++) {
    const frames = bot.findBlocks({ matching: frameId, maxDistance: 48, count: 12 })
    if (frames.length >= 8) {
      const c = frames[0]
      progress.portalRoom = [c.x, c.y, c.z]
      say(bot, `🚪 Salle du portail trouvée en (${c.x}, ${c.y}, ${c.z})`)
      return
    }
    if (frames.length) {
      await goTo(bot, new GoalNear(frames[0].x, frames[0].y, frames[0].z, 2), { timeout: 60000, retries: 0 })
      continue
    }
    // suivre les briques du stronghold
    const bricks = bot.findBlocks({ matching: bricksIds, maxDistance: 64, count: 4 })
    if (bricks.length) {
      const b = bricks[Math.floor(Math.random() * bricks.length)]
      await goTo(bot, new GoalNear(b.x, b.y, b.z, 2), { timeout: 30000, retries: 0 })
    } else {
      await explore(bot, 24)
    }
    await eatUntil(bot, 15)
    if (bot.health < 12) await sleep(4000)
  }
  throw new Error('salle du portail introuvable — relancer la phase')
}

async function activateEndPortal (bot) {
  const frameId = md(bot).blocksByName.end_portal_frame?.id
  const portalId = md(bot).blocksByName.end_portal?.id
  for (let attempt = 0; attempt < 4; attempt++) {
    const frames = bot.findBlocks({ matching: frameId, maxDistance: 32, count: 16 })
      .map((p) => bot.blockAt(p))
      .filter(Boolean)
    for (const f of frames) {
      const eye = bot.inventory.items().find((i) => i.name === 'ender_eye')
      if (!eye) break
      await bot.equip(eye, 'hand')
      try {
        await bot.lookAt(f.position.offset(0.5, 0.5, 0.5))
        await bot.activateBlock(f)
        await sleep(250)
      } catch (e) { /* cadre peut-être déjà rempli */ }
    }
    const portal = bot.findBlock({ matching: portalId, maxDistance: 24 })
    if (portal) return portal
    await sleep(1500)
  }
  throw new Error('impossible d\'activer le portail de l\'End (yeux insuffisants ?)')
}

async function phaseStronghold (bot, cfg, progress) {
  say(bot, '🎯 Phase 12 : recherche du stronghold')
  await seekStronghold(bot, progress)
  // descendre sous terre
  await digStaircase(bot, 30)
  await findPortalRoom(bot, progress)
  say(bot, '🗝️ J\'active le portail de l\'End…')
  const portal = await activateEndPortal(bot)
  progress.endPortal = [portal.position.x, portal.position.y, portal.position.z]
  // préparer du cobble pour franchir le vide de l'End
  if (countItem(bot, 'cobblestone') < 64) {
    await collectBlocks(bot, ['stone'], 64, { maxDistance: 64, maxMinutes: 6 })
  }
  await eatUntil(bot, 19)
  // traverser le portail
  await goTo(bot, new GoalNear(portal.position.x, portal.position.y, portal.position.z, 0), { timeout: 30000, retries: 1 })
  const inEnd = await enterDimension(bot, 'the_end', 45000)
  if (!inEnd) throw new Error('je n\'arrive pas à entrer dans l\'End')
  say(bot, '🌌 Bienvenue dans l\'End !')
}

// ---------- Phase 13 : cristaux + dragon ----------

function isCaged (bot, pos) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = bot.blockAt(new Vec3(Math.floor(pos.x + dx), Math.floor(pos.y), Math.floor(pos.z + dz)))
    if (b && b.name === 'iron_bars') return true
  }
  return false
}

async function gotoEndIsland (bot) {
  say(bot, '🌉 Je rejoins l\'île principale…')
  await goTo(bot, new GoalXZ(0, 0), { timeout: 240000, retries: 2 })
  await sleep(1000)
}

async function findGroundBelow (bot) {
  const feet = bot.entity.position.floored()
  for (let dy = -1; dy > -150; dy--) {
    const b = bot.blockAt(feet.offset(0, dy, 0))
    if (b && b.boundingBox === 'solid') return feet.y + dy + 1
  }
  return 0
}

// Descendre d'une tour : petite chute, ou saut + seau d'eau (MLG) si haut.
async function safeDescend (bot) {
  const groundY = findGroundBelow(bot)
  const gap = bot.entity.position.y - groundY
  if (gap < 14) {
    bot.setControlState('forward', true)
    await sleep(400)
    bot.setControlState('forward', false)
    await sleep(2000)
    return true
  }
  if (countItem(bot, 'water_bucket') > 0) {
    say(bot, '💧 Saut + seau d\'eau !')
    bot.setControlState('forward', true)
    try { await bot.look(bot.entity.yaw, 1.4) } catch {}
    while (bot.entity.position.y - groundY > 10 && bot.entity.velocity.y < 0) {
      await sleep(40)
    }
    try { await equipName(bot, 'water_bucket', 'hand') } catch {}
    await bot.activateItem()
    await sleep(2500)
    bot.setControlState('forward', false)
    return true
  }
  // pas d'eau : redescendre en construisant un escalier de blocs
  log('descente prudente bloc par bloc (pas de seau d\'eau)')
  while (bot.entity.position.y > groundY + 3) {
    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    const sideBlocks = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => bot.blockAt(feet.offset(dx, -1, dz)))
    const side = sideBlocks.find((b) => b && b.boundingBox === 'solid')
    try {
      const blockName = countItem(bot, 'cobblestone') > 0 ? 'cobblestone' : 'dirt'
      await equipName(bot, blockName, 'hand')
      if (side) await bot.placeBlock(side, new Vec3(0, 0, 0)) // ignoré si invalide
    } catch (e) {}
    bot.setControlState('sneak', true)
    bot.setControlState('forward', true)
    await sleep(350)
    bot.setControlState('forward', false)
    bot.setControlState('sneak', false)
    await sleep(400)
    if (Math.abs(bot.entity.velocity.y) < 0.01 && bot.entity.position.y === feet.y) break // bloqué
  }
  return true
}

async function destroyCagedCrystal (bot, crystal) {
  const cx = Math.floor(crystal.position.x)
  const cz = Math.floor(crystal.position.z)
  const cy = Math.floor(crystal.position.y)
  say(bot, `🧱 Cristal en cage à (${cx}, ${cy}, ${cz}) : j'aménage la tour`)
  // pied de la tour
  await goTo(bot, new GoalXZ(cx + 2, cz + 2), { timeout: 90000, retries: 1 })
  const blockName = countItem(bot, 'cobblestone') > 0 ? 'cobblestone' : 'end_stone'
  // monter en pilier jusqu'au niveau du cristal
  await pillarUp(bot, cy + 1, blockName)
  // casser les barreaux autour du cristal
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const bars = bot.blockAt(new Vec3(cx + dx, cy, cz + dz))
    if (bars && bars.name === 'iron_bars') {
      try { await bot.dig(bars, true) } catch (e) {}
    }
  }
  // casser aussi les barreaux au-dessus si présents
  const top = bot.blockAt(new Vec3(cx, cy + 1, cz))
  if (top && top.name === 'iron_bars') {
    try { await bot.dig(top, true) } catch (e) {}
  }
  // descendre puis détruire le cristal à l'arc
  await safeDescend(bot)
  await sleep(500)
  await shootWithBow(bot, crystal, 5)
}

async function destroyCrystals (bot) {
  const tried = new Set()
  let safety = 0
  while (safety++ < 50) {
    const crystals = Object.values(bot.entities).filter((e) => e.name === 'end_crystal')
    if (!crystals.length) {
      // vérifier qu'il n'y en a vraiment plus
      await sleep(2000)
      const again = Object.values(bot.entities).filter((e) => e.name === 'end_crystal')
      if (!again.length) return
      continue
    }
    const crystal = crystals.find((c) => !tried.has(c.id)) ?? crystals[0]
    tried.add(crystal.id)
    const caged = isCaged(bot, crystal.position)
    try {
      if (!caged) {
        say(bot, '🏹 Cristal en vue, tir à l\'arc')
        await shootWithBow(bot, crystal, 5)
      } else {
        await destroyCagedCrystal(bot, crystal)
      }
    } catch (e) {
      log(`cristal raté : ${e.message}`)
    }
    await sleep(1500)
    if (bot.health < 15) await eatUntil(bot)
  }
}

async function fightDragon (bot) {
  say(bot, '⚔️ C\'est parti : combat du dragon !')
  const t0 = Date.now()
  let dodge = 0
  while (Date.now() - t0 < 30 * 60000) {
    const dragon = Object.values(bot.entities).find((e) => e.name === 'ender_dragon')
    if (!dragon) return true // victoire !
    // se soigner
    if (bot.health < 13) {
      say(bot, '❤️ Je recule pour me soigner')
      const { x, z } = bot.entity.position
      await goTo(bot, new GoalXZ(x + (Math.random() * 2 - 1) * 20, z + (Math.random() * 2 - 1) * 20), { timeout: 15000, retries: 0 })
      await eatUntil(bot, 18)
      await sleep(5000)
      continue
    }
    const d = dragon.position.distanceTo(bot.entity.position)
    await equipShield(bot)
    if (d < 12) {
      // le dragon se perche : au corps à corps
      await equipBestSword(bot)
      try {
        await withTimeout(bot.pvp.attack(dragon), 20000)
      } catch (e) {
        try { bot.pvp.stop() } catch {}
      }
    } else {
      await shootWithBow(bot, dragon, 2)
      // esquive régulière du souffle
      if (++dodge % 2 === 0) {
        const { x, z } = bot.entity.position
        await goTo(bot, new GoalXZ(x + (Math.random() * 2 - 1) * 10, z + (Math.random() * 2 - 1) * 10), { timeout: 6000, retries: 0 })
      }
    }
    await sleep(500)
  }
  throw new Error('le combat s\'éternise — relancer la phase')
}

async function phaseDragon (bot, cfg, progress) {
  say(bot, '🐲 Phase 13 : destruction des cristaux puis combat du dragon')
  await gotoEndIsland(bot)
  await destroyCrystals(bot)
  say(bot, '✓ Tous les cristaux sont détruits')
  await eatUntil(bot, 19)
  const won = await fightDragon(bot)
  if (won) {
    say(bot, '🏆 LE DRAGON EST VAINCU ! Je passe dans le portail de sortie.')
    await sleep(8000) // attendre l'anim du portail de sortie
    const exitId = md(bot).blocksByName.end_portal?.id
    const exit = bot.findBlock({ matching: exitId, maxDistance: 64 })
    if (exit) {
      await goTo(bot, new GoalNear(exit.position.x, exit.position.y, exit.position.z, 0), { timeout: 60000, retries: 0 })
      await sleep(4000)
    }
    say(bot, '🌍 De retour à la maison. Mission accomplie !')
  }
}

module.exports = {
  phaseWood, phaseStone, phaseIron, phaseDiamond, phaseObsidian, phaseBase,
  phaseNether, phaseFortress, phaseBlaze, phasePearls, phaseEyes,
  phaseStronghold, phaseDragon, seekStronghold, findPortalRoom, activateEndPortal,
  destroyCrystals, fightDragon, isCaged
}
