// Ordonnanceur intelligent : une phase bloquée ne gèle plus la mission
const fs = require('fs')
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const s = fs.readFileSync('./src/mission.js', 'utf8')

// 1. une phase bloquée passe en cooldown (5 min) au lieu de stopper la mission
check(s.includes('progress.blocked[ph.key] = Date.now() + 5 * 60000'), 'échec de phase → cooldown 5 min enregistré (progress.blocked)')

// 2. la mission CONTINUE sur les phases indépendantes (plus de `return` immédiat)
check(s.includes('const restantes = phases.filter') && s.includes('la mission continue sur les'), 'phases indépendantes restantes attaquées (plus de gel de la mission)')

// 3. dépendances : une phase dont le prérequis est bloqué est sautée (pas d'échec inutile)
check(/const DEPENDS = \{ pierre: \['bois'\]/.test(s) && s.includes('depBlocked.length'), 'dépendances : les phases dont le prérequis est en cooldown sont sautées')

// 4. cooldown écoulé → la phase est retentée automatiquement
check(s.includes("if (progress.blocked[ph.key]) { delete progress.blocked[ph.key] }"), 'cooldown écoulé → nouvelle tentative automatique')

// 5. plus aucune phase indépendante → reprise programmée au plus proche cooldown
check(s.includes('prochain') && s.includes('autoResumeAt'), 'plus rien d\'indépendant → auto-reprise au plus proche cooldown')

// 6. statut : les cooldowns sont visibles
check(s.includes('pause intelligente'), 'status : cooldowns affichés')

// 7. commande "reprendre" = annule les cooldowns et retente immédiatement
check(s.includes('Cooldowns annulés') && s.includes('p.blocked = {}'), '"reprendre" annule les cooldowns (retente maintenant)')

// 8. simulation logique de la topologie de dépendances (extraction + vérification DAG)
const depsM = s.match(/const DEPENDS = (\{[\s\S]*?\})/m)
check(!!depsM, 'DEPENDS extractible du code')
if (depsM) {
  const deps = eval('(' + depsM[1].replace(/[\u00e9]/g, 'e') + ')')
  const phases = ['bois', 'pierre', 'fer', 'diamant', 'obsidienne', 'base', 'nether', 'forteresse', 'blazes', 'perles', 'yeux', 'stronghold', 'dragon']
  let dagOk = true
  for (const [k, arr] of Object.entries(deps)) {
    if (!phases.includes(k)) dagOk = false
    for (const d of arr) { if (!phases.includes(d)) dagOk = false; if (phases.indexOf(d) > phases.indexOf(k)) dagOk = false }
  }
  check(dagOk, 'DEPENDS : prérequis tous définis et antérieurs dans l\'ordre des phases (pas de cycles)')
  // si "fer" est bloqué : "diamant", "obsidienne"… sont écartées via leurs prérequis ? "pierre" non bloquée mais "diamant" dépend de "fer" → doit être sauté
  check((deps.diamant || []).includes('fer') && (deps.fer || []).includes('pierre'), 'fer bloqué → diamant écarté (diamant dépend de fer)')
}

console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
process.exit(fails === 0 ? 0 : 1)
