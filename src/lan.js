// ============================================================
// LibreBot — src/lan.js
// Mode LAN : rejoindre un monde solo ouvert avec "Ouvrir au
// réseau local" (Open to LAN) sur la même machine.
// Le serveur LAN intégré accepte les comptes offline (auth: "offline").
// Le port est lu dans les logs du client Minecraft : la ligne
// "Local game hosted on port XXXXX" dans .minecraft/logs/latest.log
// ============================================================
const fs = require('fs')
const path = require('path')

// Dernier port LAN annoncé par le client Minecraft, ou null
function readLanPort (logDir) {
  const dir = logDir ?? path.join(process.env.APPDATA || '', '.minecraft', 'logs')
  let content
  try { content = fs.readFileSync(path.join(dir, 'latest.log'), 'utf8') } catch { return null }
  const matches = [...content.matchAll(/hosted on port\s+(\d{2,5})/gi)]
  if (!matches.length) return null
  return Number(matches[matches.length - 1][1])
}

// { host, port } effectifs selon la config ; null si mode lan sans monde ouvert
function resolveTarget (config, logDir) {
  if (!config.lan) return { host: config.host, port: config.port }
  // lanPort explicite dans config.json = prioritaire (pas besoin de lire les logs)
  if (config.lanPort) return { host: config.lanHost || '127.0.0.1', port: config.lanPort }
  const port = readLanPort(logDir)
  if (!port) return null
  // lanHost optionnel : IP de la machine qui héberge le monde si le bot tourne ailleurs sur le réseau local
  return { host: config.lanHost || '127.0.0.1', port }
}

module.exports = { readLanPort, resolveTarget }
