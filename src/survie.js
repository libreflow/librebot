// ============================================================
// LibreBot — src/survie.js
// Watchdog de survie permanent : faim, armure, bouclier, fuite
// des monstres quand la vie est basse, lave/feu, noyade.
// ============================================================
const {
  Vec3, log, say, chat, sleep, goTo, GoalNear, GoalXZ,
  countItem, hasAnyItem, eatUntil, equipShield, equipBestSword, shootWithBow, withTimeout, huntMob,
  placeBlockFromInventory, mcData, lootSingleChest, isChestLooted
} = require('./utils')
// loadProgress d'advancements (caché en mémoire) plutôt que celui de mission.js
// qui fait un readFileSync à chaque appel — ici appelé à chaque fuite
const { loadProgress } = require('./advancements')
const learn = require('./learn')
const { logThrottle } = require('./chat')
const decision = require('./decision')


// ---------- Contre-mesures par type de mob ----------
// Chaque mob a sa stratégie optimale apprise
const MOB_COUNTERS = {
  creeper:   { strategy: 'FUIR', reason: 'explose — jamais au corps à corps', minDist: 8 },
  ghast:     { strategy: 'KITING', reason: 'boulet de feu — arc à distance', minDist: 20 },
  wither:    { strategy: 'FUIR', reason: 'aura de dégâts + explosions', minDist: 15 },
  skeleton:  { strategy: 'KITING', reason: 'flèches — arc ou bouclier', minDist: 10 },
  stray:     { strategy: 'KITING', reason: 'flèches de glace', minDist: 10 },
  witch:     { strategy: 'FOCUS', reason: 'potions de dégâts — focus rapide', minDist: 4 },
  spider:    { strategy: 'MELEE', reason: 'saute sur le joueur — épée + recul', minDist: 2 },
  zombie:    { strategy: 'MELEE', reason: 'lent — épée facile', minDist: 2 },
  husk:     { strategy: 'MELEE', reason: 'lent, dégâts moyens', minDist: 2 },
  drowned:   { strategy: 'MELEE', reason: 'trident parfois — bouclier', minDist: 3 },
  enderman:  { strategy: 'KITING', reason: 'se téléporte — arc ou fuite', minDist: 8 },
  blaze:     { strategy: 'KITING', reason: 'boules de feu — arc', minDist: 12 },
  phantom:   { strategy: "KITING", reason: "plonge du ciel — arc en l'air", minDist: 10 },
  ravager:   { strategy: 'FUIR', reason: 'gros dégâts de zone', minDist: 10 },
  evoker:    { strategy: 'FOCUS', reason: 'crocs — tuer vite', minDist: 4 },
  vindicator:{ strategy: 'MELEE', reason: 'hache rapide — bouclier + épée', minDist: 2 },
  pillager:  { strategy: 'KITING', reason: 'arbalète — arc', minDist: 12 },
  hoglin:    { strategy: 'FUIR', reason: 'charge puissante', minDist: 10 },
  warden:    { strategy: 'FUIR', reason: 'SONAR + one-shot — fuir à tout prix', minDist: 20 },
  breeze:    { strategy: 'MELEE', reason: 'souffle de vent — épée rapide', minDist: 2 },
  magma_cube: { strategy: 'MELEE', reason: 'petit et lent', minDist: 2 },
  slime:     { strategy: 'MELEE', reason: 'petit et lent', minDist: 2 }
}
function counterFor (mobName) {
  return MOB_COUNTERS[mobName] ?? { strategy: 'MELEE', reason: 'stratégie par défaut', minDist: 2 }
}

// Mobs qu'il vaut mieux abattre à distance (jamais au corps à corps)
// Sets pour O(1) : le watchdog tourne à 1 Hz et parcourt toutes les entités,
// un includes() sur 28 éléments × 200 entités = 5600 comparaisons par tick
const DANGEROUS_MELEE = new Set(['creeper', 'ghast', 'wither'])
const RANGED_MOBS = new Set(['skeleton', 'stray', 'creeper', 'witch', 'pillager', 'vindicator', 'evoker', 'phantom', 'blaze', 'ghast', 'wither', 'drowned'])

// Combat intelligent : arc à distance contre les mobs dangereux, corps à corps sinon
async function fightSmart (bot, hostile) {
  if (hostile.isValid === false) return
  const dist = hostile.position.distanceTo(bot.entity.position)
  const hasBow = countItem(bot, 'bow') > 0 && countItem(bot, 'arrow') > 0
  await equipShield(bot)
  const counter = counterFor(hostile.name)
  learn.recordSkill('counter:' + hostile.name, true)

  // Creeper / Wither / Warden / Ravager / Hoglin → JAMAIS au corps à corps, fuir si trop proche
  if (counter.strategy === 'FUIR' && dist < counter.minDist) {
    log('🏃 ' + hostile.name + ' trop proche (' + Math.round(dist) + 'm) — ' + counter.reason)
    bot.setControlState('back', true)
    bot.setControlState('jump', true)
    setTimeout(() => { try { bot.setControlState('back', false); bot.setControlState('jump', false) } catch {} }, 1200)
    if (hasBow) { try { await shootWithBow(bot, hostile, 2) } catch {} }
    return
  }
  // Kiting : arc à distance, reculer si le mob approche
  if (counter.strategy === 'KITING' && hasBow) {
    if (dist < counter.minDist) {
      bot.setControlState('back', true)
      setTimeout(() => { try { bot.setControlState('back', false) } catch {} }, 800)
    }
    try { await shootWithBow(bot, hostile, 3); learn.recordSkill('tir_arc', true); return } catch {}
  }
  // Focus : tuer vite (witch, evoker)
  if (counter.strategy === 'FOCUS') {
    await equipBestSword(bot)
    try { await withTimeout(bot.pvp.attack(hostile), 8000) } catch {}
    return
  }
  // Mêlée par défaut
  await equipBestSword(bot)
  try { await withTimeout(bot.pvp.attack(hostile), 15000); learn.recordSkill('combat', true) } catch {}
}

const HOSTILES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager',
  'vindicator', 'evoker', 'ravager', 'hoglin', 'blaze', 'ghast', 'wither',
  'phantom', 'drowned', 'husk', 'stray', 'zombie_villager', 'piglin',
  'piglin_brute', 'zombified_piglin', 'magma_cube', 'slime', 'guardian',
  'elder_guardian', 'vex', 'warden', 'breeze'
])

const DANGER_BLOCKS = new Set(['lava', 'magma_block', 'fire', 'campfire', 'soul_campfire', 'soul_fire'])

function nearestHostile (bot, maxDist) {
  if (!bot.entity?.position) return null
  // bot.nearestEntity est optimisé côté mineflayer (parcours interne sans allocation)
  return bot.nearestEntity((e) =>
    HOSTILES.has(e.name) && e.isValid !== false &&
    e.position.distanceTo(bot.entity.position) < maxDist)
}

function countHostiles (bot, maxDist) {
  if (!bot.entity?.position) return 0
  // for...in direct sur bot.entities : évite l'allocation d'un tableau par Object.values
  let n = 0
  const pos = bot.entity.position
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!HOSTILES.has(e.name) || e.isValid === false) continue
    if (e.position.distanceTo(pos) < maxDist) n++
  }
  return n
}

// un seul parcours d'inventaire (l'ancien faisait jusqu'à 11 countItem = 11 parcours)
const MELEE_WEAPONS = new Set(['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
  'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe', 'mace', 'trident'])
function hasWeapon (bot) {
  let bow = 0, arrow = 0
  for (const i of bot.inventory.items()) {
    if (i.name === 'bow') bow += i.count
    else if (i.name === 'arrow') arrow += i.count
    else if (MELEE_WEAPONS.has(i.name)) return true
  }
  return bow > 0 && arrow > 0
}

function isNight (bot) {
  const t = bot.time?.timeOfDay ?? 0
  return t >= 13000 && t <= 23000
}

// Fuit vers la base si connue, sinon à l'opposé du danger
// (les monstres à distance → on ajoute une composante latérale pour casser la ligne de vue)
async function fleeFrom (bot, threatPos, threatName = null) {
  const p = loadProgress()
  if (p.home && Array.isArray(p.home)) {
    log('🏃 Je fuis vers la base !')
    await goTo(bot, new GoalNear(p.home[0], p.home[1], p.home[2], 4), { timeout: 30000, retries: 0, force: true })
    return
  }
  if (threatPos) {
    const dir = bot.entity.position.minus(threatPos)
    if (dir.lengthSq() > 0.001) {
      dir.normalize()
      let away = bot.entity.position.plus(dir.scale(40))
      if (threatName && RANGED_MOBS.has(threatName)) {
        const perp = new Vec3(-dir.z, 0, dir.x)
        away = away.plus(perp.scale(Math.random() < 0.5 ? 14 : -14))
      }
      log('🏃 Je fuis le danger !')
      await goTo(bot, new GoalXZ(away.x, away.z), { timeout: 20000, retries: 0, force: true })
    }
  }
}

// ---------- Réaction INSTANTANÉE aux dégâts (event 'damage') ----------
// Ne pas attendre le watchdog périodique : dès qu'un dégât arrive, on réagit.
let _lastDamageReact = 0
let _panicTimer = null
// Stoppe le timer de panique (appelé à la déconnexion : sinon il tourne à 400 ms
// indéfiniment sur un bot mort tant que sa dernière vie < 17)
function stopPanic () {
  if (_panicTimer) { clearInterval(_panicTimer); _panicTimer = null }
}
async function reactDamage (bot) {
  const now = Date.now()
  if (now - _lastDamageReact < 700) return // cooldown anti-spam (un coup = parfois 2 events)
  _lastDamageReact = now
  if (!bot.entity?.position) return
  const hp = bot.health
  const hostile = nearestHostile(bot, 18)
  // 1. VIE CRITIQUE (<= 12) : soin immédiat, prioritaire sur tout le reste
  if (hp <= 12) {
    logThrottle('crit', '❤️ VIE CRITIQUE (' + Math.round(hp) + '/20) — je me soigne immédiatement', 3000)
    try { await withTimeout(eatUntil(bot, 20), 4000) } catch {}
  }
  // 2. Hostile proche + vie basse (<= 16) : FUITE immédiate (passe le mutex, urgence)
  if (hostile && hp <= 16) {
    const d = Math.round(hostile.position.distanceTo(bot.entity.position))
    logThrottle('dmgflee', '😨 ' + hostile.name + ' à ' + d + 'm, vie ' + Math.round(hp) + '/20 — fuite immédiate !', 3000)
    bot._fleeing = true
    fleeFrom(bot, hostile.position, hostile.name).catch(() => {})
    setTimeout(() => { bot._fleeing = false }, 5000)
  }
  // 3. Tant que vie < 17 : timer rapide (400 ms) qui soigne en continu et re-fuit
  if (hp < 17 && !_panicTimer) {
    _panicTimer = setInterval(async () => {
      try {
        if (!bot.entity?.position || bot.health >= 17) { clearInterval(_panicTimer); _panicTimer = null; return }
        if (bot.food >= 8) await withTimeout(eatUntil(bot, 20), 2500).catch(() => {})
        const h = nearestHostile(bot, 12)
        if (h && bot.health <= 14) {
          bot._fleeing = true
          setTimeout(() => { bot._fleeing = false }, 4000)
        }
      } catch {}
    }, 400)
  }
}

function startSurvivalWatch (bot) {
  if (bot._survivalTimer) clearInterval(bot._survivalTimer)
  // armure dès le spawn + totem auto si dispo
  try { bot.armorManager?.equipAll?.() } catch {}
  try { bot.autototem?.equip?.() } catch {}
  let lastFlee = 0
  let lastTorch = 0
  let lastChestLoot = 0 // anti-spam : max 1 fouille de coffre toutes les 20 s
  let busy = false
  bot._survivalTimer = setInterval(async () => {
    if (busy) return // un tick de survie est déjà en cours (fuite, repas…)
    busy = true
    try {
      if (!bot.entity || !bot.entity.position) return
      const md = mcData(bot)

      // 1. armure : rééquiper le meilleur set de temps en temps
      if (Math.random() < 0.01) { try { bot.armorManager?.equipAll?.() } catch {}; try { bot.autototem?.equip?.() } catch {} }

      // 2. bouclier en off-hand dès qu'on en a un
      if (countItem(bot, 'shield') > 0) {
        const off = bot.inventory.slots[45]
        if (!off || off.name !== 'shield') await equipShield(bot)
      }

      // 3. faim : manger dès que ça baisse (prioritaire, même en mission)
      if (bot.food < 19) await eatUntil(bot, 20)

      // 4. danger environnemental : lave/feu sous les pieds → sauter en arrière
      const feet = bot.entity.position.floored()
      const below = bot.blockAt(feet.offset(0, -1, 0))
      const atFeet = bot.blockAt(feet)
      if ((below && DANGER_BLOCKS.has(below.name)) || (atFeet && DANGER_BLOCKS.has(atFeet.name))) {
        chat(bot, 'dangerBlock', { block: (below?.name ?? atFeet?.name ?? 'feu') }, { force: true })
        log('🔥 Danger sous les pieds — je recule !')
        bot.setControlState('back', true)
        bot.setControlState('jump', true)
        setTimeout(() => { try { bot.setControlState('back', false); bot.setControlState('jump', false) } catch {} }, 1200)
        return
      }

      // 5. noyade : remonter à la surface
      if ((bot.oxygenLevel ?? 300) < 60) {
        const waterId = md.blocksByName.water?.id
        const inWater = bot.blockAt(feet)?.type === waterId || bot.blockAt(feet.offset(0, 1, 0))?.type === waterId
        if (inWater) {
          chat(bot, 'drowning', {}, { force: true })
          bot.setControlState('jump', true)
          setTimeout(() => { try { bot.setControlState('jump', false) } catch {} }, 1500)
          return
        }
      }

      // 5b. chute libre : si on tombe vite avec du vide dessous, poser un bloc sous soi
      const velY = bot.entity.velocity?.y ?? 0
      if (velY < -0.6 && !bot.entity.onGround) {
        let h = 0
        for (let dy = -1; dy >= -8; dy--) {
          const b = bot.blockAt(feet.offset(0, dy, 0))
          if (b && !['air', 'cave_air', 'water', 'lava'].includes(b.name)) break
          h++
        }
        if (h >= 5) {
          const solid = bot.inventory.items().find((i) =>
            ['cobblestone', 'dirt', 'netherrack', 'end_stone', 'stone', 'andesite', 'granite', 'diorite'].includes(i.name) || i.name.endsWith('_planks'))
          if (solid) {
            chat(bot, 'fall', {}, { force: true })
            log('🪂 Chute détectée — je pose un bloc pour amortir !')
            try { await placeBlockFromInventory(bot, solid.name) } catch {}
          }
        }
      }

      // 6. Décision centralisée : le cerveau évalue la situation globale
      // (danger, faim, opportunité, objectif) et choisit l'action prioritaire,
      // enrichie par la Q-table apprise et la mémoire épisodique.
      const hostile = nearestHostile(bot, 18)
      const hostilesNear = hostile ? countHostiles(bot, 12) : 0
      const hostileDist = hostile ? hostile.position.distanceTo(bot.entity.position) : null
      const armed = hasWeapon(bot)
      const hasBow = countItem(bot, 'bow') > 0 && countItem(bot, 'arrow') > 0
      const pvpBusy = !!bot.pvp?.target

      // Opportunité : coffre ou minerai rare visible à proximité
      let opportunity = null
      let opportunityValue = 0
      let chestBlock = null // bloc coffre à fouiller si l'opportunité est retenue
      if (!hostile || hostileDist > 15) {
        const md = mcData(bot)
        const chestIds = ['chest', 'trapped_chest', 'barrel', 'shulker_box']
          .map((n) => md.blocksByName[n]?.id).filter(Boolean)
        if (chestIds.length) {
          // guard : matching undefined matcherait tous les blocs
          const chest = bot.findBlock({ matching: chestIds, maxDistance: 16 })
          if (chest && !isChestLooted(chest.position)) {
            chestBlock = chest
            opportunity = 'coffre à ' + Math.round(chest.position.distanceTo(bot.entity.position)) + ' blocs'
            opportunityValue = 80 + (learn.skillLevel('fouille_coffre') > 0.5 ? 40 : 0) // plus on maîtrise, plus ça vaut
          }
        }
        if (!opportunity) {
          const diamondId = md.blocksByName.diamond_ore?.id ?? md.blocksByName.deepslate_diamond_ore?.id
          if (diamondId) {
            const ore = bot.findBlock({ matching: diamondId, maxDistance: 24 })
            if (ore) { opportunity = 'minerai de diamant visible'; opportunityValue = 150 }
          }
        }
      }

      // Évaluer la situation avec le cerveau de décision
      const dec = decision.evaluate(bot, {
        hostile, hostileDist, hostilesNear, armed, hasBow,
        hasFood: countItem(bot, 'cooked_beef') > 0 || bot.food > 10,
        missionActive: true,
        opportunity, opportunityValue
      })

      // Suggestion apprise dans des situations similaires (throttlée : sinon spam à chaque tick du watchdog)
      const learned = learn.bestActionInSimilarSituations(dec.state)
      if (learned && learned.n >= 3 && Math.abs(learned.avg) > 0.3) {
        logThrottle('learned-suggestion', '🧠 Situation similaire vue ' + learned.n + ' fois : ' + learned.action + ' a marché (score ' + learned.avg.toFixed(2) + ')', 60000)
      }

      // 📦 OPPORTUNITE coffre : le cerveau a retenu un coffre proche → on va le fouiller
      // (compétence apprise : recordSkill + épisode Q-learning + POI looted_chest)
      if (dec.action === 'OPPORTUNITE' && chestBlock && (!hostile || hostileDist > 12) && Date.now() - lastChestLoot > 20000) {
        lastChestLoot = Date.now()
        const dist = Math.round(chestBlock.position.distanceTo(bot.entity.position))
        log('📦 Opportunité retenue : je fouille le coffre à ' + dist + ' blocs (score ' + dec.score + ')')
        chat(bot, 'chestFound', { dist }, { force: true })
        try {
          await goTo(bot, new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2), { timeout: 20000, retries: 0, force: true })
          const fresh = bot.blockAt(chestBlock.position) ?? chestBlock
          const n = await lootSingleChest(bot, fresh)
          log('📦 Coffre vidé : +' + n + ' items (compétence fouille_coffre niveau ' + Math.round(learn.skillLevel('fouille_coffre') * 100) + '%)')
          learn.completeEpisode(n > 0 ? 1 : 0.3, 'fouille coffre à ' + dist + 'm : +' + n + ' items')
        } catch (e) {
          learn.recordSkill('fouille_coffre', false)
          learn.completeEpisode(-0.5, 'fouille coffre ratée : ' + e.message)
          log('📦 fouille ratée : ' + e.message)
        }
        return
      }

      if (dec.action === 'FUITE' && hostile && Date.now() - lastFlee > 6000) {
        lastFlee = Date.now()
        bot._fleeing = true
        const hpAtFlee = bot.health
        const healthBefore = bot.health
        chat(bot, 'flee', { mob: hostile.name, hp: Math.round(bot.health) }, { force: true })
        say(bot, '😨 Décision FUITE (score ' + dec.score + ') : ' + dec.reason)
        try {
          await eatUntil(bot, 20)
          await fleeFrom(bot, hostile.position, hostile.name)
          await eatUntil(bot, 20)
          learn.recordFlee(true, hpAtFlee, hostile.name)
          learn.recordSkill('fuite', true)
          const survived = bot.health > 0
          const reward = survived && bot.health >= healthBefore ? 1 : (survived ? 0.3 : -1)
          learn.completeEpisode(reward, 'fuite vs ' + hostile.name + ', vie ' + Math.round(healthBefore) + '→' + Math.round(bot.health))
        } finally {
          bot._fleeing = false
        }
        return
      }

      if ((dec.action === 'MONSTRE_FAIBLE' || dec.action === 'COMBAT_MORTEL') && hostile && !pvpBusy && Date.now() - lastFlee > 8000) {
        const healthBefore = bot.health
        chat(bot, 'engage', { mob: hostile.name, hp: Math.round(bot.health) }, { force: true })
        log('⚔️ Décision COMBAT (score ' + dec.score + ') : ' + dec.reason)
        await fightSmart(bot, hostile)
        if (hostile.isValid === false) {
          const lost = healthBefore - bot.health
          const reward = lost < 4 ? 1 : (lost < 10 ? 0.5 : -0.5)
          learn.completeEpisode(reward, 'combat vs ' + hostile.name + ', perdu ' + Math.round(lost) + ' PV')
        } else {
          learn.completeEpisode(0, 'combat vs ' + hostile.name + ' inachevé')
        }
        return
      }

      // Kiting : tirer à l'arc en reculant
      if (dec.action === 'KITING' && hostile && hasBow && hostileDist >= 4 && hostileDist <= 30) {
        const healthBefore = bot.health
        chat(bot, 'kite', { mob: hostile.name, dist: Math.round(hostileDist) }, { force: true })
        log('🏹 Décision KITING (score ' + dec.score + ') : ' + dec.reason)
        await equipShield(bot)
        bot.setControlState('back', true)
        try { await shootWithBow(bot, hostile, 2) } catch {}
        setTimeout(() => { try { bot.setControlState('back', false) } catch {} }, 1500)
        if (hostile.isValid === false) {
          const lost = healthBefore - bot.health
          learn.completeEpisode(lost < 3 ? 1 : 0, 'kiting vs ' + hostile.name)
        }
        return
      }

      if (dec.action === 'SE_SOIGNER' && bot.health < 14 && !hostile) {
        chat(bot, 'lowHp', { hp: Math.round(bot.health) })
        logThrottle('soigner', '❤️ Vie ' + Math.round(bot.health) + '/20 — je me soigne (' + dec.reason + ')', 5000)
        const foodBefore = bot.food
        await withTimeout(eatUntil(bot, 20), 5000).catch(() => {})
        // Pas de nourriture mangeable (inventaire vide/illisible ou plus rien) :
        // se soigner est impossible -> on fuit pour régénérer naturellement et
        // on chasse un animal en urgence (faim >= 18 requis pour régénérer).
        const anyFood = ['cooked_beef','beef','cooked_porkchop','porkchop','cooked_mutton','mutton','cooked_chicken','chicken','bread','apple','carrot','potato','baked_potato','rotten_flesh','spider_eye','poisonous_potato','pufferfish','chorus_fruit'].reduce((n, f) => n + countItem(bot, f), 0)
        if (anyFood === 0 && bot.food < 18) {
          logThrottle('chasse', '🥩 Plus rien à manger (vie ' + Math.round(bot.health) + ', faim ' + Math.round(bot.food) + ') — je fuis et je chasse en urgence', 10000)
          bot._fleeing = true
          const h = nearestHostile(bot, 24)
          if (h) fleeFrom(bot, h.position, h.name).catch(() => {})
          setTimeout(() => { bot._fleeing = false }, 8000)
          try {
            await withTimeout(huntMob(bot, ['cow', 'pig', 'sheep', 'chicken'], { until: () => bot.food >= 18 || bot.health >= 18, maxMinutes: 3 }), 200000)
          } catch {}
        }
        learn.completeEpisode(0.5, 'soin préventif')
        return
      }
      // 7. torches : allumer dès que la lumière est basse (les monstres spawnent sous 7)
      if (Date.now() - lastTorch > 6000 && countItem(bot, 'torch') > 0) {
        const here = bot.blockAt(feet)
        if (here && (here.light ?? 15) < 7) {
          lastTorch = Date.now()
          log('🔥 J\'allume une torche (zone sombre)')
          try { await placeBlockFromInventory(bot, 'torch') } catch {}
        }
      }
    } catch (e) { /* le watchdog ne doit jamais tuer la mission */ } finally {
      busy = false
    }
  }, 1500)
  log('🛡️ Watchdog de survie actif')
  return bot._survivalTimer
}

module.exports = { startSurvivalWatch, nearestHostile, countHostiles, fightSmart, reactDamage, stopPanic, HOSTILES, isNight }
