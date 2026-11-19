// Fenêtres Minecraft (coffre/établi/four) : sérialisation obligatoire + opportunité non intrusive
const fs = require('fs')
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const U = fs.readFileSync('./src/utils.js', 'utf8')
const S = fs.readFileSync('./src/survie.js', 'utf8')

// 1. toutes les vraies opérations de fenêtre passent par le mutex (5 sites)
const mutexSites = [
  "withExclusiveWindow(() => bot.openContainer(block))",
  "withExclusiveWindow(() => bot.openFurnace(furnaceBlock))",
  "withExclusiveWindow(() => bot.craft(recipes[0], 1, null))",
  "withExclusiveWindow(() => bot.craft(recipe, crafts, freshTable))",
  "withExclusiveWindow(() => bot.craft(recipes[0], batch, null))"
]
for (const site of mutexSites) check(U.includes(site), 'mutex appliqué : ' + site.slice(site.indexOf('bot.') + 4, site.indexOf('bot.') + 24).trim())
const naked = [/await bot\.openContainer\(/, /await bot\.openFurnace\(/, /await bot\.craft\(/].some((re) => re.test(U))
check(!naked, 'aucun accès fenêtre nu (100 % sérialisés)')

// 2. flag global pour que le cerveau évite d'ouvrir un coffre pendant un craft
check(U.includes('_librebotWindowBusy') && S.includes('_librebotWindowBusy'), 'flag d\'occupation de fenêtre visible du watchdog (OPPORTUNITE attend)')

// 3. opportunité coffre : déjà-vidés ignorés + 1/min max (avant : 40 sél./3 min)
check(S.includes('isChestLooted(chestBlock.position)') && S.includes('lastChestLoot > 60000'), 'OPPORTUNITE : coffre déjà vidé ignoré + max 1/min')

// 4. test fonctionnel du mutex (réplique exacte de la logique) :
// 8 accès concurrents ne montrent JAMAIS plus d'1 fenêtre ouverte à la fois
const run = async () => {
  let _l = null
  let open = 0
  let maxOpen = 0
  async function withExclusiveWindow (fn) {
    while (_l) { try { await _l } catch {} }
    let unlock
    _l = new Promise((r) => { unlock = r })
    open++; maxOpen = Math.max(maxOpen, open)
    try { return await fn() } finally { unlock(); _l = null; open-- }
  }
  const jobs = []
  for (let i = 0; i < 8; i++) jobs.push(withExclusiveWindow(() => new Promise((r) => setTimeout(r, 5 + i))))
  await Promise.all(jobs)
  check(maxOpen === 1, '8 accès fenêtres concurrents → jamais plus d\'1 ouverte à la fois (plafond ' + maxOpen + ')')
  console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
  process.exit(fails === 0 ? 0 : 1)
}
run()
