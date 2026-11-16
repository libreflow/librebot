// ============================================================
// LibreBot — src/phases2.js
// Ateliers de succès (phases 14+) : après le dragon, le bot
// enchaîne des ateliers qui tentent les succès un par un.
// Chaque tâche est isolée : un échec ne bloque pas les autres.
// ============================================================
const {
  Vec3, log, say, sleep, withTimeout, mcData, countItem, equipName, equipShield,
  goTo, GoalNear, GoalXZ, GoalY, GoalBlock, explore, enterDimension,
  collectBlocks, collectNearbyItems, craftItem, craftAnyPlanks, smeltItem, eatUntil,
  huntMob, equipBestSword, shootWithBow, placeBlockFromInventory, findSolidNeighbor,
  digStaircase, ascendTo, makeObsidian, findGroundBelow
} = require('./utils')
const { buildHouse, buildNetherPortal, placePlan } = require('./build')
const S = require('./skills')
const { record, saveProgress } = require('./advancements')

// exécute une liste de tâches ; enregistre les succès au fil de l'eau
async function runTasks (bot, cfg, progress, label, tasks) {
  say(bot, `━━━ 🛠️ Atelier : ${label} ━━━`)
  for (const task of tasks) {
    while (bot.health < 12) { await eatUntil(bot); await sleep(3000) }
    try {
      log(`▶ tâche : ${task.name}`)
      const ok = await task.run(bot, cfg, progress)
      record(bot, task.adv, ok === false ? 'attempt' : 'ok')
    } catch (e) {
      log(`⚠️ ${task.name} : ${e.message}`)
      record(bot, task.adv, 'attempt')
    }
  }
}

// ---------- Atelier 1 : Aventure Overworld ----------

async function honeyWorkshop (bot) {
  say(bot, '🐝 Ruche : miel, mielcomb et bloc de miel')
  const md = mcData(bot)
  let hive = bot.findBlock({ matching: md.blocksByName.beehive?.id, maxDistance: 96 })
  if (!hive) { await explore(bot, 120); hive = bot.findBlock({ matching: md.blocksByName.beehive?.id, maxDistance: 96 }) }
  if (!hive) throw new Error('pas de ruche à portée')
  // feu de camp sous la ruche (évite d'agacer les abeilles)
  await craftItem(bot, 'campfire', 1)
  const under = bot.blockAt(hive.position.offset(0, -1, 0))
  if (under && under.name === 'air') {
    try {
      await equipName(bot, 'campfire', 'hand')
      await bot.placeBlock(hive, new Vec3(0, -1, 0))
    } catch (e) {}
  }
  await goTo(bot, new GoalNear(hive.position.x, hive.position.y, hive.position.z, 2), { timeout: 30000, retries: 0 })
  // bouteilles de miel (Bee Our Guest)
  await craftItem(bot, 'glass_bottle', 3) // 3 verres
  for (let i = 0; i < 3; i++) {
    try {
      await equipName(bot, 'glass_bottle', 'hand')
      await bot.activateBlock(hive)
      await sleep(700)
    } catch (e) {}
  }
  // mielcomb avec cisailles (matière première de Wax On)
  try {
    await equipName(bot, 'shears', 'hand')
    await bot.activateBlock(hive)
    await sleep(700)
    await collectNearbyItems(bot, 8, 6000)
  } catch (e) {}
  // bloc de miel (Sticky Situation)
  if (countItem(bot, 'honey_bottle') >= 4) await craftItem(bot, 'honey_block', 1)
  // Wax On / Wax Off sur du cuivre
  if (countItem(bot, 'honeycomb') > 0) {
    if (countItem(bot, 'copper_block') === 0 && countItem(bot, 'copper_ingot') >= 9) {
      await craftItem(bot, 'copper_block', 1)
    }
    if (countItem(bot, 'copper_block') > 0) {
      const copper = await placeBlockFromInventory(bot, 'copper_block')
      await equipName(bot, 'honeycomb', 'hand')
      await bot.activateBlock(copper) // cirer (Wax On)
      await sleep(400)
      await equipName(bot, 'iron_axe', 'hand')
      await bot.activateBlock(copper) // décirer (Wax Off)
      await sleep(400)
    }
  }
  return true
}

async function sniperAttempt (bot) {
  say(bot, '🎯 Duel de sniper : squelette à 50 m')
  const sk = bot.nearestEntity((e) => e.name === 'skeleton' && e.position.distanceTo(bot.entity.position) < 64)
  if (!sk) throw new Error('pas de squelette')
  // s'éloigner à 52+ blocs
  const dir = sk.position.minus(bot.entity.position).normalize()
  const far = sk.position.plus(dir.scaled(54))
  await goTo(bot, new GoalXZ(Math.floor(far.x), Math.floor(far.z)), { timeout: 60000, retries: 0 })
  if (sk.position.distanceTo(bot.entity.position) < 50) throw new Error('pas assez loin')
  for (let i = 0; i < 6; i++) {
    await shootWithBow(bot, sk, 1)
    await sleep(2000)
    if (!sk.isValid) return true
  }
  return false
}

function wAventureOverworld () {
  return {
    key: 'atelier_aventure',
    label: 'Aventure Overworld',
    run: async (bot, cfg, progress) => {
      const tasks = [
        { name: 'lit + nuit', adv: ['sweet_dreams'], run: async () => { return S.sleepInBed(bot) } },
        { name: 'semis de blé', adv: ['seedy'], run: async () => { const p = await S.farmWheat(bot); return p > 0 } },
        {
          name: 'pousser le blé + reproduction des vaches',
          adv: ['two_by_two'],
          run: async () => {
            const grew = await S.growWithBonemeal(bot, 5)
            if (!grew) return false
            return S.breedPair(bot, 'cow', 'wheat')
          }
        },
        { name: 'pêche', adv: ['fishy'], run: async () => S.tryFish(bot) },
        { name: 'apprivoiser un cheval', adv: ['best_friends'], run: async () => S.tameHorse(bot) },
        { name: 'arbalète', adv: ['betsy'], run: async () => S.crossbowShot(bot) },
        { name: 'seau de lave', adv: ['hot_stuff'], run: async () => S.fillLavaBucket(bot) },
        { name: 'ampoule en cuivre', adv: ['lighten_up'], run: async () => S.copperBulbWorkshop(bot) },
        { name: 'bloc cible + tir', adv: ['bullseye'], run: async () => S.targetBlockShoot(bot) },
        { name: 'table d\'enchantement', adv: ['enchanter'], run: async () => S.enchantAttempt(bot) },
        {
          name: 'ruche / miel / cire',
          adv: ['bee_guest', 'sticky', 'wax_on', 'wax_off'],
          run: async () => honeyWorkshop(bot)
        },
        {
          name: 'village : échange + golem',
          adv: ['deal', 'hired', 'voluntary_exile'],
          run: async () => {
            const villager = await S.findVillage(bot, 10)
            if (!villager) return false
            const traded = await S.tryTrade(bot, villager)
            await S.buildIronGolem(bot)
            // un capitaine pillard rôde parfois près des villages
            const captain = bot.nearestEntity((e) => e.name === 'pillager' && e.position.distanceTo(bot.entity.position) < 64)
            if (captain) {
              await huntMob(bot, ['pillager'], { until: () => false, maxMinutes: 2 })
              record(bot, ['voluntary_exile'], 'attempt')
            }
            return traded !== false
          }
        },
        { name: 'duel de sniper', adv: ['sniper'], run: async () => sniperAttempt(bot) },
        {
          name: 'chute Caves & Cliffs',
          adv: ['caves_cliffs'],
          run: async () => {
            say(bot, '🪂 Tentative : chute de la limite de build (MLG eau)')
            // monter à 300+ et sauter avec l'eau — tentative rapide
            const blockName = countItem(bot, 'cobblestone') > 0 ? 'cobblestone' : 'dirt'
            if (countItem(bot, blockName) < 200) return false // il faut vraiment beaucoup de blocs
            await S.pillarUpSafe(bot, 300, blockName)
            const ground = findGroundBelow(bot, 400)
            bot.setControlState('forward', true)
            try { await bot.look(bot.entity.yaw, 1.4) } catch {}
            while (bot.entity.position.y - ground > 12) await sleep(40)
            await equipName(bot, 'water_bucket', 'hand')
            await bot.activateItem()
            await sleep(2500)
            bot.setControlState('forward', false)
            return bot.health > 0
          }
        }
      ]
      await runTasks(bot, cfg, progress, 'Aventure Overworld', tasks)
    }
  }
}

// ---------- Atelier 2 : Tour du Nether ----------

async function bastionAttempt (bot, progress) {
  const md = mcData(bot)
  const ids = ['polished_blackstone_bricks', 'polished_blackstone', 'gilded_blackstone']
    .map((n) => md.blocksByName[n]?.id).filter(Boolean)
  const spots = bot.findBlocks({ matching: ids, maxDistance: 128, count: 4 })
  if (!spots.length) throw new Error('pas de bastion visible')
  await goTo(bot, new GoalNear(spots[0].x, spots[0].y, spots[0].z, 3), { timeout: 120000, retries: 0 })
  // fouiller un coffre
  const chestId = md.blocksByName.chest?.id
  const chests = bot.findBlocks({ matching: chestId, maxDistance: 48, count: 4 })
  for (const c of chests) {
    const block = bot.blockAt(c)
    if (!block) continue
    try {
      const chest = await bot.openContainer(block)
      try {
        for (const item of chest.items()) {
          try { await chest.withdraw(item.type, null, item.count) } catch (e) {}
        }
      } finally { try { chest.close() } catch {} }
      return true
    } catch (e) {}
  }
  return false
}

function wNether () {
  return {
    key: 'atelier_nether',
    label: 'Tour du Nether',
    run: async (bot, cfg, progress) => {
      // retourner au Nether : portail existant ou nouveau
      const md = mcData(bot)
      let portal = bot.findBlock({ matching: md.blocksByName.nether_portal?.id, maxDistance: 128 })
      if (!portal) {
        if (countItem(bot, 'obsidian') < 14) {
          await digStaircase(bot, -50)
          await makeObsidian(bot, 14)
          await ascendTo(bot, 68)
        }
        const pos = await buildNetherPortal(bot)
        await goTo(bot, new GoalNear(pos.x, pos.y, pos.z, 0), { timeout: 30000, retries: 1 })
      } else {
        await goTo(bot, new GoalNear(portal.position.x, portal.position.y, portal.position.z, 0), { timeout: 60000, retries: 1 })
      }
      const ok = await enterDimension(bot, 'the_nether', 45000)
      if (!ok) throw new Error('impossible d\'entrer dans le Nether')
      await equipShield(bot)
      const tasks = [
        { name: 'biomes du Nether', adv: ['hot_tourist'], run: async () => S.exploreNetherBiomes(bot, progress, 25) },
        { name: 'or aux piglins', adv: ['oh_shiny', 'crying'], run: async () => S.goldToPiglin(bot) },
        { name: 'minerai antique', adv: ['hidden_depths'], run: async () => S.mineAncientDebris(bot, 4) },
        {
          name: 'netherite : boussole sur magnétite',
          adv: ['lode'],
          run: async () => {
            if (countItem(bot, 'ancient_debris') === 0) return false
            await smeltItem(bot, 'ancient_debris', 'netherite_scrap', 4)
            await craftItem(bot, 'netherite_ingot', 1) // 4 ferrures + 4 or
            await craftItem(bot, 'lodestone', 1) // 8 briques de pierre taillée + 1 netherite
            await craftItem(bot, 'compass', 1)
            const lode = await placeBlockFromInventory(bot, 'lodestone')
            await equipName(bot, 'compass', 'hand')
            await bot.activateBlock(lode)
            await sleep(500)
            return true
          }
        },
        {
          name: 'hoye en netherite (Serious Dedication)',
          adv: ['serious'],
          run: async () => {
            if (countItem(bot, 'netherite_ingot') === 0) return false
            await craftItem(bot, 'diamond_hoe', 1)
            await craftItem(bot, 'smithing_table', 1)
            const table = await placeBlockFromInventory(bot, 'smithing_table')
            // interaction smithing : best effort via activate
            await equipName(bot, 'netherite_ingot', 'hand')
            await bot.activateBlock(table)
            await sleep(1000)
            return true
          }
        },
        {
          name: 'ancrage de réapparition',
          adv: ['nine_lives'],
          run: async () => {
            if (countItem(bot, 'crying_obsidian') < 3 && countItem(bot, 'obsidian_crying') < 3) return false
            await craftItem(bot, 'glowstone', 3) // poussière de glowstone des piglins ou au sol
            await craftItem(bot, 'respawn_anchor', 1)
            const anchor = await placeBlockFromInventory(bot, 'respawn_anchor')
            for (let i = 0; i < 4; i++) {
              try {
                await equipName(bot, 'glowstone', 'hand')
                await bot.activateBlock(anchor)
                await sleep(400)
              } catch (e) {}
            }
            return true
          }
        },
        {
          name: 'ghasts (larmes + longue-vue)',
          adv: ['balloon'],
          run: async () => {
            const tears = await S.huntGhastsForTears(bot, 4, 12)
            // longue-vue sur un ghast si améthyste dispo
            const md2 = mcData(bot)
            const amethyst = bot.findBlock({ matching: md2.blocksByName.amethyst_cluster?.id, maxDistance: 96 })
            if (amethyst) {
              await collectBlocks(bot, ['amethyst_cluster'], 2, { maxDistance: 96, maxMinutes: 2 })
              if (countItem(bot, 'copper_ingot') >= 2) {
                await craftItem(bot, 'spyglass', 1)
                const ghast = bot.nearestEntity((e) => e.name === 'ghast' && e.position.distanceTo(bot.entity.position) < 64)
                if (ghast) {
                  await equipName(bot, 'spyglass', 'hand')
                  await bot.lookAt(ghast.position)
                  await bot.activateItem()
                  await sleep(2500)
                  try { bot.deactivateItem() } catch {}
                  return tears
                }
              }
            }
            return tears
          }
        },
        { name: 'crânes de wither squelettes', adv: ['skull'], run: async () => huntMob(bot, ['wither_skeleton'], { until: () => countItem(bot, 'wither_skeleton_skull') >= 3, maxMinutes: 15 }) },
        { name: 'bastion (coffre)', adv: ['war_pigs', 'those_days'], run: async () => bastionAttempt(bot, progress) }
      ]
      await runTasks(bot, cfg, progress, 'Tour du Nether', tasks)
      // retour overworld
      const portalBack = bot.findBlock({ matching: md.blocksByName.nether_portal?.id, maxDistance: 128 })
      if (portalBack) {
        await goTo(bot, new GoalNear(portalBack.position.x, portalBack.position.y, portalBack.position.z, 0), { timeout: 120000, retries: 1 })
        await enterDimension(bot, 'overworld', 45000)
      }
    }
  }
}

// ---------- Atelier 3 : Wither & Beacon ----------

function wWitherBeacon () {
  return {
    key: 'atelier_wither',
    label: 'Wither & Beacon',
    run: async (bot, cfg, progress) => {
      const tasks = [
        {
          name: 'invoquer et tuer le Wither',
          adv: ['wither', 'beacon_home'],
          run: async () => {
            if (countItem(bot, 'wither_skeleton_skull') < 3) throw new Error('pas assez de crânes (grind long au Nether)')
            await collectBlocks(bot, ['soul_sand', 'soul_soil'], 4, { maxDistance: 128, maxMinutes: 3 })
            // T du wither : 2 étages de sable des âmes + 3 crânes
            const anchor = bot.entity.position.floored().offset(3, 0, 0)
            const plan = [
              { pos: anchor.offset(0, 0, 0), item: 'soul_sand' },
              { pos: anchor.offset(1, 0, 0), item: 'soul_sand' },
              { pos: anchor.offset(-1, 0, 0), item: 'soul_sand' },
              { pos: anchor.offset(0, 1, 0), item: 'soul_sand' },
              { pos: anchor.offset(0, 1, -1), item: 'soul_sand' },
              { pos: anchor.offset(0, 1, 1), item: 'soul_sand' },
              { pos: anchor.offset(1, 1, 0), item: 'wither_skeleton_skull' },
              { pos: anchor.offset(-1, 1, 0), item: 'wither_skeleton_skull' },
              { pos: anchor.offset(0, 2, 0), item: 'wither_skeleton_skull' }
            ]
            for (const step of plan) {
              const ref = findSolidNeighbor(bot, step.pos)
              if (!ref) continue
              try {
                await goTo(bot, new GoalNear(ref.position.x, ref.position.y, ref.position.z, 1), { timeout: 20000, retries: 0 })
                await equipName(bot, step.item, 'hand')
                await bot.placeBlock(ref, step.pos.minus(ref.position))
                await sleep(400)
              } catch (e) { log(`pose wither ratée : ${e.message}`) }
            }
            say(bot, '💀 Le Wither est invoqué… au combat !')
            await sleep(6000)
            const t0 = Date.now()
            while (Date.now() - t0 < 8 * 60000) {
              const wither = Object.values(bot.entities).find((e) => e.name === 'wither')
              if (!wither) break
              if (bot.health < 14) { await eatUntil(bot); await sleep(4000) }
              try {
                await equipBestSword(bot)
                await withTimeout(bot.pvp.attack(wither), 15000)
              } catch (e) { try { bot.pvp.stop() } catch {} }
              await sleep(500)
            }
            // beacon
            if (countItem(bot, 'nether_star') > 0) {
              await craftItem(bot, 'beacon', 1)
              await placeBlockFromInventory(bot, 'beacon')
              return true
            }
            throw new Error('pas d\'étoile du Nether')
          }
        },
        {
          name: 'pyramide du beacon (Beaconator)',
          adv: ['beaconator'],
          run: async () => {
            if (countItem(bot, 'beacon') === 0 && !mcData(bot).blocksByName.beacon) return false
            say(bot, '🗼 Beaconator : pyramide complète (164 blocs de fer !)')
            const need = 164
            const { branchMine } = require('./utils')
            if (countItem(bot, 'iron_ingot') < need * 9 && countItem(bot, 'iron_block') < need) {
              await digStaircase(bot, 16)
              await branchMine(bot, { y: 16, need: () => countItem(bot, 'raw_iron') >= need * 9, ores: ['iron_ore', 'deepslate_iron_ore'], extraOres: [], maxMinutes: 60 })
              await smeltItem(bot, 'raw_iron', 'iron_ingot', need * 9)
              await ascendTo(bot, 68)
            }
            await craftItem(bot, 'iron_block', need)
            // pyramide 9-7-5-3-1 (couches 81+49+25+9+1 = 165, on en fait 164 posables)
            const beaconPos = bot.entity.position.floored().offset(0, 4, 0)
            const layers = [9, 7, 5, 3, 1]
            const plan = []
            for (let l = 0; l < layers.length; l++) {
              const size = layers[l]
              const y = beaconPos.y - (layers.length - 1 - l)
              const off = Math.floor(size / 2)
              for (let dx = -off; dx <= off; dx++) {
                for (let dz = -off; dz <= off; dz++) {
                  if (l === layers.length - 1) continue // le beacon lui-même
                  plan.push(beaconPos.offset(dx - off, y - beaconPos.y, dz - off))
                }
              }
            }
            await placePlan(bot, plan, 'iron_block')
            await placeBlockFromInventory(bot, 'beacon')
            return true
          }
        }
      ]
      await runTasks(bot, cfg, progress, 'Wither & Beacon', tasks)
    }
  }
}

// ---------- Atelier 4 : L'End, acte II ----------

function wEndAgain () {
  return {
    key: 'atelier_end',
    label: 'L\'End, acte II',
    run: async (bot, cfg, progress) => {
      // 1. Fabriquer 4 cristaux de l'End
      say(bot, '🔮 Je fabrique 4 cristaux de l\'End')
      await collectBlocks(bot, ['sand'], 32, { maxDistance: 96, maxMinutes: 4 })
      await smeltItem(bot, 'sand', 'glass', 28)
      await craftItem(bot, 'ender_eye', 4)
      if (countItem(bot, 'ghast_tear') < 4) throw new Error('larmes de ghast manquantes (atelier Nether)')
      await craftItem(bot, 'end_crystal', 4)
      // 2. Retourner au stronghold puis dans l'End
      const room = progress.portalRoom
      if (!room) throw new Error('coordonnées du stronghold perdues')
      await goTo(bot, new GoalXZ(Math.round(room[0]), Math.round(room[2])), { timeout: 300000, retries: 1 })
      await digStaircase(bot, Math.max(10, room[1] - 5))
      const md = mcData(bot)
      const portalId = md.blocksByName.end_portal?.id
      let portal = bot.findBlock({ matching: portalId, maxDistance: 64 })
      if (!portal) { await explore(bot, 24); portal = bot.findBlock({ matching: portalId, maxDistance: 64 }) }
      if (!portal) throw new Error('portail de l\'End introuvable')
      await goTo(bot, new GoalNear(portal.position.x, portal.position.y, portal.position.z, 0), { timeout: 30000, retries: 1 })
      await enterDimension(bot, 'the_end', 45000)
      // 3. Placer les cristaux sur la fontaine
      say(bot, '💜 Je place les cristaux : le dragon revient !')
      const exitId = md.blocksByName.end_portal?.id
      const fountain = bot.findBlock({ matching: exitId, maxDistance: 200 })
      if (fountain) {
        await goTo(bot, new GoalNear(fountain.position.x, fountain.position.y + 3, fountain.position.z, 2), { timeout: 120000, retries: 0 })
        // 4 positions autour de la fontaine
        const spots = [
          fountain.position.offset(2, 3, 0), fountain.position.offset(-2, 3, 0),
          fountain.position.offset(0, 3, 2), fountain.position.offset(0, 3, -2)
        ]
        for (const spot of spots) {
          const support = bot.blockAt(spot.offset(0, -1, 0))
          if (!support) continue
          try {
            await equipName(bot, 'end_crystal', 'hand')
            await bot.activateBlock(support)
            await sleep(800)
          } catch (e) { log(`cristal raté : ${e.message}`) }
        }
        record(bot, ['end_again'], 'ok')
      }
      // 4. Tentatives pendant le combat : souffle + longue-vue
      const tasks = [
        {
          name: 'souffle du dragon en bouteille',
          adv: ['mint'],
          run: async () => {
            await craftItem(bot, 'glass_bottle', 3)
            const t0 = Date.now()
            while (Date.now() - t0 < 120000) {
              const dragon = Object.values(bot.entities).find((e) => e.name === 'ender_dragon')
              if (dragon && dragon.position.distanceTo(bot.entity.position) < 20) {
                try {
                  await equipName(bot, 'glass_bottle', 'hand')
                  await bot.activateItem()
                  await sleep(1500)
                } catch (e) {}
                if (countItem(bot, 'dragon_breath') > 0) return true
              }
              await sleep(2000)
            }
            return false
          }
        },
        {
          name: 'longue-vue sur le dragon',
          adv: ['plane'],
          run: async () => {
            if (countItem(bot, 'spyglass') === 0) return false
            const dragon = Object.values(bot.entities).find((e) => e.name === 'ender_dragon')
            if (!dragon) return false
            await equipName(bot, 'spyglass', 'hand')
            await bot.lookAt(dragon.position)
            await bot.activateItem()
            await sleep(3000)
            try { bot.deactivateItem() } catch {}
            return true
          }
        }
      ]
      await runTasks(bot, cfg, progress, 'End acte II', tasks)
      // 5. Tuer le dragon n°2 pour rouvrir la sortie
      const P1 = require('./phases')
      say(bot, '⚔️ Je re-tue le dragon pour rouvrir la sortie')
      try { await P1.fightDragon(bot) } catch (e) { log(`combat 2 : ${e.message}`) }
      // 6. Œuf du dragon (tentative piston)
      const tasks2 = [
        {
          name: 'œuf du dragon',
          adv: ['next_gen'],
          run: async () => {
            const md2 = mcData(bot)
            const egg = bot.findBlock({ matching: md2.blocksByName.dragon_egg?.id, maxDistance: 32 })
            if (!egg) return false
            await craftItem(bot, 'piston', 1)
            await craftItem(bot, 'redstone_torch', 1)
            // placer le piston face à l'œuf
            const side = egg.position.offset(1, 0, 0)
            const ref = findSolidNeighbor(bot, side)
            if (ref) {
              await goTo(bot, new GoalNear(side.x, side.y, side.z, 1), { timeout: 30000, retries: 0 })
              await equipName(bot, 'piston', 'hand')
              await bot.placeBlock(ref, side.minus(ref.position))
              // torche de redstone à côté du piston
              const torchSpot = side.offset(0, -1, 0)
              const ref2 = findSolidNeighbor(bot, torchSpot)
              if (ref2) {
                await equipName(bot, 'redstone_torch', 'hand')
                await bot.placeBlock(ref2, torchSpot.minus(ref2.position))
              }
              await sleep(3000)
              await collectNearbyItems(bot, 16, 10000)
              return countItem(bot, 'dragon_egg') > 0
            }
            return false
          }
        },
        {
          name: 'porte de l\'End (perle)',
          adv: ['remote', 'city', 'skys_limit', 'great_view'],
          run: async () => {
            const md2 = mcData(bot)
            const gateway = bot.findBlock({ matching: md2.blocksByName.end_gateway?.id, maxDistance: 128 })
            if (!gateway) return false
            if (countItem(bot, 'ender_pearl') === 0) throw new Error('plus de perles')
            await S.throwPearlAt(bot, gateway.position)
            record(bot, ['remote'], 'ok')
            // explorer les îles extérieures : villes de l'End + shulkers
            const t0 = Date.now()
            while (Date.now() - t0 < 10 * 60000) {
              const purpurId = md2.blocksByName.purpur_block?.id
              const city = bot.findBlocks({ matching: purpurId, maxDistance: 128, count: 2 })
              if (city.length) { record(bot, ['city'], 'ok'); break }
              const shulker = bot.nearestEntity((e) => e.name === 'shulker')
              if (shulker) {
                // se faire toucher par un shulker et flotter
                record(bot, ['great_view'], 'attempt')
                await goTo(bot, new GoalNear(shulker.position.x, shulker.position.y, shulker.position.z, 6), { timeout: 30000, retries: 0 })
                await sleep(15000) // flotter si touché
              }
              await explore(bot, 80)
            }
            return true
          }
        }
      ]
      await runTasks(bot, cfg, progress, 'End acte II (suite)', tasks2)
      // rentrer : sauter dans la sortie ou passer le portail
      const exitId2 = md.blocksByName.end_portal?.id
      const exit = bot.findBlock({ matching: exitId2, maxDistance: 256 })
      if (exit) {
        await goTo(bot, new GoalNear(exit.position.x, exit.position.y, exit.position.z, 0), { timeout: 180000, retries: 1 })
        await enterDimension(bot, 'overworld', 45000)
      }
    }
  }
}

// ---------- Atelier 5 : Chasse aux monstres ----------

const HUNT_LIST = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime', 'zombified_piglin',
  'magma_cube', 'husk', 'stray', 'cave_spider', 'silverfish', 'drowned', 'phantom', 'spider', 'endermite']

function wMonsters () {
  return {
    key: 'atelier_monstres',
    label: 'Monsters Hunted',
    run: async (bot, cfg, progress) => {
      say(bot, '👾 Chasse aux monstres de l\'Overworld')
      progress.mobsKilled ??= []
      const t0 = Date.now()
      for (const mob of HUNT_LIST) {
        if (progress.mobsKilled.includes(mob)) continue
        if (Date.now() - t0 > 25 * 60000) break
        try {
          const target = bot.nearestEntity((e) =>
            e.name === mob && e.isValid !== false &&
            e.position.distanceTo(bot.entity.position) < 48)
          if (!target) continue // absent de la zone : on passe vite
          await huntMob(bot, [mob], { until: () => target.isValid === false, maxMinutes: 4 })
          if (target.isValid === false) {
            progress.mobsKilled.push(mob)
            saveProgress(progress)
          }
        } catch (e) { /* suivant */ }
      }
      record(bot, ['monsters_hunted'], 'attempt')
      say(bot, `👾 Monstres tués : ${progress.mobsKilled.length}/${HUNT_LIST.length} (liste commune)`)
    }
  }
}

// ---------- Atelier 6 : Régime équilibré ----------

const DIET_FOODS = [
  'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit',
  'carrot', 'potato', 'baked_potato', 'beetroot', 'apple', 'golden_apple', 'melon_slice',
  'sweet_berries', 'honey_bottle', 'cookie', 'pumpkin_pie', 'cake', 'mushroom_stew',
  'rabbit_stew', 'beetroot_soup', 'dried_kelp', 'chorus_fruit', 'rotten_flesh', 'spider_eye',
  'cod', 'salmon', 'tropical_fish', 'pufferfish', 'poisonous_potato', 'suspicious_stew'
]

function wDiet () {
  return {
    key: 'atelier_diet',
    label: 'Régime équilibré',
    run: async (bot, cfg, progress) => {
      say(bot, '🍽️ A Balanced Diet : goûter un maximum de plats')
      progress.foodsEaten ??= []
      // viande crue : chasser puis cuire
      const hunts = [
        { mob: ['cow'], food: ['beef', 'cooked_beef'] },
        { mob: ['pig'], food: ['porkchop', 'cooked_porkchop'] },
        { mob: ['chicken'], food: ['chicken', 'cooked_chicken'] },
        { mob: ['sheep'], food: ['mutton', 'cooked_mutton'] },
        { mob: ['rabbit'], food: ['rabbit', 'cooked_rabbit'] },
        { mob: ['zombie'], food: ['rotten_flesh', 'carrot', 'potato'] },
        { mob: ['spider'], food: ['spider_eye'] }
      ]
      for (const h of hunts) {
        try {
          await huntMob(bot, h.mob, { until: () => h.food.some((f) => countItem(bot, f) > 0), maxMinutes: 4 })
        } catch (e) {}
      }
      // cuire la viande
      for (const raw of ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit']) {
        if (countItem(bot, raw) > 0) {
          try { await smeltItem(bot, raw, 'cooked_' + raw, countItem(bot, raw)) } catch (e) {}
        }
      }
      if (countItem(bot, 'potato') > 0) { try { await smeltItem(bot, 'potato', 'baked_potato', 1) } catch (e) {} }
      // plats à crafter
      const recipes = [
        ['bread', 1], ['cookie', 1], ['pumpkin_pie', 1], ['cake', 1],
        ['mushroom_stew', 1], ['rabbit_stew', 1], ['beetroot_soup', 1], ['suspicious_stew', 1]
      ]
      for (const [item, n] of recipes) {
        try { await craftItem(bot, item, n) } catch (e) {}
      }
      // manger tout ce qui est comestible dans la liste
      let eaten = 0
      for (const food of DIET_FOODS) {
        if (progress.foodsEaten.includes(food)) { eaten++; continue }
        try {
          const ok = await S.eatItem(bot, food, 1)
          if (ok) { progress.foodsEaten.push(food); eaten++; saveProgress(progress) }
        } catch (e) {}
        await sleep(300)
      }
      say(bot, `🍽️ Plats goûtés : ${progress.foodsEaten.length}/${DIET_FOODS.length}`)
      record(bot, ['balanced_diet'], 'attempt')
    }
  }
}

module.exports = { wAventureOverworld, wNether, wWitherBeacon, wEndAgain, wMonsters, wDiet, runTasks }
