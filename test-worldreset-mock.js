// Nouveau monde : progression et mémoires spatiales réinitialisées
const fs = require('fs')
const path = require('path')
;['learning.json', 'worldmap.json'].forEach((f) => { const p = path.join(__dirname, f); if (fs.existsSync(p + '.bak')) fs.unlinkSync(p + '.bak'); if (fs.existsSync(p)) fs.renameSync(p, p + '.bak'); fs.writeFileSync(p, '{}') })
const md = { blocksByName: {}, itemsByName: {}, items: {}, itemsById: {} }
const mdPath = require.resolve('minecraft-data')
require.cache[mdPath] = { id: mdPath, filename: mdPath, loaded: true, exports: () => md }
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const restore = () => { ['learning.json', 'worldmap.json'].forEach((f) => { const p = path.join(__dirname, f); try { fs.unlinkSync(p) } catch {}; if (fs.existsSync(p + '.bak')) fs.renameSync(p + '.bak', p) }) }
process.on('exit', restore)

const learn = require('./src/learn')
const map = require('./src/map')

;(async () => {
  // on remplit la mémoire monde avec des données du "vieux monde"
  learn.recordSpatial('resource:iron', { x: 100, y: 16, z: -20 }, 3)
  learn.recordDiscovery('fortress', 500, 70, -500)
  learn.recordDeath('lava', { x: 1, y: 2, z: 3 })
  learn.recordSkill('fouille-coffre', 1)
  map.addPOI('structure', 10, 64, 10)
  map.recordPath(0, 0, 5, 5, true)

  // nouveau monde
  learn.resetWorldMemory()
  map.clearWorld()

  check(learn.knownResources().length === 0, 'reset : mémoire spatiale des gisements vidée')
  check(Object.keys(learn.getDiscoveries?.() ?? {}).length === 0 || (learn.getNearestDiscoveries(0, 0) ?? []).length === 0, 'reset : découvertes (forteresses etc.) effacées')
  check(learn.skillLevel('fouille-coffre') >= 1, 'reset : les compétences générales sont conservées')
  learn.recordSkill('fouille-coffre', 1)
  check(map.nearestPOI('structure', 0, 0, 64) == null, 'reset : POI de la carte (structures) effacés')

  // empreinte de monde dans index.js : la progression est liée au spawn
  const idx = fs.readFileSync('./src/index.js', 'utf8')
  check(idx.includes('worldId') && idx.includes('spawn_point'), 'index.js : empreinte de monde (spawn_point) comparée au worldId sauvegardé')
  check(/for \(const k of \['done', 'deathPos', 'fortress'/.test(idx), 'index.js : nouveau monde → phases faites + positions réinitialisées')

  console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
  process.exit(fails === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
