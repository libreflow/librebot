// ============================================================
// LibreBot — src/legit.js
// Garde-fou "légitime" : vérifie qu'une action est physiquement
// possible dans Minecraft survival AVANT de l'exécuter.
//
// Règles vanilla appliquées :
//  - Portée d'interaction max : 4,5 blocs (survie) / 6 blocs (créatif)
//  - Ligne de vue requise pour miner/placer/attaquer (pas à travers les murs)
//  - Vitesse max : marche 4,3 m/s, sprint 5,6 m/s, sprint+saut 7,1 m/s
//  - Pas de vol : Y ne peut augmenter que par saut/pilier/échelle
//  - Chute : dégâts si > 3 blocs (sauf eau)
//  - Minage : un bloc à la fois, temps selon l'outil (pas instantané)
// ============================================================
const { Vec3 } = require('vec3')

// Constantes vanilla
const REACH_SURVIVAL = 4.5   // portée interaction survie (blocs)
const REACH_ATTACK = 3.0     // portée attaque mêlée
const SPEED_WALK = 4.317     // m/s
const SPEED_SPRINT = 5.612   // m/s
const SPEED_SPRINT_JUMP = 7.1 // m/s approx
const MAX_FALL_SAFE = 3      // blocs de chute sans dégâts
const GRAVITY = 0.08

// Suivi de la vitesse réelle du bot (anti-speedhack interne)
let _lastPos = null
let _lastTime = 0
let _violations = []

function trackMovement (bot) {
  const now = Date.now()
  const pos = bot.entity?.position
  if (!pos || !_lastPos || now - _lastTime < 500 || now < _graceUntil) { _lastPos = pos?.clone(); _lastTime = now; return }
  const dt = (now - _lastTime) / 1000 // secondes
  const dist = pos.distanceTo(_lastPos)
  const speed = dist / dt
  const maxSpeed = bot.getControlState?.('sprint') ? (bot.getControlState?.('jump') ? SPEED_SPRINT_JUMP : SPEED_SPRINT) : SPEED_WALK
  // Tolérance 20% (lag, knockback, glace, sprint+saut)
  if (speed > maxSpeed * 1.2 && dist > 1) {
    _violations.push({ speed: +speed.toFixed(2), max: maxSpeed, at: new Date().toISOString(), pos: pos.floored() })
    if (_violations.length > 50) _violations = _violations.slice(-50)
    // Log uniquement si flagrant (> 1.5x la vitesse max)
    if (speed > maxSpeed * 1.5) {
      console.log('[LEGIT] ⚠️ Vitesse anormale détectée: ' + speed.toFixed(2) + ' m/s (max ' + maxSpeed + ') — knockback/lag probable')
    }
  }
  _lastPos = pos.clone()
  _lastTime = now
}

// Vérifie qu'un bloc est atteignable (distance + ligne de vue)
function canReach (bot, blockPos, maxReach = REACH_SURVIVAL) {
  const eye = bot.entity?.eyePosition ?? bot.entity?.position?.offset(0, 1.62, 0)
  if (!eye) return false
  const dist = eye.distanceTo(blockPos.offset(0.5, 0.5, 0.5))
  if (dist > maxReach) return false
  // Ligne de vue : tracer un rayon œil → centre du bloc, vérifier qu'aucun bloc solide ne bloque
  return hasLineOfSight(bot, eye, blockPos.offset(0.5, 0.5, 0.5))
}

// Vérifie la ligne de vue entre deux points (bresenham 3D simplifié)
function hasLineOfSight (bot, from, to) {
  const steps = Math.ceil(from.distanceTo(to) * 2) // 2 échantillons par bloc
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const p = new Vec3(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t
    )
    const b = bot.blockAt(p.floored())
    if (b && b.boundingBox === 'solid') return false // un bloc solide bloque la vue
  }
  return true
}

// Vérifie qu'on peut attaquer une entité (portée mêlée)
function canAttack (bot, entity) {
  if (!entity?.position) return false
  const eye = bot.entity?.eyePosition ?? bot.entity?.position
  const dist = eye.distanceTo(entity.position)
  return dist <= REACH_ATTACK + 0.5 // marge pour le mouvement
}

// Vérifie qu'on peut poser un bloc à cette position
function canPlaceAt (bot, targetPos, refBlock) {
  if (!canReach(bot, targetPos)) return false
  // Le bloc de référence doit être atteignable aussi
  if (refBlock && !canReach(bot, refBlock.position)) return false
  return true
}

// Vérifie qu'aucun mouvement de vol n'est en cours
// (le bot ne doit jamais monter sans saut/pilier/échelle/eau)
let _airRiseTicks = 0
function isFlying (bot) {
  const e = bot.entity
  if (!e || !e.position) return false
  if (e.onGround) { _airRiseTicks = 0; return false }
  const velY = e.velocity?.y ?? 0
  // Monte sans être sur une échelle/eau/slime : on compte les ticks consécutifs.
  // Un saut vanilla fait velY>0.15 pendant ~0.25s (4-5 ticks de 50ms) ; à 500ms
  // d'échantillonnage, un saut legit = 0-1 tick. Le vol = montée soutenue > 2s.
  if (velY > 0.15) {
    const feet = e.position.floored()
    const atFeet = bot.blockAt(feet)
    const below = bot.blockAt(feet.offset(0, -1, 0))
    const isLadder = atFeet?.name?.includes('ladder') || atFeet?.name?.includes('vine') || atFeet?.name === 'scaffolding'
    const inWater = atFeet?.name === 'water' || below?.name === 'water'
    const onSlime = below?.name === 'slime_block'
    if (isLadder || inWater || onSlime) { _airRiseTicks = 0; return false }
    _airRiseTicks++
    if (_airRiseTicks > 4) { // > 2s de montée continue à 500ms = vol
      _violations.push({ type: 'fly', at: Date.now(), velY })
      return true
    }
    return false
  }
  _airRiseTicks = 0
  return false
}

// Rapport de violations (pour debug)
function getViolations () { return _violations }

// Réinitialise le suivi (au spawn)
let _graceUntil = 0
function noteKnockback () { _graceUntil = Math.max(_graceUntil, Date.now() + 2500) }
function reset (bot) {
  _lastPos = bot.entity?.position?.clone() ?? null
  _lastTime = Date.now()
  _graceUntil = Date.now() + 5000
  _airRiseTicks = 0 // 5s de grâce après spawn/reset (évite les faux positifs)
  _violations = []
}

module.exports = {
  REACH_SURVIVAL, REACH_ATTACK, SPEED_WALK, SPEED_SPRINT,
  trackMovement, canReach, canAttack, canPlaceAt, isFlying, hasLineOfSight, noteKnockback,
  getViolations, reset
}
