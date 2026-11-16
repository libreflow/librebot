// ============================================================
// LibreBot — src/storage.js
// Persistance JSON centralisée et atomique (écriture .tmp + rename)
// pour progress.json / learning.json.
// Le dossier de données peut être déplacé via LIBREBOT_DATA_DIR
// (utilisé par les tests pour ne pas toucher aux vraies données).
// ============================================================
const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.LIBREBOT_DATA_DIR || path.join(__dirname, '..')
const PROGRESS_PATH = path.join(DATA_DIR, 'progress.json')

function resolvePath (file) {
  return path.isAbsolute(file) ? file : path.join(DATA_DIR, file)
}

function loadJson (file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(resolvePath(file), 'utf8'))
  } catch {
    return fallback
  }
}

function saveJson (file, data) {
  const p = resolvePath(file)
  const tmp = p + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, p)
  } catch (e) {
    console.error(`sauvegarde impossible (${p}) : ${e.message}`)
  }
}

const loadProgress = () => loadJson(PROGRESS_PATH, {})
const saveProgress = (p) => saveJson(PROGRESS_PATH, p)

module.exports = { DATA_DIR, PROGRESS_PATH, loadJson, saveJson, loadProgress, saveProgress }
