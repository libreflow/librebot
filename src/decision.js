// ============================================================
// LibreBot — src/decision.js
// Cerveau centralisé de prise de décision.
//
// Au lieu de règles if/else rigides éparpillées, ce module évalue
// la situation globale du bot (danger, faim, opportunité, objectif)
// et produit une décision pondérée : quelle action a la plus haute
// priorité MAINTENANT, et pourquoi.
//
// Il s'appuie sur learn.js pour la mémoire épisodique (situations
// similaires rencontrées avant) et le Q-learning (quelles décisions
// ont payé dans des contextes similaires).
// ============================================================
const learn = require('./learn')
let vision = null
try { vision = require('./vision') } catch {}

// ---------- Constantes de priorité ----------
// Plus le score est haut, plus l'action est prioritaire.
const PRIORITY = {
  MOURIR: 1000,      // bot va mourir dans les prochaines secondes
  LAVE_FEU: 900,     // lave/feu sous les pieds
  NOYADE: 850,       // plus d'air
  CHUTE: 800,        // chute libre dangereuse
  FAIM_CRITIQUE: 700,// faim < 6 → régénération lente, risque de mort
  COMBAT_MORTEL: 600,// monstre qui peut tuer en 1-2 coups
  FUITE: 500,        // danger sérieux mais pas immédiat
  SE_SOIGNER: 450,   // vie basse, se soigner avant de continuer
  OPPORTUNITE: 300,  // coffre/minerai rare à portée
  MONSTRE_FAIBLE: 200,// monstre qu'on peut tuer facilement
  MISSION: 100,      // continuer la phase en cours
  IDLE: 10           // rien de spécial
}

// ---------- Évaluation de la situation ----------

// Construit un "état" normalisé de la situation actuelle.
// Utilisé à la fois pour la décision immédiate et comme clé de
// mémoire épisodique (situations similaires).
function buildState (bot, context = {}) {
  const pos = bot.entity?.position?.floored() ?? { x: 0, y: 0, z: 0 }
  const health = Math.round(bot.health ?? 20)
  const food = Math.round(bot.food ?? 20)
  const oxygen = bot.oxygenLevel ?? 300
  const tod = bot.time?.timeOfDay ?? 0
  const isNight = tod >= 13000 && tod <= 23000
  const dim = bot.game?.dimension ?? 'overworld'
  const y = pos.y

  return {
    health: bucketize(health, [0, 4, 8, 12, 16, 20]),
    food: bucketize(food, [0, 6, 12, 18, 20]),
    oxygen: oxygen < 60 ? 'low' : 'ok',
    night: isNight,
    dim,
    yLevel: y < -40 ? 'deep' : y < 0 ? 'low' : y < 60 ? 'surface' : 'high',
    hostilesNear: context.hostilesNear ?? 0,
    hostileDist: context.hostileDist != null ? bucketize(context.hostileDist, [0, 5, 10, 18, 48]) : 'none',
    armed: context.armed ?? false,
    hasFood: context.hasFood ?? true,
    inDanger: context.inDanger ?? false,
    missionActive: context.missionActive ?? false,
    phaseKey: context.phaseKey ?? null,
    biome: context.biome ?? 'unknown',
    structures: context.structures ?? [],
    resourcesNear: context.resourcesNear ?? 0
  }
}

function bucketize (value, thresholds) {
  for (const t of thresholds) {
    if (value <= t) return String(t)
  }
  return String(thresholds[thresholds.length - 1])
}

// ---------- Scoring des actions possibles ----------

// Évalue chaque action candidate et retourne un score de priorité.
// Le score combine : urgence vitale + contexte appris (Q-value).
function scoreAction (action, state, bot, context) {
  let base = PRIORITY[action] ?? 0

  switch (action) {
    case 'MOURIR':
      base = PRIORITY.MOURIR - (state.health === '20' ? 500 : 0)
      break
    case 'LAVE_FEU':
      base = PRIORITY.LAVE_FEU
      break
    case 'FUITE':
      base += learn.getQBonus('FUITE', state) * 100
      if (state.food === '0' || state.food === '6') base -= 150
      break
    case 'COMBAT_MORTEL':
    case 'MONSTRE_FAIBLE':
      base += learn.getQBonus('COMBAT_MORTEL', state) * 100
      if (state.night && state.hostilesNear > 1) base -= 200
      if (!state.armed) base = -1000
      break
    case 'KITING':
      base = 350 + learn.getQBonus('KITING', state) * 100
      if (!context.hasBow) base = -1000
      break
    case 'SE_SOIGNER':
      base = PRIORITY.SE_SOIGNER + (state.food === '0' ? -300 : 0)
      if (state.hostileDist === 'none') base -= 100
      break
    case 'OPPORTUNITE':
      base = PRIORITY.OPPORTUNITE + (context.opportunityValue ?? 0)
      if (state.hostilesNear > 0 && state.hostileDist !== 'none' && parseInt(state.hostileDist) <= 10) base -= 400
      break
    case 'MISSION':
      base = PRIORITY.MISSION
      if (state.hostilesNear > 0) base -= state.hostilesNear * 50
      break
  }

  return base
}

// ---------- Décision principale ----------

// evaluate(bot, context) → { action, score, reason, state }
// Retourne la meilleure action à entreprendre MAINTENANT.
function evaluate (bot, context = {}) {
  const state = buildState(bot, context)
  const candidates = []

  // 1. Urgences vitales
  const feet = bot.entity?.position?.floored()
  if (feet) {
    const below = bot.blockAt(feet.offset(0, -1, 0))
    const atFeet = bot.blockAt(feet)
    if ((below && ['lava', 'magma_block', 'fire', 'campfire'].includes(below.name)) ||
        (atFeet && ['lava', 'fire'].includes(atFeet.name))) {
      candidates.push({ action: 'LAVE_FEU', reason: 'danger ' + (below?.name ?? atFeet?.name) + ' sous les pieds' })
    }
  }

  if ((bot.oxygenLevel ?? 300) < 60) {
    candidates.push({ action: 'NOYADE', reason: 'oxygen ' + bot.oxygenLevel })
  }

  const velY = bot.entity?.velocity?.y ?? 0
  if (velY < -0.6 && bot.entity && !bot.entity.onGround && feet) {
    let voidDepth = 0
    for (let dy = -1; dy >= -8; dy--) {
      const b = bot.blockAt(feet.offset(0, dy, 0))
      if (b && !['air', 'cave_air', 'water', 'lava'].includes(b.name)) break
      voidDepth++
    }
    if (voidDepth >= 5) candidates.push({ action: 'CHUTE', reason: 'chute libre, ' + voidDepth + ' blocs de vide' })
  }

  if ((bot.health ?? 20) <= 2) {
    candidates.push({ action: 'MOURIR', reason: 'vie critique ' + Math.round(bot.health) })
  }

  if ((bot.food ?? 20) <= 5) {
    candidates.push({ action: 'FAIM_CRITIQUE', reason: 'faim ' + Math.round(bot.food) })
  }

  // 2. Menaces hostiles
  if (context.hostile) {
    const dist = context.hostileDist ?? 18
    const hostilesNear = context.hostilesNear ?? 1
    const armed = context.armed ?? false
    const hasBow = context.hasBow ?? false
    const health = bot.health ?? 20
    const wellEquipped = context.wellEquipped ?? false

    if (health <= 6 && hostilesNear > 0) {
      candidates.push({ action: 'FUITE', reason: 'vie ' + Math.round(health) + ' vs ' + hostilesNear + ' hostile(s)' })
    }
    if (!armed && hostilesNear > 0 && dist < 10) {
      candidates.push({ action: 'FUITE', reason: 'pas armé, ' + hostilesNear + ' hostile(s) à ' + Math.round(dist) })
    }
    // bien équipé + vie correcte : on se bat, même à 3-4 hostiles ;
    // on ne fuit à l'outnumber que mal équipé, blessé, ou submergé
    if (hostilesNear > 2 && (!wellEquipped || health < 10 || hostilesNear > 4)) {
      candidates.push({ action: 'FUITE', reason: hostilesNear + ' hostiles proches' + (wellEquipped ? ' (+overwhelm)' : '') })
    }
    if (armed && health > 8 && (wellEquipped ? hostilesNear <= 4 : hostilesNear <= 2) && dist < 16) {
      if (dist <= 6 && hostilesNear === 1) {
        candidates.push({ action: 'MONSTRE_FAIBLE', reason: context.hostile.name + ' à ' + Math.round(dist) + ' blocs, vie ' + Math.round(health) })
      } else {
        candidates.push({ action: 'COMBAT_MORTEL', reason: context.hostile.name + ' à ' + Math.round(dist) + ' blocs' })
      }
    }
    if (hasBow && dist >= 4 && dist <= 30 && health > 6) {
      candidates.push({ action: 'KITING', reason: context.hostile.name + ' à ' + Math.round(dist) + ' blocs — arc + recul' })
    }
  }

  // 3. Se soigner si vie basse mais pas de danger immédiat
  if ((bot.health ?? 20) < 14 && (context.hostilesNear ?? 0) === 0 && (bot.food ?? 20) > 6) {
    candidates.push({ action: 'SE_SOIGNER', reason: 'vie ' + Math.round(bot.health) + ', se régénérer' })
  }

  // 4. Opportunités
  if (context.opportunity) {
    candidates.push({
      action: 'OPPORTUNITE',
      reason: context.opportunity,
      opportunityValue: context.opportunityValue ?? 50
    })
  }

  // 4b. Opportunités basées sur l'environnement scanné (vision)
  if (vision && !context.opportunity) {
    const env = vision.getEnv()
    // Ressource de haute valeur proche
    const good = env.resources.find(r => r.value >= 100 && r.dist <= 32)
    if (good) {
      candidates.push({ action: 'OPPORTUNITE', reason: good.kind + ' à ' + good.dist + ' blocs (valeur ' + good.value + ')', opportunityValue: good.value })
    }
    // Structure reconnue proche
    if (env.structures.length && env.dangers.length === 0) {
      candidates.push({ action: 'OPPORTUNITE', reason: 'structure ' + env.structures[0] + ' détectée', opportunityValue: 120 })
    }
  }

  // 5. Mission en cours (fallback)
  candidates.push({ action: 'MISSION', reason: context.missionActive ? 'phase ' + (context.phaseKey ?? '?') : 'idle' })

  // Scorer toutes les candidates et choisir la meilleure
  let best = { action: 'IDLE', score: PRIORITY.IDLE, reason: 'rien de spécial', state }
  for (const c of candidates) {
    const score = scoreAction(c.action, state, bot, context)
    if (score > best.score) {
      best = { action: c.action, score, reason: c.reason, state, opportunityValue: c.opportunityValue }
    }
  }

  // Mémoriser l'épisode pour l'apprentissage (sera complété par le résultat)
  learn.recordEpisode(state, best.action)

  return best
}

// ---------- Arbitrage mission vs survie ----------

// Quand la mission et le watchdog veulent des choses différentes,
// cette fonction décide qui a la priorité.
module.exports = { evaluate, buildState, PRIORITY, scoreAction }
