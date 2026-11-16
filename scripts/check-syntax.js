// Vérifie la syntaxe de tous les fichiers JS du projet (équivalent CI de node --check).
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIRS = ['src', 'tests', 'scripts']

let failed = false
for (const d of DIRS) {
  const dir = path.join(ROOT, d)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js')) continue
    const file = path.join(dir, f)
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (r.status !== 0) {
      failed = true
      console.error(`❌ ${d}/${f}\n${r.stderr}`)
    } else {
      console.log(`✅ ${d}/${f}`)
    }
  }
}
process.exit(failed ? 1 : 0)
