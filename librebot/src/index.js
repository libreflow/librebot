// ============================================================
// LibreBot — src/index.js
// Point d'entrée : connexion (avec reconnexion automatique pour
// Aternos), plugins, commandes chat, lancement de la mission.
// ============================================================
const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock')
const pvp = require('mineflayer-pvp')
const autoEat = require('mineflayer-auto-eat')
const armorManager = require('mineflayer-armor-manager')
const config = require('../config.json')

const { log, say, sleep } = require('./utils')
const { runMission, handleCommand, handleDeath, state } = require('./mission')

let bot = null
let lastSpawnMissionStarted = false

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
  bot.loadPlugin(armorManager.plugin)
  try {
    bot.loadPlugin(autoEat.plugin)
    if (bot.autoEat?.options) {
      bot.autoEat.options = { priority: 'foodPoints', startAt: 16, banned: ['rotten_flesh'] }
    }
  } catch (e) { log(`auto-eat indisponible : ${e.message}`) }
  try { bot.loadPlugin(require('mineflayer-hawk-eye')) } catch (e) { log('hawk-eye indisponible : tir à l\'arc en mode manuel') }

  // --- événements ---

  bot.once('spawn', () => {
    log('✅ Connecté !')
    // viewer optionnel (POV navigateur sur http://localhost:3000)
    if (config.viewer) {
      try {
        const mineflayerViewer = require('prismarine-viewer').mineflayer
        mineflayerViewer(bot, { port: 3000, firstPerson: true })
        log('👁️ POV disponible sur http://localhost:3000')
      } catch (e) { log(`viewer indisponible : ${e.message}`) }
    }
    if (config.autoMission && !lastSpawnMissionStarted) {
      lastSpawnMissionStarted = true
      runMission(bot, config).catch((e) => log(`mission error : ${e.stack}`))
    } else if (config.autoMission) {
      say(bot, 'Je suis de retour — "reprendre" pour relancer la mission où elle s\'était arrêtée.')
    }
  })

  bot.on('death', () => {
    log('☠️ Le bot est mort !')
    handleDeath()
    setTimeout(() => {
      try { bot._client.write('client_command', { action: 0 }) } catch (e) { log(`respawn: ${e.message}`) }
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

  bot.on('error', (err) => log(`erreur : ${err.message}`))

  bot.on('end', () => {
    log('🔌 Déconnecté. Nouvelle tentative dans 30 s…')
    lastSpawnMissionStarted = false
    setTimeout(createBot, 30000)
  })
}

createBot()

// Ctrl+C propre
process.on('SIGINT', () => {
  log('👋 Arrêt du bot.')
  try { bot.quit() } catch {}
  process.exit(0)
})
