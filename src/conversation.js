// ============================================================
// LibreBot — src/conversation.js
// Conversation libre : quand un message n'est pas une commande,
// le bot répond naturellement en français, avec le contexte de
// sa mission, sa vie, sa faim et sa progression.
// ============================================================
const { log, safeChat } = require('./chat')
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// anti-flood conversation : 1 réponse max toutes les 4 s, et pas deux fois la même consécutive
let _lastAt = 0
let _lastKey = ''

const RULES = [
  {
    key: 'greet',
    re: /^(bonjour|bonsoir|salut|hey|yo|hello|coucou|wesh|slt)\b/,
    replies: [
      'Salut {user} ! 👋', 'Yo {user} ! Prêt à tuer un dragon ? 🐉', 'Coucou {user} !',
      'Salut {user}, quoi de neuf ?', 'Hello {user} ! 👋'
    ]
  },
  {
    key: 'howareyou',
    re: /(comment (ca|ça) va|ca va|ça va|tu vas bien|la forme|comment te sens)/,
    replies: [
      'Ça va ! Vie {hp}/20, faim {food}/20 — en forme de tueur de dragon 😎',
      'Je tiens le coup : {hp}❤️ et {food}🍖. Et toi {user} ?',
      'Bien ! Je suis en pleine mission, {hp} de vie et la tête haute 💪'
    ]
  },
  {
    key: 'identity',
    re: /(qui es[- ]tu|ton nom|tu es qui|presente|présente|t appelles comment|t'appelles)/,
    replies: [
      'Je suis LibreBot, bot speedrunner autonome 🤖 — mission : tuer l\'Ender Dragon !',
      'LibreBot, à ton service 🤖 Je mine, je craft, je meurs parfois, je recommence.',
      'Moi ? LibreBot ! Survivaliste Minecraft et tueur de dragons ⚔️'
    ]
  },
  {
    key: 'age',
    re: /(quel age|quel âge|tu as quel age|année)/,
    replies: ['Je suis né au lancement du script, mathématiquement je suis un bébé qui craft 🤖']
  },
  {
    key: 'thanks',
    re: /(merci|thanks|thx|gg|bien joue|bien joué)/,
    replies: ['De rien {user} ! 🙌', 'Avec plaisir !', 'Merci à toi ! On va y arriver 💪']
  },
  {
    key: 'bye',
    re: /(au revoir|a\+|bye|salut batard?$|a plus|ciao|bonne nuit)/,
    replies: ['À plus tard {user} ! Je continue la mission 💪', 'Bye {user} ! Je veille sur la base 🏠']
  },
  {
    key: 'love',
    re: /(je t aime|tu es le meilleur|t es le meilleur|tu es fort|bravo|j adore)/,
    replies: ['Aww, merci {user} 🥹 Le dragon par contre va moins m\'aimer.', 'Tu vas me faire rougir sous ce casque 🤖❤️']
  },
  {
    key: 'insult',
    re: /(connard|salope|pute|nique|batard|bâtard|tg|ta gueule|debile|débile|cretin|crétin|idiot|nul a|pourri)/,
    replies: [
      'Je reste zen {user}, je suis un bot pacifique 🕊️ Mais dis-moi ce qui ne va pas, je peux corriger.',
      'Prends une profonde inspiration {user} 😌 Qu\'est-ce qui coince ?'
    ]
  },
  {
    key: 'joke',
    re: /(blague|joke|raconte|drole|drôle|amuse)/,
    replies: [
      'Pourquoi les creepers n\'ont pas d\'amis ? Parce qu\'ils explosent à la moindre émotion 💥',
      'Un zombie entre dans un bar… enfin il essaie, la porte fait 2 blocs de haut 🧟',
      'Moi je connais l\'Blaze qui gèle sur place… ah non, c\'est l\'inverse 🔥'
    ]
  },
  {
    key: 'sing',
    re: /(chante|chanson|musique|rappe)/,
    replies: ['⛏️⛏️ Je mine, je mine, des diamants qu\'on s\'aime… 🎵 (je travaille mon album entre deux phases)']
  },
  {
    key: 'help',
    re: /(tu (sais )?faire quoi|aide|help|que sais tu|capacite|capacité|fonctionnalite)/,
    replies: [
      'Je speedrun le dragon 🐉, je mine/craft/fond, je me bats, je fouille, te suis, construis — dis "statut" pour le détail !',
      'Commandes : statut, inventaire, chrono, cerveau, mémoire, suivre, stop, reprendre, baseline…'
    ]
  },
  {
    key: 'dragon',
    re: /(dragon|fin du jeu|ender|l end|l\'end)/,
    replies: [
      'Le dragon tremble déjà 🐉 Progression : {done}/{total} phases.',
      'La route : yeux → forteresse → stronghold → End. J\'en suis à {done} phases. ⚔️'
    ]
  },
  {
    key: 'where',
    re: /(ou es|où es|tu es ou|t es ou|position)/,
    replies: ['Je suis vers ({x}, {y}, {z}) en {dim} 📍']
  },
  {
    key: 'hungry',
    re: /(tu as faim|faim|tu manges|mange quoi)/,
    replies: ['Faim : {food}/20 🍖 Je cuve du porc dès que ça baisse, promis.']
  },
  {
    key: 'bored',
    re: /(tu fais quoi|quoi de neuf|news|tu es occupe|occupé)/,
    replies: [
      'Je suis sur : {phase}. {done}/{total} phases faites ⛏️',
      'Là je gère la mission ({phase}) — viens, on discute en marchant 🚶'
    ]
  },
  {
    key: 'typo-command',
    re: /(pourquoi tu (ne )?(fait|fais) pas|tu devrais|essaie de|tu peux|peux tu)/,
    replies: [
      'Bonne remarque ! J\'apprends de mes erreurs via learning.json 🧠 En ce moment : {phase}.',
      'Je note ton idée dans mes circuits 🤖 Je préfère finir la phase en cours avant de changer de plan.'
    ]
  }
]

const FALLBACKS = [
  'Hmm, je suis un bot de 26.1, pas un philosophe 🤖 Mais dis moi "statut" ou "aide" et je te montre de quoi je suis capable !',
  'Intéressant {user} ! Mon cerveau de bot est surtout câblé pour le speedrun — mais dis "aide" pour tout le reste ⛏️',
  'Je note ça ! En attendant, phase en cours : {phase} 🚀',
  'Drôle de question pour un mineur professionnel 😄 Moi je fais du diamant, pas de la discussion. Mais "statut" et "chrono", ça je gère !'
]

function contextInfo (bot, M) {
  const state = M.state
  const p = bot.entity?.position?.floored()
  let done = 0
  try { done = (M.loadProgress()?.done ?? []).length } catch {}
  return {
    user: '',
    hp: Math.round(bot.health ?? 20),
    food: Math.round(bot.food ?? 20),
    x: p ? p.x : '?', y: p ? p.y : '?', z: p ? p.z : '?',
    dim: (bot.game?.dimension ?? 'overworld').replace('minecraft:', ''),
    done, total: (M.PHASES || []).length || 19,
    phase: phaseLabel(M, state)
  }
}

function phaseLabel (M, state) {
  if (!state?.currentPhase) return 'aucune (dis "mission" pour lancer)'
  const ph = (M.PHASES || []).find((x) => x.key === state.currentPhase)
  return (ph && ph.label) || state.currentPhase
}

function fill (text, ctx) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? String(ctx[k]) : m))
}

// Entrée principale : répond à un message libre. Retourne true si une réponse a été envoyée.
function reply (bot, from, message) {
  const now = Date.now()
  const raw = norm(String(message || '')).replace(/^librebot[, !]*/, '').replace(/^[:,]\s*/, '').trim()
  if (!raw) return false
  // un simple "librebot" ne mérite pas toujours une réponse
  if (raw.length < 2) return false
  if (now - _lastAt < 4000) return false // anti-flood : max une réponse toutes les 4 s
  _lastAt = now
  _lastKey = raw

  const M = require('./mission')
  const ctx = contextInfo(bot, M)
  ctx.user = from
  if (ctx.phase === 'aucune (dis "mission" pour lancer)' && M.state?.running) ctx.phase = 'mission en cours'

  let rule = null
  for (const r of RULES) { if (r.re.test(raw)) { rule = r; break } }
  const chosen = rule ? pick(rule.replies) : pick(FALLBACKS)
  const out = fill(chosen, ctx)
  log(`💬 (conversation) ${from}: ${message} → réponse`)
  safeChat(bot, out)
  return true
}

module.exports = { reply }
