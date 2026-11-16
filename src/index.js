// ============================================================
// LibreBot — src/index.js
// Point d'entrée : connexion (avec reconnexion automatique pour
// Aternos), plugins, commandes chat, lancement de la mission.
// ============================================================
const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock')
const pvp = require('mineflayer-pvp')
const autoEat = require('mineflayer-auto-eat')
const armorManager = require('mineflayer-armor-manager')

const CONFIG_PATH = path.join(__dirname, '..', 'config.json')
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('❌ config.json introuvable.')
  console.error("   Copie l'exemple puis édite host/username :")
  console.error('   cp config.example.json config.json')
  process.exit(1)
}
const config = require(CONFIG_PATH)
if (!config.host || !config.username) {
  console.error('❌ config.json incomplet : "host" et "username" sont obligatoires (voir config.example.json).')
  process.exit(1)
}

const { log, say, sleep, goTo, GoalXZ, Vec3, versionAtLeast } = require('./utils')
const { runMission, handleCommand, handleDeath, loadProgress, saveProgress, state } = require('./mission')
const { startSurvivalWatch } = require('./survie')
const learn = require('./learn')

let bot = null
let reconnectDelay = 30000

// une promesse rejetée non attrapée ne doit jamais tuer le bot
process.on('unhandledRejection', (err) => { log(`⚠️ promesse non gérée : ${err?.stack || err}`) })
process.on('uncaughtException', (err) => { log(`⚠️ exception non gérée : ${err?.stack || err}`) })

function createBot () {
  log(`🔌 Connexion à ${config.host}:${config.port} en tant que ${config.username}…`)
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth || 'offline',
    version: config.version || undefined
  })

  // --- plugins ---
  bot.loadPlugin(pathfinder.pathfinder)
  bot.loadPlugin(collectBlock.plugin)
  bot.loadPlugin(pvp.plugin)
  bot.loadPlugin(armorManager)
  try {
    bot.loadPlugin(autoEat.plugin)
    if (bot.autoEat?.options) {
      bot.autoEat.options = { priority: 'foodPoints', startAt: 16, banned: ['rotten_flesh'] }
    }
  } catch (e) { log(`auto-eat indisponible : ${e.message}`) }
  try {
    const hawkEye = require('minecrafthawkeye')
    bot.loadPlugin(hawkEye.default ?? hawkEye)
    log('🏹 hawk-eye actif : tir à l\'arc précis')
  } catch (e) { log('hawk-eye indisponible : tir à l\'arc en mode manuel') }

  // --- événements ---

  let protocolPatched = false
  bot.on('spawn', () => {
    log(`✅ Connecté ! (version serveur détectée : ${bot.version})`)
    reconnectDelay = 30000 // connexion réussie : on remet le délai de reco à zéro
    if (!protocolPatched) {
      protocolPatched = true
      // Depuis 1.21.2, le serveur n'accepte qu'un paquet de position par tick et
      // exige un paquet tick_end pour réinitialiser ce compteur. Depuis 1.21.3+,
      // le mouvement est server-authoritative (26.x) : le serveur calcule la
      // position à partir de player_input et rejette les paquets position du
      // client (qui provoquent un spam de corrections et bloquent le bot).
      // mineflayer 4.39 n'envoie ni tick_end ni player_input (corrigé upstream
      // après 4.39.0), donc on le fait ici.
      if (versionAtLeast(bot.version, '1.21.3')) {
        const origWrite = bot._client.write.bind(bot._client)
        bot._client.write = (name, params) => {
          if (name === 'position' || name === 'position_look') return // position calculée par le serveur
          return origWrite(name, params)
        }
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
            bot._client.write('tick_end', {})
          } catch {}
        })
      } else if (versionAtLeast(bot.version, '1.21.2')) {
        bot.on('physicsTick', () => { try { bot._client.write('tick_end', {}) } catch {} })
      }
      if (bot.version && /^(26\.[2-9]|[3-9]\d\.)/.test(bot.version)) {
        log('⚠️ Version très récente : si des erreurs de protocole apparaissent,')
        log('   utilise `npm update` pour obtenir le dernier support mineflayer.')
      }
      // viewer optionnel (POV navigateur sur http://localhost:3000 par défaut)
      if (config.viewer) {
        const viewerPort = config.viewerPort || 3000
        try {
          const mineflayerViewer = require('prismarine-viewer').mineflayer
          mineflayerViewer(bot, { port: viewerPort, firstPerson: true })
          log(`👁️ POV disponible sur http://localhost:${viewerPort}`)
        } catch (e) { log(`viewer indisponible : ${e.message}`) }
      }
      // watchdog de survie (faim, armure, fuite, lave, noyade) — idempotent
      startSurvivalWatch(bot)
      // apprentissage : ajuste les cibles de récolte selon l'inventaire actuel
      learn.adjustTargets(config, bot)
      say(bot, 'Salut ! Je suis connecté et prêt 🙌 Dis-moi "mission" ou "statut" en /tell !')
    }
    // après une mort, s'éloigner du lieu de la mort pour éviter de mourir en boucle au même endroit
    const progress = loadProgress()
    if (progress.deathPos) {
      const d = bot.entity.position.distanceTo(new Vec3(progress.deathPos.x, progress.deathPos.y, progress.deathPos.z))
      if (d < 6) {
        const away = bot.entity.position.offset(10, 0, 0)
        goTo(bot, new GoalXZ(away.x, away.z), { timeout: 60000, retries: 0 }).catch(() => {})
      }
      delete progress.deathPos
      saveProgress(progress)
    }
    // relance auto de la mission à chaque (re)spawn si elle ne tourne pas déjà
    if (config.autoMission) {
      setTimeout(() => {
        if (!state.running) runMission(bot, config).catch((e) => log(`mission error : ${e.stack}`))
      }, 3000)
    }
  })

  bot.on('death', () => {
    log('☠️ Le bot est mort !')
    handleDeath(bot)
    setTimeout(() => {
      try { bot._client.write('client_command', { actionId: 0 }) } catch (e) { log(`respawn: ${e.message}`) }
    }, 1500)
  })

  // commandes : /tell LibreBot <commande>  (ou chat direct)
  bot.on('whisper', (username, message) => {
    if (username === bot.username) return
    handleCommand(bot, config, username, message).catch((e) => log(`command error : ${e.stack}`))
  })
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    const lower = message.toLowerCase()
    // accepter les commandes directes préfixées par le nom du bot
    if (lower.startsWith(`${config.username.toLowerCase()}`) || lower.startsWith('librebot')) {
      handleCommand(bot, config, username, message).catch((e) => log(`command error : ${e.stack}`))
    }
  })

  bot.on('kicked', (reason) => {
    log(`❌ Expulsé du serveur : ${String(reason).slice(0, 300)}`)
    log('   (Si le serveur Aternos s\'est arrêté, je me reconnecterai quand il sera relancé.)')
  })

  bot.on('error', (err) => {
    const msg = String(err.message || err)
    log(`erreur : ${msg}`)
    // Version serveur pas encore supportée par mineflayer (ex : 26.3)
    if (/unsupported|unknown.*protocol|protocol.*(unsupported|unknown)|not\s+a\s+valid|no\s+version|cannot\s+find\s+version/i.test(msg)) {
      log('──────────────────────────────────────────────────────')
      log('⛔ La version de ton serveur n\'est pas encore supportée par mineflayer.')
      log('   Solutions :')
      log('   1) Sur Aternos, choisis une version ≤ 26.1 (Paper) dans les options du serveur.')
      log('   2) Ou attends la mise à jour de mineflayer, puis relance `npm install` puis `npm start`.')
      log('   (suivi du support : github.com/PrismarineJS/mineflayer/pull/3926)')
      log('──────────────────────────────────────────────────────')
    }
  })

  bot.on('end', () => {
    log(`🔌 Déconnecté. Nouvelle tentative dans ${Math.round(reconnectDelay / 1000)} s…`)
    setTimeout(createBot, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 120000) // backoff exponentiel, max 2 min
  })
}

createBot()

// Ctrl+C propre
process.on('SIGINT', () => {
  log('👋 Arrêt du bot.')
  try { bot.quit() } catch {}
  process.exit(0)
})
