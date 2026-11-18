// ============================================================
// LibreBot — src/phases.js
// Les 13 phases de la mission : du premier arbre au dragon.
// ============================================================
const {
  Vec3, log, say, chat, sleep, withTimeout, mcData, countItem, findEntities, equipName, equipShield,
  equipBestSword, pillarUp, digBlock,
  goTo, GoalNear, GoalXZ, GoalY, GoalBlock, explore, enterDimension,
  collectBlocks, collectNearbyItems, craftItem, craftAnyPlanks, smeltItem,
  eatUntil, huntMob, shootWithBow, placeBlockFromInventory, isSolidBlock,
  digStaircase, ascendTo, branchMine, getWaterBucket, makeObsidian, lootNearbyChests,
  digGravelForFlint, trackEyeOfEnder
, actBlock, actItem, deactItem, placeSafe, equipSafe, lookSafe } = require('./utils')
const { buildHouse, buildNetherPortal } = require('./build')
const learn = require('./learn')

const md = (bot) => mcData(bot)

// helpers locaux (évite de requérir survie.js en haut — cycle potentiel)
const isNightLocal = (bot) => { const t = bot.time?.timeOfDay ?? 0; return t >= 13000 && t <= 23000 }
function nearestHostileLocal (bot, maxDist) {
  const HOST = new Set(['zombie','skeleton','creeper','spider','enderman','witch','pillager','vindicator','evoker','ravager','hoglin','blaze','ghast','wither','phantom','drowned','husk','stray','zombified_piglin','piglin','piglin_brute','magma_cube','slime','guardian','elder_guardian','vex','warden','breeze'])
  if (!bot.entity?.position) return null
  return bot.nearestEntity((e) => HOST.has(e.name) && e.isValid !== false && e.position.distanceTo(bot.entity.position) < maxDist)
}

// ---------- Phase 1 : bois, outils, nourriture ----------

async function phaseWood (bot, cfg, progress) {
  say(bot, '🪓 Phase 1 : bois et premiers outils')
  const ALL_LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log', 'pale_oak_log']
  const rush = !!cfg.rush
  let logs = 0
  // 1. arbres mémorisés d'abord (apprentissage) : jusqu'à 3, du plus proche au
  // plus loin, timeout court — un arbre de l'autre côté d'un océan ne vaut pas 2 min
  const knownTrees = learn.getNearestDiscoveries('tree', bot.entity.position, 3, 400)
  for (const k of knownTrees) {
    say(bot, "🌲 Arbre mémorisé à " + Math.round(k.dist) + " blocs — j'y vais")
    await goTo(bot, new GoalNear(k.x, k.y, k.z, 3), { timeout: 45000, retries: 0 }).catch(() => {})
    logs = await collectBlocks(bot, ALL_LOGS, rush ? 4 : 12, { maxDistance: 40, maxMinutes: 2 })
    if (logs > 0) break
  }
  // 2. sinon exploration en spirale, en re-vérifiant la mémoire à chaque tour
  if (logs === 0) {
    say(bot, "Pas d'arbre à portée, j'explore…")
    for (let i = 0; i < 10; i++) {
      // re-vérifier les arbres mémorisés (découverts entre-temps ou plus proches maintenant)
      const k2 = learn.getNearestDiscoveries('tree', bot.entity.position, 1, 250)[0]
      if (k2 && k2.dist < 150) {
        await goTo(bot, new GoalNear(k2.x, k2.y, k2.z, 3), { timeout: 40000, retries: 0 }).catch(() => {})
        logs = await collectBlocks(bot, ALL_LOGS, rush ? 4 : 12, { maxDistance: 40, maxMinutes: 2 })
        if (logs > 0) break
      }
      await explore(bot, 100) // rayon 100 ancré sur le spawn
      logs = await collectBlocks(bot, ALL_LOGS, rush ? 4 : 12, { maxDistance: 96, maxMinutes: rush ? 3 : 6 })
      if (logs > 0) break
    }
    if (logs === 0) throw new Error('aucun arbre trouvé (désert ?) — déplace le bot vers une forêt')
  }
  await craftAnyPlanks(bot, rush ? 12 : 40)
  await craftItem(bot, 'crafting_table', rush ? 1 : 2)
  await craftItem(bot, 'stick', rush ? 4 : 12)
  await craftItem(bot, 'wooden_pickaxe', 1)
  await craftItem(bot, 'wooden_axe', 1)
  // SPEEDRUN (rush) : PAS d'épée en bois (économie de 2 planches), PAS de chasse
  // d'animaux (perte de temps) — on mange ce qu'on trouve (pommes, drops) plus tard.
  if (!rush) {
    await craftItem(bot, 'wooden_sword', 1)
    await huntMob(bot, ['cow', 'pig', 'sheep', 'chicken'], {
      until: () => bot.food >= 16 || ['beef', 'porkchop', 'mutton', 'chicken'].some((f) => countItem(bot, f) >= 6),
      maxMinutes: 4
    })
    await huntMob(bot, ['chicken'], {
      until: () => countItem(bot, 'feather') >= 10,
      maxMinutes: 6
    })
  }
  await eatUntil(bot, rush ? 10 : 20)
}

// ---------- Phase 2 : pierre ----------

async function phaseStone (bot, cfg, progress) {
  say(bot, '🪨 Phase 2 : outils en pierre')
  const rush = !!cfg.rush
  // adaptatif : ne pas re-miner la pierre déjà en stock
  const haveStone = countItem(bot, 'cobblestone') + countItem(bot, 'stone')
  if (haveStone < (rush ? 12 : 64)) {
    // rush : 12 cobble suffisent (pioche 3 + fourneau 8 + marge)
    await collectBlocks(bot, ['stone', 'cobblestone'], rush ? 12 : 64, { maxDistance: 96, maxMinutes: rush ? 3 : 8 })
  } else {
    say(bot, '⚡ ' + haveStone + ' blocs de pierre déjà en stock — je passe le minage')
  }
  // RÉSILIENCE reprise : la phase bois est souvent marquée « faite » (pioche en bois
  // conservée) alors qu'il ne reste NI bûche NI planche en inventaire — les bâtons
  // sont alors infabricables et toute la chaîne pierre échoue (« missing ingredient »).
  const PLANK_NAMES = ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'cherry_planks', 'mangrove_planks', 'pale_oak_planks']
  const LOG_NAMES = PLANK_NAMES.map((p) => p.replace('_planks', '_log'))
  const anyCount = (list) => list.reduce((a, n) => a + countItem(bot, n), 0)
  if (countItem(bot, 'stick') < 2 && anyCount(PLANK_NAMES) === 0 && anyCount(LOG_NAMES) === 0) {
    say(bot, '⚡ Ni bâtons ni bois en stock — je coupe une bûche express (reprise)')
    await collectBlocks(bot, LOG_NAMES, 1, { maxDistance: 64, maxMinutes: 2 })
  }
  if (countItem(bot, 'stick') < 2) await craftItem(bot, 'stick', 2)
  await craftItem(bot, 'stone_pickaxe', 1)
  if (!rush) {
    await craftItem(bot, 'stone_axe', 1)
    await craftItem(bot, 'stone_sword', 1)
    await craftItem(bot, 'stone_shovel', 1)
  }
  await craftItem(bot, 'furnace', rush ? 1 : 2)
  await eatUntil(bot, 15)
}

// ---------- Phase 3 : fer ----------

async function phaseIron (bot, cfg, progress) {
  say(bot, '⛏️ Phase 3 : le fer (descente vers Y=16)')
  const rush = !!cfg.rush
  // adaptatif : le besoin compte AUSSI les lingots déjà fondus (butin de coffre,
  // reprise de run) — sinon on re-minait du fer alors qu'on en a déjà
  const ironTotal = () => countItem(bot, 'raw_iron') + countItem(bot, 'iron_ingot')
  // ORDRE CORRIGÉ : le seau nécessite 3 lingots — le crafter AVANT le minage
  // échouait (« missing ingredient » si 0 fer) et bloquait la phase instantanément.
  // On mine/font d'abord, le seau est fabriqué/rempli avec les lingots produits.
  await digStaircase(bot, 16)
  if (ironTotal() >= cfg.targets.rawIron) {
    say(bot, '⚡ ' + ironTotal() + ' unités de fer en stock (mineraï + lingots) — je passe le minage')
  } else {
    const ok = await branchMine(bot, {
      y: 16,
      need: () => ironTotal() >= cfg.targets.rawIron,
      ores: ['iron_ore', 'deepslate_iron_ore'],
      extraOres: ['coal_ore', 'deepslate_coal_ore'],
      maxMinutes: rush ? 10 : 25
    })
    if (!ok) throw new Error('pas assez de fer trouvé')
  }
  say(bot, '🔥 Fonte du fer…')
  await smeltItem(bot, 'raw_iron', 'iron_ingot', cfg.targets.rawIron)
  // rush : pas d'armure en fer (24 lingots perdus), juste l'essentiel
  if (!rush) {
    for (const piece of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
      await craftItem(bot, piece, 1)
    }
  }
  await craftItem(bot, 'iron_sword', 1)
  await craftItem(bot, 'iron_pickaxe', 1)
  if (!rush) {
    await craftItem(bot, 'iron_shovel', 1)
    await craftItem(bot, 'iron_axe', 1)
    await craftItem(bot, 'shield', 1)
  }
  // SPEEDRUN : 1 seul seau (on le reremplit à l'eau après l'obsidienne), flèches/torches réduites
  await craftItem(bot, 'bucket', rush ? 1 : 2)
  await getWaterBucket(bot) // remplir d'eau (seau crafté ci-dessus avec le fer miné)
  const arrows = rush ? 8 : 32
  const arrowCrafts = Math.ceil(arrows / 4) // 1 flint + 1 plume + 1 bâton = 4 flèches
  // plumes : en rush la chasse aux poules de la phase 1 est sautée — sans ça,
  // craftItem('arrow') throw systématiquement (« feather ne se craft pas »)
  if (countItem(bot, 'feather') < arrowCrafts) {
    say(bot, '🏹 Il me faut ' + arrowCrafts + ' plume(s) pour les flèches — chasse aux poules express')
    await huntMob(bot, ['chicken'], {
      until: () => countItem(bot, 'feather') >= arrowCrafts,
      maxMinutes: rush ? 3 : 6
    })
    if (countItem(bot, 'feather') < arrowCrafts) say(bot, '⚠️ Pas assez de plumes — je tenterai les flèches avec ce qu\'il y a')
  }
  await digGravelForFlint(bot, Math.max(arrowCrafts + 1 - countItem(bot, 'flint'), 0)) // +1 pour le briquet
  await craftItem(bot, 'flint_and_steel', 1)
  if (countItem(bot, 'feather') >= arrowCrafts) await craftItem(bot, 'arrow', arrows) // silex + bâton + plume
  await craftItem(bot, 'torch', rush ? 8 : 32)
  await eatUntil(bot, rush ? 12 : 18)
}

// ---------- Phase 4 : diamants ----------

async function phaseDiamond (bot, cfg, progress) {
  say(bot, '💎 Phase 4 : les diamants (descente vers Y=-58)')
  const rush = !!cfg.rush
  if (countItem(bot, 'diamond') >= cfg.targets.diamonds) {
    say(bot, '⚡ Diamants déjà en stock — je passe le minage')
  } else {
    await digStaircase(bot, -58)
    const ok = await branchMine(bot, {
      y: -58,
      need: () => countItem(bot, 'diamond') >= cfg.targets.diamonds,
      ores: ['diamond_ore', 'deepslate_diamond_ore'],
      extraOres: ['coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore'],
      maxMinutes: rush ? 15 : 45
    })
    if (!ok) throw new Error('pas assez de diamants trouvés (mauvaise chance…)')
  }
  // rush : 5 diamants = pioche (3) + épée (2), pas d'armure diamant
  if (!rush) {
    for (const piece of ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots']) {
      await craftItem(bot, piece, 1)
    }
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
  // rush : pas de maison, on enregistre juste la position actuelle comme "home" (pour la fuite)
  if (cfg.rush) {
    progress.home = [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z]
    say(bot, '⚡ Rush : pas de base construite, home = ma position actuelle')
    await eatUntil(bot, 18)
    return
  }
  await ascendTo(bot, 68)
  await buildHouse(bot)
  // stocker quelques coordonnées utiles
  progress.home = [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z]
  await eatUntil(bot, 18)
}

// ---------- Phase 7 : portail du Nether ----------

async function phaseNether (bot, cfg, progress) {
  say(bot, '🔥 Phase 7 : portail du Nether')
  const minObsidian = cfg.rush ? 10 : 14 // rush : portail sans les 4 coins = 10 obsidiennes
  if (countItem(bot, 'obsidian') < minObsidian) {
    await makeObsidian(bot, minObsidian)
  }
  if (countItem(bot, 'flint_and_steel') === 0) {
    await digGravelForFlint(bot, 1)
    await craftItem(bot, 'flint_and_steel', 1)
  }
  await ascendTo(bot, 68)
  const portalPos = await buildNetherPortal(bot)
  progress.netherPortal = [portalPos.x, portalPos.y, portalPos.z]
  // entrer dans le portail
  await goTo(bot, new GoalNear(portalPos.x, portalPos.y, portalPos.z, 0.5), { timeout: 30000, retries: 1 })
  const inNether = await enterDimension(bot, 'the_nether', 45000)
  if (!inNether) throw new Error('je n\'arrive pas à traverser le portail')
  chat(bot, 'enterNether', {}, { force: true })
  say(bot, '🌋 Bienvenue au Nether !')
  await equipShield(bot)
}

// ---------- Phase 8 : recherche de la forteresse ----------

async function phaseFortress (bot, cfg, progress) {
  say(bot, '🏰 Phase 8 : recherche de la forteresse')
  const bricksId = md(bot).blocksByName.nether_bricks?.id
  if (!bricksId) throw new Error('nether_bricks inconnu pour cette version — forteresse introuvable')
  // MÉMOIRE d'abord : une forteresse déjà vue (run précédent, mort ici) est retournée
  // directement en cohérence avec progress.fortress conservé à la mort
  if (progress.fortress) {
    say(bot, '🧠 Je connais déjà une forteresse (' + progress.fortress[0] + ', ' + progress.fortress[2] + ')')
    await goTo(bot, new GoalNear(progress.fortress[0], progress.fortress[1], progress.fortress[2], 3), { timeout: 180000, retries: 1 }).catch(() => {})
    const found = bot.findBlocks({ matching: bricksId, maxDistance: 48, count: 6 })
    if (found.length) {
      progress.fortress = [found[0].x, found[0].y, found[0].z]
      chat(bot, 'chestFound', { dist: Math.round(found[0].distanceTo(bot.entity.position)) })
      try { await lootNearbyChests(bot, 48, 5) } catch {}
      return
    }
  }
  // EXPLORATION PROGRESSIVE : avant, des marches aléatoires ±150 blocs qui
  // pouvaient tourner en rond ; maintenant une spirale croissante autour du
  // portail (rayon × 1.3 à chaque tour), qui balaye tout le Nether proche
  const anchor = progress.netherPortal ? { x: progress.netherPortal[0], z: progress.netherPortal[2] } : { x: bot.entity.position.x, z: bot.entity.position.z }
  let fortress = null
  let radius = 150
  let angle = Math.random() * Math.PI * 2
  for (let i = 0; i < 40 && !fortress; i++) {
    const spots = bot.findBlocks({ matching: bricksId, maxDistance: 96, count: 6 })
    if (spots.length) fortress = spots[0]
    else {
      const tx = anchor.x + Math.cos(angle) * radius
      const tz = anchor.z + Math.sin(angle) * radius
      angle += Math.PI / 3 // 6 points de spirale par tour
      radius *= 1.08
      await goTo(bot, new GoalXZ(tx, tz), { timeout: 90000, retries: 0 })
    }
    if (bot.health < 14) await eatUntil(bot)
  }
  if (!fortress) throw new Error('forteresse introuvable dans cette zone — relancer la phase')
  chat(bot, 'chestFound', { dist: Math.round(fortress.distanceTo(bot.entity.position)) })
  say(bot, '🏰 Forteresse repérée en (' + fortress.x + ', ' + fortress.y + ', ' + fortress.z + ')')
  await goTo(bot, new GoalNear(fortress.x, fortress.y, fortress.z, 2), { timeout: 120000, retries: 1 })
  progress.fortress = [fortress.x, fortress.y, fortress.z]
  // mémoriser pour les runs futurs (le cerveau y reviendra directement)
  learn.recordDiscovery('fortress', fortress)
  // looter les coffres de la forteresse au passage
  try { await lootNearbyChests(bot, 48, 5) } catch {}
}

// ---------- Phase 9 : chasse aux blazes ----------

async function phaseBlaze (bot, cfg, progress) {
  say(bot, '🔥 Phase 9 : chasse aux blazes')
  // se rapprocher d'un spawner (les blazes apparaissent dessus)
  const spawnerId = md(bot).blocksByName.spawner?.id
  // guard : matching undefined matcherait TOUS les blocs (findBlock renverrait n'importe quoi)
  let spawner = spawnerId ? bot.findBlock({ matching: spawnerId, maxDistance: 64 }) : null
  if (spawner) {
    await goTo(bot, new GoalNear(spawner.position.x, spawner.position.y, spawner.position.z, 3), { timeout: 60000, retries: 0 })
  }
  const ok = await huntMob(bot, ['blaze'], {
    until: () => countItem(bot, 'blaze_rod') >= cfg.targets.blazeRods,
    maxMinutes: cfg.rush ? 12 : 18
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
  const portalId = md(bot).blocksByName.nether_portal?.id
  // guard : matching undefined matcherait tous les blocs
  const spots = portalId ? bot.findBlocks({ matching: portalId, maxDistance: 128, count: 4 }) : []
  const target = spots[0] ?? new Vec3(portal[0], portal[1], portal[2])
  await goTo(bot, new GoalNear(target.x, target.y, target.z, 0.5), { timeout: 120000, retries: 1 })
  const back = await enterDimension(bot, 'overworld', 45000)
  if (!back) throw new Error('retour impossible dans l\'overworld')
  chat(bot, 'backOverworld', {}, { force: true })
  say(bot, '🌍 De retour à la surface !')
  await ascendTo(bot, 68)
  // SPEEDRUN : farm des perles la NUIT (spawn d'endermen ×10) — attendre la nuit max 4 min
  // en se mettant à l'abri (trou 1x1x2), bien plus rapide que de chasser de jour.
  if (cfg.rush) {
    const t0 = Date.now()
    let hid = false
    const surfaceY = Math.floor(bot.entity.position.y) // pour ressortir du trou ensuite
    while (!isNightLocal(bot) && Date.now() - t0 < 4 * 60000) {
      if (!hid) {
        hid = true
        say(bot, '🌙 Rush : j\'attends la nuit pour farmer les endermen (spawn ×10)')
        try {
          const { digBlock } = require('./utils')
          const pos = bot.entity.position.floored()
          for (const dy of [-1, -2]) {
            const blk = bot.blockAt(pos.offset(0, dy, 0))
            if (isSolidBlock(blk) && blk.name !== 'bedrock') await digBlock(bot, blk, 4000).catch(() => {})
          }
        } catch {}
      }
      await sleep(5000)
      if (nearestHostileLocal(bot, 8)) break // un mob entre : on sort chasser quand même
    }
    // ressortir du trou : sans ça le bot restait coincé 2 blocs sous terre et
    // chassait les endermen sans les atteindre
    if (bot.entity.position.y < surfaceY - 0.5) {
      const climb = countItem(bot, 'cobblestone') > 0 ? 'cobblestone' : (countItem(bot, 'dirt') > 0 ? 'dirt' : null)
      if (climb) {
        try { await pillarUp(bot, surfaceY + 1, climb) } catch (e) { log('⚠️ ressortie du trou ratée : ' + e.message) }
      } else {
        // pas de blocs : creuser un escalier de secours vers le haut
        for (let dy = 0; dy < 4 && bot.entity.position.y < surfaceY; dy++) {
          try {
            const { digBlock } = require('./utils')
            const p2 = bot.entity.position.floored().offset(0, 1, 0)
            const blk = bot.blockAt(p2)
            if (blk && isSolidBlock(blk) && blk.name !== 'bedrock') await digBlock(bot, blk, 4000).catch(() => {})
          } catch {}
        }
      }
    }
  }
  const ok = await huntMob(bot, ['enderman'], {
    until: () => countItem(bot, 'ender_pearl') >= cfg.targets.enderPearls,
    maxMinutes: cfg.rush ? 20 : 45
  })
  if (!ok) say(bot, `⚠️ Seulement ${countItem(bot, 'ender_pearl')} perles… on continue avec ce qu'on a`)
  await eatUntil(bot, 18)
}

// ---------- Phase 11 : yeux de l'Ender ----------

async function phaseEyes (bot, cfg, progress) {
  say(bot, '👁️ Phase 11 : fabrication des yeux de l\'Ender')
  // 1 œil = 1 poudre de blaze + 1 perle. La poudre se craft depuis les rods
  // (1 rod = 2 poudres) — mais blaze_rod est dans NOT_CRAFTABLE : si on calcule
  // "enderEyes + 2" poudres avec seulement 12 rods (24 poudres), craftItem throw.
  // On calcule donc depuis l'inventaire RÉEL pour ne jamais demander plus que dispo.
  const pearls = countItem(bot, 'ender_pearl')
  const havePowder = countItem(bot, 'blaze_powder')
  const maxPowder = havePowder + countItem(bot, 'blaze_rod') * 2
  const eyes = Math.min(cfg.targets.enderEyes, pearls, maxPowder)
  if (eyes < 10) throw new Error(`matériel insuffisant : ${pearls} perles / ${maxPowder} poudres max (rods: ${countItem(bot, 'blaze_rod')})`)
  if (havePowder < eyes) await craftItem(bot, 'blaze_powder', eyes - havePowder)
  await craftItem(bot, 'ender_eye', eyes)
  say(bot, `✓ ${countItem(bot, 'ender_eye')} yeux de l'Ender`)
}

// ---------- Phase 12 : recherche du stronghold + portail de l'End ----------

const BRICK_NAMES = ['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'infested_stone_bricks',
  'infested_mossy_stone_bricks', 'infested_cracked_stone_bricks', 'chiseled_stone_bricks']

// Intersection de deux droites définies chacune par 2 points (formule algébrique,
// trouvée dans les calculateurs de stronghold type akorzunin/Intersection-calculator).
// Droite 1: (x1,z1)-(x2,z2), droite 2: (x3,z3)-(x4,z4) → point d'intersection.
function lineIntersection (x1, z1, x2, z2, x3, z3, x4, z4) {
  const d = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4)
  if (Math.abs(d) < 1e-6) return null // droites parallèles
  const px = ((x1 * z2 - z1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * z4 - z3 * x4)) / d
  const pz = ((x1 * z2 - z1 * x2) * (z3 - z4) - (z1 - z2) * (x3 * z4 - z3 * x4)) / d
  return [px, pz]
}

// Lance un œil et retourne { from: [x,z] position du bot, to: [x,z] arrêt de l'œil }
async function throwEye (bot) {
  const eye = bot.inventory.items().find((i) => i.name === 'ender_eye')
  if (!eye) throw new Error('plus d\'yeux de l\'Ender')
  await equipSafe(bot, eye, 'hand')
  const from = [bot.entity.position.x, bot.entity.position.z]
  await bot.look(Math.random() * Math.PI * 2, -0.6)
  await sleep(300)
  await actItem(bot)
  const end = await trackEyeOfEnder(bot)
  return { from, to: end ? [end.x, end.z] : from }
}

async function seekStronghold (bot, progress) {
  // Triangulation algébrique (méthode speedrun) : 2 lancers d'yeux à 500+ blocs
  // d'écart → intersection des 2 trajectoires = position exacte du stronghold.
  // Beaucoup plus rapide que les 30 lancers itératifs.
  if (progress.strongholdXZ) {
    // estimation déjà connue : on y va directement
    say(bot, `🎯 Stronghold estimé en (${Math.round(progress.strongholdXZ[0])}, ${Math.round(progress.strongholdXZ[1])})`)
    await goTo(bot, new GoalXZ(progress.strongholdXZ[0], progress.strongholdXZ[1]), { timeout: 180000, retries: 1 })
    return
  }
  const throws = []
  for (let t = 0; t < 2 && throws.length < 2; t++) {
    const r = await throwEye(bot)
    throws.push(r)
    say(bot, `🧭 Lancer ${throws.length} : de (${Math.round(r.from[0])}, ${Math.round(r.from[1])}) vers (${Math.round(r.to[0])}, ${Math.round(r.to[1])})`)
    if (throws.length === 1) {
      // se déplacer à ~500 blocs, de préférence perpendiculairement à la trajectoire
      const dx = r.to[0] - r.from[0]
      const dz = r.to[1] - r.from[1]
      const len = Math.hypot(dx, dz) || 1
      const perp = [-dz / len, dx / len] // perpendiculaire
      const side = Math.random() < 0.5 ? 1 : -1
      const tx = r.from[0] + perp[0] * side * 500
      const tz = r.from[1] + perp[1] * side * 500
      say(bot, `🚶 Je me déplace à 500 blocs pour le 2ème lancer…`)
      await goTo(bot, new GoalXZ(tx, tz), { timeout: 300000, retries: 1 })
    }
  }
  if (throws.length >= 2) {
    const [a, b, c, d] = [throws[0].from, throws[0].to, throws[1].from, throws[1].to]
    const inter = lineIntersection(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])
    if (inter) {
      say(bot, `🎯 Triangulation : stronghold estimé en (${Math.round(inter[0])}, ${Math.round(inter[1])})`)
      progress.strongholdXZ = inter
      await goTo(bot, new GoalXZ(inter[0], inter[1]), { timeout: 300000, retries: 1 })
      // confirmation ITÉRATIVE : tant que l'œil vole loin, l'estimation était fausse —
      // on suit sa trajectoire au lieu de figer une cible potentiellement à des centaines de blocs
      for (let tries = 0; tries < 3; tries++) {
        const confirm = await throwEye(bot)
        const flight = Math.hypot(confirm.to[0] - confirm.from[0], confirm.to[1] - confirm.from[1])
        if (flight < 30) {
          say(bot, '📍 L\'œil retombe près de moi : le stronghold est juste en dessous !')
          progress.strongholdXZ = [bot.entity.position.x, bot.entity.position.z]
          return
        }
        progress.strongholdXZ = confirm.to
        await goTo(bot, new GoalXZ(confirm.to[0], confirm.to[1]), { timeout: 300000, retries: 1 })
      }
      return
    }
  }
  // repli : méthode itérative classique si la triangulation échoue (yeux parallèles)
  let est = progress.strongholdXZ ?? null
  for (let t = 0; t < 30; t++) {
    const r = await throwEye(bot)
    if (Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]) < 5) {
      say(bot, "📍 L'œil retombe : le stronghold est juste en dessous !")
      progress.strongholdXZ = [bot.entity.position.x, bot.entity.position.z]
      return
    }
    est = r.to
    progress.strongholdXZ = est
    say(bot, `🧭 L'œil vole vers x=${Math.round(est[0])} z=${Math.round(est[1])}`)
    const arrived = await goTo(bot, new GoalXZ(est[0], est[1]), { timeout: 120000, retries: 0 })
    if (arrived) return
  }
  throw new Error('stronghold introuvable après triangulation + 30 lancers')
}

async function findPortalRoom (bot, progress) {
  const frameId = md(bot).blocksByName.end_portal_frame?.id
  if (!frameId) throw new Error('end_portal_frame inconnu pour cette version de Minecraft')
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
  if (!frameId || !portalId) throw new Error('blocs du portail de l\'End inconnus pour cette version')
  for (let attempt = 0; attempt < 4; attempt++) {
    const frames = bot.findBlocks({ matching: frameId, maxDistance: 32, count: 16 })
      .map((p) => bot.blockAt(p))
      .filter(Boolean)
    for (const f of frames) {
      const eye = bot.inventory.items().find((i) => i.name === 'ender_eye')
      if (!eye) break
      await equipSafe(bot, eye, 'hand')
      try {
        await lookSafe(bot, f.position.offset(0.5, 0.5, 0.5))
        await actBlock(bot, f)
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
  await goTo(bot, new GoalNear(portal.position.x, portal.position.y, portal.position.z, 0.5), { timeout: 30000, retries: 1 })
  const inEnd = await enterDimension(bot, 'the_end', 45000)
  if (!inEnd) throw new Error('je n\'arrive pas à entrer dans l\'End')
  chat(bot, 'enterEnd', {}, { force: true })
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
  await goTo(bot, new GoalXZ(0, 0), { timeout: 120000, retries: 1 })
  await sleep(1000)
}

async function findGroundBelow (bot) {
  const feet = bot.entity.position.floored()
  for (let dy = -1; dy > -150; dy--) {
    const b = bot.blockAt(feet.offset(0, dy, 0))
    if (isSolidBlock(b)) return feet.y + dy + 1
  }
  return 0
}

// Descendre d'une tour : petite chute, ou saut + seau d'eau (MLG) si haut.
async function safeDescend (bot) {
  const groundY = await findGroundBelow(bot) // findGroundBelow est async : sans await, groundY = Promise → NaN
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
    // garde temporelle : si le bot est bloqué mid-air (slime, liane…), on ne boucle pas indéfiniment
    const fallT0 = Date.now()
    while (bot.entity.position.y - groundY > 10 && (bot.entity.velocity?.y ?? 0) < 0) {
      if (Date.now() - fallT0 > 15000) { log('⚠️ chute MLG interrompue (bloqué ?) — je pose l\'eau quand même'); break }
      await sleep(40)
    }
    try { await equipName(bot, 'water_bucket', 'hand') } catch {}
    await actItem(bot)
    await sleep(2500)
    bot.setControlState('forward', false)
    return true
  }
  // pas d'eau : redescendre en construisant un escalier de blocs
  log('descente prudente bloc par bloc (pas de seau d\'eau)')
  const descendT0 = Date.now()
  while (bot.entity.position.y > groundY + 3) {
    if (Date.now() - descendT0 > 60000) { log('⚠️ descente bloc par bloc trop longue — abandon'); break } // garde anti boucle infinie
    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    const sideBlocks = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => bot.blockAt(feet.offset(dx, -1, dz)))
    const side = sideBlocks.find((b) => isSolidBlock(b))
    try {
      const blockName = countItem(bot, 'cobblestone') > 0 ? 'cobblestone' : 'dirt'
      await equipName(bot, blockName, 'hand')
      if (side) {
        // faceVector doit être une direction cardinale (doc mineflayer) : on prend
        // l'axe dominant entre le bot et le bloc de référence (avant : Vec3(0,0,0) = invalide)
        const d = bot.entity.position.floored().minus(side.position)
        const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z)
        const face = ay >= ax && ay >= az ? new Vec3(0, Math.sign(d.y) || 1, 0)
          : ax >= az ? new Vec3(Math.sign(d.x) || 1, 0, 0)
          : new Vec3(0, 0, Math.sign(d.z) || 1)
        await placeSafe(bot, side, face)
      }
    } catch (e) {}
    bot.setControlState('sneak', true)
    bot.setControlState('forward', true)
    await sleep(350)
    bot.setControlState('forward', false)
    bot.setControlState('sneak', false)
    await sleep(400)
    if (Math.abs(bot.entity.velocity?.y ?? 0) < 0.01 && bot.entity.position.y === feet.y) break // bloqué
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
      try { await digBlock(bot, bars, 6000) } catch (e) {}
    }
  }
  // casser aussi les barreaux au-dessus si présents
  const top = bot.blockAt(new Vec3(cx, cy + 1, cz))
  if (top && top.name === 'iron_bars') {
    try { await digBlock(bot, top, 6000) } catch (e) {}
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
    const crystals = findEntities(bot, (e) => e.name === 'end_crystal', { firstOnly: false })
    if (!crystals.length) {
      // vérifier qu'il n'y en a vraiment plus
      await sleep(2000)
      const again = findEntities(bot, (e) => e.name === 'end_crystal', { firstOnly: false })
      if (!again.length) return
      continue
    }
    // ne prendre que les cristaux pas encore essayés ; si tous sont tried, attendre
    // qu'ils meurent (le tir peut avoir réussi avec du retard) au lieu de re-tirer dans le vide
    const fresh = crystals.filter((c) => !tried.has(c.id))
    if (!fresh.length) {
      await sleep(5000) // attendre la mort des cristaux déjà ciblés
      continue
    }
    const crystal = fresh[0]
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
    const dragon = findEntities(bot, (e) => e.name === 'ender_dragon')
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
    if (d < 12 && dragon.isValid !== false) {
      // le dragon se perche : au corps à corps (vérifier qu'il est toujours là, sinon on tape dans le vide)
      await equipBestSword(bot)
      try {
        await withTimeout(bot.pvp.attack(dragon), 12000)
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
  chat(bot, 'kill', { mob: 'tous les cristaux' }, { force: true })
  say(bot, '✓ Tous les cristaux sont détruits')
  await eatUntil(bot, 19)
  const won = await fightDragon(bot)
  if (won) {
    announce(bot, ['🏆 LE DRAGON EST VAINCU !', '🐉 Victoire ! Je rentre à la maison !'])
    say(bot, '🏆 LE DRAGON EST VAINCU ! Je passe dans le portail de sortie.')
    await sleep(8000) // attendre l'anim du portail de sortie
    const exitId = md(bot).blocksByName.end_portal?.id
    const exit = exitId ? bot.findBlock({ matching: exitId, maxDistance: 64 }) : null
    if (exit) {
      await goTo(bot, new GoalNear(exit.position.x, exit.position.y, exit.position.z, 0.5), { timeout: 60000, retries: 0 })
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
