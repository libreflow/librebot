// Watchdog externe LibreBot : surveille bot.log et relance le bot s'il est bloqué.
// Un blocage synchrone (boucle infinie dans le process) ne peut pas être
// interrompu de l'intérieur : ce script tourne en process séparé.
// - toutes les 15s : si bot.log n'a pas été modifié depuis > 150s -> kill + relance
// - anti double instance via .watchdog.lock
const fs = require('fs')
const path = require('path')
const { execSync, spawn } = require('child_process')

const ROOT = __dirname
const LOG = path.join(ROOT, 'bot.log')
const LOCK_BOT = path.join(ROOT, '.bot.lock')
const LOCK_WD = path.join(ROOT, '.watchdog.lock')
const IDLE_MS = 150000 // 2 min 30 sans log = bloqué
const CHECK_MS = 15000

// lock atomique ('wx') + nettoyage si pid mort
try {
  if (fs.existsSync(LOCK_WD)) {
    try { process.kill(Number(fs.readFileSync(LOCK_WD, 'utf8').trim()), 0) } catch { try { fs.unlinkSync(LOCK_WD) } catch {} }
  }
  fs.writeFileSync(LOCK_WD, String(process.pid), { flag: 'wx' })
} catch (e) {
  if (e.code === 'EEXIST') { console.log('watchdog déjà actif. Arrêt.'); process.exit(0) }
  throw e
}
process.on('exit', () => { try { if (fs.readFileSync(LOCK_WD, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK_WD) } catch {} })

console.log('[watchdog] démarré (pid ' + process.pid + '), surveillance de bot.log toutes les ' + CHECK_MS / 1000 + 's, seuil ' + IDLE_MS / 1000 + 's')

let restarts = 0
setInterval(() => {
  try {
    if (!fs.existsSync(LOG)) return
    const mtime = fs.statSync(LOG).mtimeMs
    const idle = Date.now() - mtime
    if (idle < IDLE_MS) return
    restarts++
    console.log('[watchdog] 🚨 bot inactif depuis ' + Math.round(idle / 1000) + 's — kill + relance (#' + restarts + ')')
    try {
      const pid = Number(fs.readFileSync(LOCK_BOT, 'utf8').trim())
      if (pid) execSync('taskkill /F /PID ' + pid, { shell: 'cmd.exe', stdio: 'ignore' })
    } catch {}

    setTimeout(() => {
      try { fs.unlinkSync(LOCK_BOT) } catch {}
      const out = fs.openSync(LOG, 'a')
      const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] })
      child.unref()
      console.log('[watchdog] bot relancé (pid ' + child.pid + ')')
    }, 3000)
  } catch (e) { console.log('[watchdog] erreur: ' + e.message) }
}, CHECK_MS)
