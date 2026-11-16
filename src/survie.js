// ============================================================
// LibreBot — src/survie.js
// Watchdog de survie permanent : faim, armure, bouclier, fuite
// des monstres quand la vie est basse, lave/feu, noyade.
// ============================================================
const {
  Vec3, log, say, sleep, goTo, GoalNear, GoalXZ,
  countItem, eatUntil, equipShield, equipBestSword, shootWithBow, withTimeout,
  placeBlockFromInventory, mcData
} = require('./utils')
const { loadProgress } = require('./mission')
const learn = require('./learn')

// Mobs qu'il vaut mieux abattre à distance (jamais au corps à corps)
const DANGEROUS_MELEE = ['creeper', 'ghast', 'wither']
const RANGED_MOBS = ['skeleton', 'stray', 'creeper', 'witch', 'pillager', 'vindicator', 'evoker', 'phantom', 'blaze', 'ghast', 'wither', 'drowned']

// Combat intelligent : arc à distance contre les mobs dangereux, corps à corps sinon
async function fightSmart (bot, hostile) {
  const dist = hostile.position.distanceTo(bot.entity.position)
  const hasBow = countItem(bot, 'bow') > 0 && countItem(bot, 'arrow') > 0
  await equipShield(bot)
  if (RANGED_MOBS.includes(hostile.name)) {
    if (hasBow && dist >= 4) {
      try { await shootWithBow(bot, hostile, 3); learn.recordSkill('tir_arc', true); return } catch {}
    }
    if (DANGEROUS_MELEE.includes(hostile.name)) {
      // kiting : si le mob est collé, on recule en le frappant
      if (dist < 6) {
        bot.setControlState('back', true)
        setTimeout(() => bot.setControlState('back', false), 1000)
        await equipBestSword(bot)
        try { await withTimeout(bot.pvp.attack(hostile), 6000) } catch {}
      }
      return // on ne le finit pas au corps à corps
    }
  }
  await equipBestSword(bot)
  try { await withTimeout(bot.pvp.attack(hostile), 15000); learn.recordSkill('combat', true) } catch {}
}

const HOSTILES = [
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager',
  'vindicator', 'evoker', 'ravager', 'hoglin', 'blaze', 'ghast', 'wither',
  'phantom', 'drowned', 'husk', 'stray', 'zombie_villager', 'piglin',
  'piglin_brute', 'zombified_piglin', 'magma_cube', 'slime', 'guardian',
  'elder_guardian', 'vex', 'warden', 'breeze'
]

const DANGER_BLOCKS = ['lava', 'magma_block', 'fire', 'campfire', 'soul_campfire', 'soul_fire']

function nearestHostile (bot, maxDist) {
  let best = null
  let bestD = maxDist
  for (const e of Object.values(bot.entities)) {
    if (!HOSTILES.includes(e.name)) continue
    if (e.isValid === false) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}

function countHostiles (bot, maxDist) {
  let n = 0
  for (const e of Object.values(bot.entities)) {
    if (!HOSTILES.includes(e.name) || e.isValid === false) continue
    if (e.position.distanceTo(bot.entity.position) < maxDist) n++
  }
  return n
}

function hasWeapon (bot) {
  if (countItem(bot, 'bow') > 0 && countItem(bot, 'arrow') > 0) return true
  return ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
    'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe', 'mace', 'trident']
    .some((w) => countItem(bot, w) > 0)
}

function isNight (bot) {
  const t = bot.time?.timeOfDay ?? 0
  return t >= 13000 && t <= 23000
}

// Fuit vers la base si connue, sinon à l'opposé du danger
async function fleeFrom (bot, threatPos) {
  const p = loadProgress()
  if (p.home && Array.isArray(p.home)) {
    log('🏃 Je fuis vers la base !')
    await goTo(bot, new GoalNear(p.home[0], p.home[1], p.home[2], 4), { timeout: 30000, retries: 0 })
    return
  }
  if (threatPos) {
    const dir = bot.entity.position.minus(threatPos)
    if (dir.lengthSq() > 0.001) {
      dir.normalize()
      const away = bot.entity.position.plus(dir.scale(20))
      log('🏃 Je fuis le danger !')
      await goTo(bot, new GoalXZ(away.x, away.z), { timeout: 15000, retries: 0 })
    }
  }
}

function startSurvivalWatch (bot) {
  if (bot._survivalTimer) clearInterval(bot._survivalTimer)
  // armure dès le spawn
  try { bot.armorManager?.equipAll?.() } catch {}
  let lastFlee = 0
  let lastTorch = 0
  let busy = false
  bot._survivalTimer = setInterval(async () => {
    if (busy) return // un tick de survie est déjà en cours (fuite, repas…)
    busy = true
    try {
      if (!bot.entity || !bot.entity.position) return
      const md = mcData(bot)

      // 1. armure : rééquiper le meilleur set de temps en temps
      if (Math.random() < 0.01) { try { bot.armorManager?.equipAll?.() } catch {} }

      // 2. bouclier en off-hand dès qu'on en a un
      if (countItem(bot, 'shield') > 0) {
        const off = bot.inventory.slots[45]
        if (!off || off.name !== 'shield') await equipShield(bot)
      }

      // 3. faim : manger dès que ça baisse (prioritaire, même en mission)
      if (bot.food < 17) await eatUntil(bot, 19)

      // 4. danger environnemental : lave/feu sous les pieds → sauter en arrière
      const feet = bot.entity.position.floored()
      const below = bot.blockAt(feet.offset(0, -1, 0))
      const atFeet = bot.blockAt(feet)
      if ((below && DANGER_BLOCKS.includes(below.name)) || (atFeet && DANGER_BLOCKS.includes(atFeet.name))) {
        log('🔥 Danger sous les pieds — je recule !')
        bot.setControlState('back', true)
        bot.setControlState('jump', true)
        setTimeout(() => { bot.setControlState('back', false); bot.setControlState('jump', false) }, 1200)
        return
      }

      // 5. noyade : remonter à la surface
      if ((bot.oxygenLevel ?? 20) < 6) {
        const waterId = md.blocksByName.water?.id
        const inWater = bot.blockAt(feet)?.type === waterId || bot.blockAt(feet.offset(0, 1, 0))?.type === waterId
        if (inWater) {
          bot.setControlState('jump', true)
          setTimeout(() => bot.setControlState('jump', false), 1500)
          return
        }
      }

      // 6. monstres hostiles : riposter si on peut, fuir sinon
      // le seuil de fuite est appris : il augmente si le bot est mort en combattant
      const fleeThreshold = learn.getFleeThreshold()
      const pvpBusy = !!bot.pvp?.target
      const hostile = nearestHostile(bot, 18)
      if (hostile) {
        const dist = hostile.position.distanceTo(bot.entity.position)
        const hostilesNear = countHostiles(bot, 12)
        const veryLow = bot.health <= Math.min(5, fleeThreshold - 3)
        const lowHp = bot.health <= fleeThreshold
        // défense active prioritaire : un seul hostile, on a une arme, on a assez de vie
        if (!veryLow && bot.health > fleeThreshold && hasWeapon(bot) && hostilesNear <= 1 && dist < 16 && !pvpBusy && Date.now() - lastFlee > 8000) {
          log(`⚔️ J'engage ${hostile.name} (${Math.round(bot.health)} ❤)`)
          await fightSmart(bot, hostile)
          return
        }
        // sinon fuir si la vie est basse
        if ((lowHp || (isNight(bot) && bot.health <= fleeThreshold - 2)) && Date.now() - lastFlee > 15000) {
          lastFlee = Date.now()
          bot._fleeing = true
          const hpAtFlee = bot.health
          say(bot, `😨 ${hostile.name} me menace (${Math.round(bot.health)} ❤) — je fuis !`)
          try {
            await eatUntil(bot, 20)
            await fleeFrom(bot, hostile.position)
            await eatUntil(bot, 20)
            learn.recordFlee(true, hpAtFlee, hostile.name)
            learn.recordSkill('fuite', true)
          } finally {
            bot._fleeing = false
          }
          return
        }
      }
      // 7. torches : allumer dès que l'obscurité totale permet les spawns de monstres
      if (Date.now() - lastTorch > 6000 && countItem(bot, 'torch') > 0) {
        const here = bot.blockAt(feet)
        if (here && here.light === 0) {
          lastTorch = Date.now()
          log('🔥 J\'allume une torche (zone sombre)')
          try { await placeBlockFromInventory(bot, 'torch') } catch {}
        }
      }
    } catch (e) { /* le watchdog ne doit jamais tuer la mission */ } finally {
      busy = false
    }
  }, 1000)
  log('🛡️ Watchdog de survie actif')
  return bot._survivalTimer
}

module.exports = { startSurvivalWatch, nearestHostile, HOSTILES, isNight }
