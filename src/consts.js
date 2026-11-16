// ============================================================
// LibreBot — src/consts.js
// Constantes partagées (mobs hostiles, blocs dangereux).
// Module sans dépendance interne pour éviter les cycles d'import.
// ============================================================
const HOSTILES = [
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager',
  'vindicator', 'evoker', 'ravager', 'hoglin', 'blaze', 'ghast', 'wither',
  'phantom', 'drowned', 'husk', 'stray', 'zombie_villager', 'piglin',
  'piglin_brute', 'zombified_piglin', 'magma_cube', 'slime', 'guardian',
  'elder_guardian', 'vex', 'warden', 'breeze'
]

const DANGER_BLOCKS = ['lava', 'magma_block', 'fire', 'campfire', 'soul_campfire', 'soul_fire']

module.exports = { HOSTILES, DANGER_BLOCKS }
