// ============================================================
// LibreBot — src/physique.js
// Physique fidèle à un joueur en survie : le bot subit la gravité,
// les collisions, les dégâts de chute (calculés par le serveur à partir
// des positions envoyées) et les poussées (paquet entity_velocity),
// exactement comme un joueur vanilla.
//
// Le cœur est la physique locale de mineflayer (prismarine-physics) :
// à chaque tick elle intègre bot.entity.velocity (qui reçoit les
// poussées du serveur via entity_velocity), applique la gravité et les
// collisions, puis écrit le résultat dans bot.entity. Il faut donc :
//   1. physicsEnabled = true (fait dans createBot + ici par sécurité)
//   2. envoyer au serveur les paquets position/position_look calculés
//      localement (comportement client vanilla) — on ne les bloque PLUS
//   3. depuis 1.21.2, envoyer player_input + tick_end à chaque tick
//      (le serveur n'accepte qu'un paquet de mouvement par tick)
// ============================================================
const { Vec3 } = require('vec3')

// bloc solide plein : prismarine-block renvoie 'block' (jamais 'solid')
const isSolidBlock = (b) => !!b && (b.boundingBox === 'block' || b.boundingBox === 'solid')

const VOID_BLOCKS = new Set(['air', 'cave_air', 'void_air'])
// gravité vanilla : 0.08 bloc/tick², vitesse terminale de chute -3.92 blocs/tick
const GRAVITY = 0.08
const TERMINAL_VELOCITY = -3.92

function installPhysics (bot, versionAtLeast, log = () => {}) {
  // physique locale (prismarine-physics) active : gravité + collisions +
  // vélocité reçue du serveur (poussées, explosions, knockback)
  bot.physicsEnabled = true

  // Protocole >= 1.21.2 : player_input (les contrôles du joueur) puis
  // tick_end à chaque tick de physique. On ne bloque AUCUN paquet de
  // mouvement (position, position_look, look, flying passent) : comme un
  // vrai client vanilla, le serveur valide notre position simulée et
  // renvoie une correction (paquet "position" entrant) en cas de divergence,
  // que mineflayer applique à bot.entity.
  if (versionAtLeast(bot.version, '1.21.2')) {
    bot.on('physicsTick', () => {
      try {
        bot._client.write('player_input', {
          inputs: {
            forward: !!bot.getControlState('forward'),
            backward: !!bot.getControlState('back'),
            left: !!bot.getControlState('left'),
            right: !!bot.getControlState('right'),
            jump: !!bot.getControlState('jump'),
            shift: !!bot.getControlState('sneak'),
            sprint: !!bot.getControlState('sprint')
          }
        })
      } catch {}
      try { bot._client.write('tick_end', {}) } catch {}
    })
  }

  // Ceinture de sécurité anti-flottement : si la physique locale ne tourne
  // pas (shouldUsePhysics pas encore activé, ex : juste après le spawn) et
  // que le bot est immobile dans le vide, on applique nous-mêmes la gravité
  // vanilla avec collision au sol — il tombe alors comme un joueur.
  // (Quand la physique locale tourne, vel.y devient non nul en un tick :
  // ce watchdog ne se déclenche jamais.)
  let floatSince = 0
  let falling = false // true = le watchdog applique lui-même la gravité
  const timer = setInterval(() => {
    try {
      const e = bot.entity
      if (!e || !e.position || !Number.isFinite(e.position.x)) return
      if (e.onGround) { floatSince = 0; falling = false; return }
      const feet = e.position.floored()
      if (!bot.blockAt(feet)) return // chunk non chargé : on ne sait pas ce qu'il y a dessous
      if (!falling) {
        // détection du flottement : du vide sous les pieds et vélocité nulle
        let voidDepth = 0
        for (let dy = 0; dy >= -4 && voidDepth < 4; dy--) {
          const b = bot.blockAt(feet.offset(0, dy, 0))
          if (!b || VOID_BLOCKS.has(b.name)) voidDepth++
          else break
        }
        if (voidDepth < 3) { floatSince = 0; return }
        const velY = e.velocity?.y ?? 0
        if (Math.abs(velY) >= 0.001) return // la physique locale tourne déjà : on la laisse faire
        const now = Date.now()
        if (!floatSince) floatSince = now
        if (now - floatSince <= 300) return // délai de grâce : peut-être un tick transitoire
        falling = true
        log('🪂 chute libre détectée — gravité vanilla appliquée par le watchdog')
      }
      // watchdog actif : un tick de gravité vanilla toutes les 50 ms,
      // jusqu'à la collision avec le sol (comme un joueur qui tombe)
      e.velocity.y = Math.max((e.velocity?.y ?? 0) - GRAVITY, TERMINAL_VELOCITY)
      const nextY = e.position.y + e.velocity.y
      const ground = bot.blockAt(new Vec3(e.position.x, Math.floor(nextY), e.position.z))
      if (isSolidBlock(ground)) {
        // pas de pénétration dans le sol : on remonte au sommet du premier
        // bloc solide (le pas de chute peut faire plus d'un bloc à vitesse terminale)
        let gy = Math.floor(nextY)
        while (gy < 320 && isSolidBlock(bot.blockAt(new Vec3(e.position.x, gy, e.position.z)))) gy++
        e.position.y = gy
        e.velocity.y = 0
        e.onGround = true
        falling = false
        floatSince = 0
      } else {
        e.position.y = nextY
        e.onGround = false
      }
    } catch {}
  }, 100) // 10 Hz suffisent : la physique locale prismarine fait le vrai travail à 20 Hz
  bot._physicsTimer = timer
  return timer
}

module.exports = { installPhysics, GRAVITY, TERMINAL_VELOCITY }
