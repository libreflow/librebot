// ============================================================
// LibreBot — src/chat.js
// Système de messages chat amélioré.
//
// Au lieu d'un say() qui filtre bêtement par emoji, ce module :
//  - Propose plusieurs formulations pour chaque situation (anti-répétition)
//  - Adapte le ton (déterminé, cool, paniqué selon le contexte)
//  - Anti-spam intelligent : pas deux messages similaires en < 30 s
//  - Messages proactifs occasionnels (le bot commente ce qu'il fait)
//  - Storytelling pour les moments clés (phases, morts, découvertes)
//  - Toujours log() dans la console, chat serveur seulement si pertinent
// ============================================================

// ---------- Tables de variations de messages ----------
// Chaque catégorie a plusieurs templates. {var} est remplacé par les données.
const MESSAGES = {
  // Début/fin de phase
  phaseStart: [
    '━━━ ▶ {label} ━━━',
    'C\'est parti pour : {label} ! ━━━',
    'Nouvelle étape : {label} ━━━',
    'On attaque {label} ! ━━━'
  ],
  phaseDone: [
    '✅ {label} terminée ({done}/{total})',
    `✅ {label} : c'est fait ! ({done}/{total})`,
    '✅ Etape {label} validée ({done}/{total})',
    '✅ {label} OK — {done}/{total} phases'
  ],
  phaseFail: [
    '⚠️ {label} : échec ({error}){retry}',
    '⚠️ Problème sur {label} : {error}{retry}',
    '⚠️ {label} a coincé ({error}){retry}'
  ],
  phaseBlocked: [
    '⛔ {label} bloquée après {attempts} essais. "reprendre" pour retenter.',
    `⛔ J'arrive pas à finir {label} ({attempts} essais). Dis "reprendre" !`,
    '⛔ {label} résiste... {attempts} tentatives. "reprendre" pour insister.'
  ],

  // Survie / danger
  flee: [
    '😨 {mob} me menace ({hp} ❤) — je fuis !',
    '😨 {mob} à proximité, {hp} PV... je me tire !',
    '😨 Trop dangereux ({mob}, {hp} ❤) — fuite !',
    '😨 {mob} ! {hp} ❤... je recule vite !'
  ],
  dangerBlock: [
    '🔥 {block} sous mes pieds — je saute !',
    '🔥 Au secours, du {block} ! Je recule !'
  ],
  drowning: [
    `💧 Je manque d'air — je remonte !`,
    `💧 Noyade ! Je sors de l'eau !`
  ],
  fall: [
    '🪂 Chute détectée — je pose un bloc !',
    `🪂 Oh la chute... j'amortis !`
  ],
  death: [
    '☠️ Je suis mort... je reviens !',
    '☠️ Mort ({cause}). Respawn dans 1,5 s !',
    '☠️ Down ! ({cause}) — je respawn.'
  ],
  lowHp: [
    '❤️ {hp} PV... je me soigne !',
    '❤️ Plus que {hp} ❤ — je mange !'
  ],

  // Combat
  engage: [
    `⚔️ J'engage {mob} ({hp} ❤) !`,
    '⚔️ {mob}... à moi ! ({hp} ❤)',
    '⚔️ On va voir qui est le plus fort, {mob} !'
  ],
  kite: [
    `🏹 {mob} à {dist} blocs — tir à l'arc !`,
    '🏹 Je garde mes distances avec {mob} ({dist} m)'
  ],
  kill: [
    '💀 {mob} éliminé !',
    '💀 {mob} au sol !',
    '⚔️ {mob} vaincu !'
  ],

  // Exploration / découvertes
  foundTree: [
    '🌲 Arbre repéré à {dist} blocs !',
    '🌲 Il y a du bois par là ({dist} m) !'
  ],
  foundOre: [
    '⛏️ Du {ore} en vue ! ({dist} blocs)',
    '⛏️ Minerai de {ore} détecté à {dist} m !',
    '💎 {ore} ! Je vais le chercher !'
  ],
  explore: [
    `🧭 J'explore vers ({x}, {z})...`,
    '🧭 Je vais voir par là ({x}, {z})'
  ],
  chestFound: [
    `📦 Un coffre ! Je vais voir ce qu'il contient !`,
    '📦 Coffre repéré à {dist} blocs !'
  ],

  // Minage / récolte
  mining: [
    '⛏️ Je mine {count} bloc(s) à {dist} m',
    '⛏️ Minage en cours ({count} blocs)...',
    '⛏️ Je casse ça ({count} blocs) !'
  ],
  collected: [
    '⛏️ +{mined} minés, total {got}/{count}',
    `⛏️ {got}/{count} récoltés pour l'instant`,
    '📦 Inventaire : {got}/{count}'
  ],
  noBlocks: [
    `🔍 Aucun bloc {names} à portée... j'explore !`,
    '🔍 Rien de ça par ici ({names}), je cherche ailleurs'
  ],

  // Craft / fonte
  crafting: [
    '🔨 Je craft {count}× {item}',
    '🔨 Fabrication de {item}...'
  ],
  smelting: [
    '🔥 Fonte en cours... ({out})',
    '🔥 Le four chauffe ! ({out} en préparation)'
  ],

  // Construction
  building: [
    '🏠 Je construis ici...',
    '🏠 Construction en cours !'
  ],
  built: [
    '🏠 Base construite en ({x}, {y}, {z}) !',
    '🏠 Ma maison est prête ! ({x}, {y}, {z})'
  ],
  portalBuilt: [
    '🔥 Portail allumé ! Direction le Nether !',
    '🔥 Le portail est prêt ! 🌋'
  ],

  // Dimensions
  enterNether: [
    '🌋 Bienvenue au Nether !',
    '🌋 Hop, direction le Nether !'
  ],
  enterEnd: [
    `🌌 Bienvenue dans l'End !`,
    `🌌 L'End... me voilà !`
  ],
  backOverworld: [
    `🌍 De retour dans l'overworld !`,
    '🌍 Retour à la surface !'
  ],

  // Mission globale
  missionStart: [
    '🚀 Mission lancée ! Objectif : le dragon !',
    `🚀 C'est parti pour la grande aventure !`
  ],
  serverSwitch: [
    'Je change de serveur, à tout de suite !',
    'Reconnexion sur un autre serveur…',
    'On se retrouve ailleurs !'
  ],
  fallback: [
    'Le serveur local ne répond plus, je tente l\'autre serveur…',
    'Connexion perdue ici, j\'essaie ailleurs !',
    'Ce serveur dort, je bascule de cible.'
  ],
  watchdog: [
    'Petit blocage de ma part, je me relance proprement.',
    'Je viens de me réinitialiser, on repart !'
  ],
  deathStreak: [
    'Je me fais massacrer ici… je vais attendre le jour bien à l\'abri.',
    'Trop de morts d\'affilée, je joue la prudence jusqu\'au matin.',
    'Mode survie : j\'attends le lever du soleil planqué.'
  ],
  miningDeep: [
    'Je creuse profond, j\'espère trouver quelque chose !',
    'En minage…',
    'Je gratte la roche, patience.'
  ],
  ocean: [
    'Trop d\'eau autour, je nage vers la côte.',
    'Je cherche la terre ferme…'
  ],
  missionDone: [
    '🏆 MISSION ACCOMPLIE ! Le dragon est vaincu !',
    '🏆🏆🏆 DRAGON MORT ! On a gagné !',
    `🏆 Le dragon de l'End est tombé ! GG !`
  ],

  // Commandes / interaction
  follow: [
    '👣 Je te suis, {user} ! ("arrête suivre" pour lâcher)',
    '👣 OK {user}, je te colle aux basques !'
  ],
  stopFollow: [
    `🛑 J'arrête de suivre.`,
    '🛑 OK, je te lâche !'
  ],
  pause: [
    '⏸️ En pause. "reprendre" pour relancer.',
    '⏸️ Pause ! Dis "reprendre" quand tu veux.'
  ],
  resume: [
    `▶️ C'est reparti !`,
    '▶️ Reprise !'
  ],
  notFound: [
    'Je ne te vois pas, {user} !',
    '👀 {user} ? Tu es où ?'
  ],

  // Proactifs (le bot commente spontanément, max 1 toutes les 2-5 min)
  proactive: [
    'Bon, {action}...',
    'Allez, {action} !',
    `{action}, c'est parti.`,
    'On continue : {action}...'
  ],

  // Erreurs
  error: [
    '💥 Erreur : {error}',
    '💥 Oups... {error}',
    '💥 Problème : {error}'
  ],

  // Succès / stats
  status: [
    '📊 {done}/{total} phases faites. Prochaine : {next}',
    '📊 Progression : {done}/{total} — encore {next} !'
  ],
  inventory: [
    '🎒 {inv} — faim {food}/20, vie {hp}/20',
    '🎒 Inventaire : {inv} | 🍗{food} ❤️{hp}'
  ],
  coords: [
    '📍 ({x}, {y}, {z}) — {dim}',
    '📍 Je suis en ({x}, {y}, {z}), dimension {dim}'
  ]
}

// Catégories qui passent toujours dans le chat serveur (pas de filtre)
const ALWAYS_CHAT = new Set([
  'phaseStart', 'phaseDone', 'phaseBlocked', 'missionDone', 'death',
  'enterNether', 'enterEnd', 'portalBuilt', 'built', 'flee',
  'follow', 'stopFollow', 'pause', 'resume', 'error', 'status'
])

// ---------- Filtre de sécurité des sorties chat ----------
// Le bot ne doit JAMAIS envoyer d'insulte, même si une erreur brute ou un texte
// interpolé contient un terme offensant : on bloque et on log localement.
const INSULT_RE = /\b(connard|salope|salop|pute|putain|merde|encul|ta\s*gueuele|d[ée]bile|cr[ée]tin|imb[ée]cile|minable|batard|bâtar|nique\s+ta\s+m[èe]re)/i
function safeChat (bot, msg) {
  const text = String(msg ?? '')
  if (INSULT_RE.test(text)) {
    log('🚫 [chat-filtre] message sortant bloqué (contenu offensant) : ' + text.slice(0, 120))
    return false
  }
  bot.chat(text)
  return true
}

// ---------- Anti-spam ----------
let _lastChatByCat = {} // cat -> timestamp
let _lastChatMsg = ''
const MIN_INTERVAL_MS = 30000 // 30 s entre deux messages de même catégorie
const MIN_INTERVAL_GLOBAL = 5000 // 5 s entre deux messages chat quelconques
let _lastGlobalChat = 0

// ---------- Personnalité ----------
// Le ton s'adapte au contexte : paniqué si danger, déterminé si mission, cool sinon
const TONE = {
  panic: ['😨', '💥', '☠️'],
  determined: ['⚔️', '🚀', '🔥', '💪'],
  chill: ['😎', '👌', '✨', '🌿'],
  excited: ['🎉', '🏆', '🌟', '🔥']
}

// ---------- Moteur de rendu ----------
function pick (category, data = {}) {
  const templates = MESSAGES[category]
  if (!templates) return null
  const tpl = templates[Math.floor(Math.random() * templates.length)]
  return tpl.replace(/\{(\w+)\}/g, (m, key) => data[key] ?? m)
}

// ---------- API publique ----------

// chat(bot, category, data, { force }) — envoie un message dans le chat serveur
// si la catégorie est importante ou forcée, et respecte l'anti-spam.
// Retourne le message rendu (ou null si non envoyé).
function chat (bot, category, data = {}, { force = false } = {}) {
  const msg = pick(category, data)
  if (!msg) return null
  const now = Date.now()

  // Anti-spam
  if (!force && !ALWAYS_CHAT.has(category)) {
    if (now - (_lastChatByCat[category] ?? 0) < MIN_INTERVAL_MS) return null
    if (now - _lastGlobalChat < MIN_INTERVAL_GLOBAL) return null
    if (msg === _lastChatMsg) return null
  }
  if (ALWAYS_CHAT.has(category)) {
    if (now - _lastGlobalChat < 2000 && !force) return null // même les importants ont un mini-délai
  }

  _lastChatByCat[category] = now
  _lastGlobalChat = now
  _lastChatMsg = msg

  try { safeChat(bot, msg) } catch {}
  return msg
}

// say(bot, msg) — compatible avec l'ancien système : log console + chat si le message
// contient un marqueur important (emoji de phase/succès/danger)
const CHAT_IMPORTANT = [/━━━/, /✅/, /⛔/, /🏆/, /☠️/, /😨/, /👣/, /🛑/, /💥/, /🔄/, /⏸️/, /▶️/, /📊/, /🌌/, /🌋/, /🌍/, /⚔️/, /🏹/, /💀/, /🔥/, /🏠/, /🚀/, /⛏️/, /📦/, /🌲/, /🧭/, /❤️/, /💧/, /🪂/, /🔨/]
function say (bot, msg) {
  log(msg)
  if (process.env.LIBREBOT_CHAT_VERBOSE) { try { safeChat(bot, String(msg)) } catch {}; return }
  const now = Date.now()
  if (now - _lastGlobalChat < MIN_INTERVAL_GLOBAL) return // anti-spam même pour say()
  try {
    if (CHAT_IMPORTANT.some((r) => r.test(msg))) {
      _lastGlobalChat = now
      _lastChatMsg = msg
      safeChat(bot, String(msg))
    }
  } catch {}
}

// log seul (console uniquement)
let _logTs = ''
let _logTsSec = -1
let lastLogAt = Date.now()
// Anti-spam des logs : une même clé n'est loggée que toutes les minMs,
// avec un compteur "×N" quand des répétitions ont été sautées.
const _logThrottle = new Map()
function logThrottle (key, msg, minMs = 4000) {
  const now = Date.now()
  const last = _logThrottle.get(key)
  if (last && now - last.t < minMs) { last.n++; return }
  const n = last ? last.n + 1 : 1
  _logThrottle.set(key, { t: now, n: 0 })
  log(msg + (n > 1 ? ' (×' + n + ')' : ''))
}
function log (msg) {
  lastLogAt = Date.now()
  const sec = Math.floor(Date.now() / 1000)
  if (sec !== _logTsSec) { _logTsSec = sec; _logTs = new Date(sec * 1000).toISOString().slice(11, 19) }
  console.log('[' + _logTs + '] ' + msg)
}

// Message proactif : le bot commente son action en cours de temps en temps.
// À appeler depuis la boucle de mission avec une probabilité faible.
let _lastProactive = 0
function proactive (bot, action) {
  const now = Date.now()
  if (now - _lastProactive < 120000) return // max 1 toutes les 2 min
  _lastProactive = now
  chat(bot, 'proactive', { action }, { force: false })
}

// Annonce un moment clé avec un peu de mise en scène (plusieurs lignes)
function announce (bot, lines) {
  let i = 0
  for (const line of lines) {
    setTimeout(() => { try { safeChat(bot, line) } catch {} }, i * 1500)
    i++
  }
}

module.exports = { chat, say, log, logThrottle, proactive, announce, pick, MESSAGES, ALWAYS_CHAT, getLastLogAt: () => lastLogAt }
