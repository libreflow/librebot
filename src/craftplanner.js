// ============================================================
// LibreBot — src/craftplanner.js
// Planificateur de craft intelligent.
//
// Au lieu de crafter item par item en appelant craftItem récursivement
// (qui peut échouer si une ressource manque au milieu de la chaîne),
// ce module construit l'ARBRE COMPLET des dépendances d'un item,
// vérifie quelles ressources manquent, et planifie l'ordre optimal
// (miner d'abord, puis crafter dans le bon ordre).
// ============================================================
const { mcData, countItem, log } = require('./utils')

// Items qui ne se craftent pas (à miner/récolter, pas à fabriquer)
const NOT_CRAFTABLE = new Set(['diamond','raw_iron','raw_gold','raw_copper','coal','charcoal','flint','ender_pearl','blaze_rod','obsidian','feather','lapis_lazuli','redstone','glowstone_dust','quartz','ancient_debris','netherite_scrap','emerald','amethyst_shard','echo_shard','disc_fragment_5','goat_horn','sniffer_egg','golden_apple','enchanted_golden_apple','nether_star','dragon_egg','dragon_breath','elytra','totem_of_undying','heart_of_the_sea','nautilus_shell','phantom_membrane','shulker_shell','honeycomb','string','gunpowder','bone','slime_ball','spider_eye','rotten_flesh','blaze_powder','ghast_tear','magma_cream','prismarine_shard','prismarine_crystals','sand','gravel','clay_ball','ink_sac','honey_bottle','glass_bottle','leather','rabbit_hide','turtle_helmet','scute','armadillo_scute'])

// Build l'arbre de dépendances d'un item : { item, count, needs: [...], craftable: bool }
function buildTree (bot, itemName, count = 1, depth = 0, seen = new Set()) {
  const md = mcData(bot)
  const item = md.itemsByName[itemName]
  if (!item) return { item: itemName, count, error: 'inconnu', needs: [] }

  const have = countItem(bot, itemName)
  if (have >= count) return { item: itemName, count, have, needs: [], done: true }
  if (NOT_CRAFTABLE.has(itemName)) {
    return { item: itemName, count, have, needs: [], gather: true, missing: count - have }
  }
  if (depth > 6 || seen.has(itemName)) return { item: itemName, count, needs: [], cycle: true }
  seen.add(itemName)

  // Trouver la meilleure recette craftable avec ce qu'on a
  const recipes = bot.recipesFor(item.id, null, 1, null) ?? []
  const allRecipes = recipes.length ? recipes : (bot.recipesAll(item.id, null, null) ?? []).filter(r => !r.requiresTable)
  if (!allRecipes.length) {
    // Peut-être un item de table (table de craft requise)
    const tableRecipes = (bot.recipesAll(item.id, null, true) ?? []).filter(r => r.requiresTable)
    if (tableRecipes.length) {
      const r = tableRecipes[0]
      return buildFromRecipe(bot, itemName, count, r, depth, seen, true)
    }
    return { item: itemName, count, have, needs: [], gather: true, missing: count - have }
  }

  // Préférer une recette dont on a déjà tous les ingrédients
  const invCount = new Map()
  for (const i of bot.inventory.items()) invCount.set(i.name, (invCount.get(i.name) ?? 0) + i.count)
  const craftableNow = allRecipes.find(r => recipeIngredients(md, r).every(ing => {
    const it = md.itemsById?.[ing.id] ?? md.items?.[ing.id]
    return it && (invCount.get(it.name) ?? 0) >= (ing.count ?? 1)
  }))
  const recipe = craftableNow ?? allRecipes[0]
  return buildFromRecipe(bot, itemName, count, recipe, depth, seen, false)
}

// Normalise les ingrédients d'une recette : forme mineflayer {ingredients:[{id,count}]}
// ou forme brute minecraft-data {inShape: [[id...]]} / {inShapeless: [id...]}
function recipeIngredients (md, recipe) {
  if (Array.isArray(recipe.ingredients)) {
    return recipe.ingredients.map((i) => (typeof i === 'number' ? { id: i, count: 1 } : i))
  }
  const shape = recipe.inShape ?? (recipe.inShapeless ? [recipe.inShapeless.flat()] : null)
  if (!shape) return []
  const counts = new Map()
  for (const row of shape) {
    for (const id of (row ?? [])) {
      if (id == null) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count }))
}

function buildFromRecipe (bot, itemName, count, recipe, depth, seen, needsTable) {
  const md = mcData(bot)
  const resultCount = recipe.result?.count ?? 1
  const crafts = Math.ceil(count / resultCount)
  const needs = []
  for (const ing of recipeIngredients(md, recipe)) {
    // md.items n'est PAS indexé par id numérique -> md.itemsById (sinon tout item
    // semblait craftable sans ingrédients)
    const ingItem = md.itemsById?.[ing.id] ?? md.items?.[ing.id]
    if (!ingItem) continue
    const need = (ing.count ?? 1) * crafts
    needs.push(buildTree(bot, ingItem.name, need, depth + 1, new Set(seen)))
  }
  if (needsTable) needs.push({ item: 'crafting_table', count: 1, needs: [], hint: 'poser une table de craft' })
  return { item: itemName, count, crafts, needs, recipe: true }
}

// Aplati l'arbre en liste ordonnée : d'abord les "gather" (miner), puis les crafts feuilles-d'abord
function flattenPlan (tree) {
  const gather = []
  const crafts = []
  function walk (node) {
    if (!node) return
    if (node.done) return
    if (node.gather) { gather.push({ item: node.item, count: node.missing }); return }
    if (node.cycle || node.error) { gather.push({ item: node.item, count: node.count }); return }
    for (const n of node.needs ?? []) walk(n)
    if (node.recipe) crafts.push({ item: node.item, count: node.count, crafts: node.crafts })
  }
  walk(tree)
  return { gather, crafts }
}

// Plan complet pour crafter un item : retourne { gather: [...], crafts: [...], summary: string }
function plan (bot, itemName, count = 1) {
  const tree = buildTree(bot, itemName, count)
  const flat = flattenPlan(tree)
  const lines = []
  if (flat.gather.length) lines.push('⛏️ À récolter/miner : ' + flat.gather.map(g => g.count + 'x ' + g.item).join(', '))
  if (flat.crafts.length) lines.push('🔨 À crafter (ordre optimal) : ' + flat.crafts.map(c => c.crafts + 'x ' + c.item).join(' → '))
  if (!lines.length) lines.push('✅ Rien à faire, ' + count + 'x ' + itemName + ' déjà dispo')
  return { tree, ...flat, summary: lines.join('\n') }
}

// Exécute le plan : gather d'abord (pas implémenté ici — c'est les phases qui minent),
// puis crafts dans l'ordre. Retourne true si tout a été crafté.
async function executePlan (bot, itemName, count, craftItemFn) {
  const p = plan(bot, itemName, count)
  log('📋 Plan pour ' + count + 'x ' + itemName + ' :\n' + p.summary)
  for (const c of p.crafts) {
    await craftItemFn(bot, c.item, c.count)
  }
  return countItem(bot, itemName) >= count
}


// Liste de TOUS les items du jeu craftables avec l'inventaire actuel
// (aucune ressource à récolter manquante), triés du plus simple au plus complexe.
function craftableList (bot, limit = 60) {
  const md = mcData(bot)
  const out = []
  for (const item of Object.values(md.items)) {
    if (NOT_CRAFTABLE.has(item.name)) continue
    if (countItem(bot, item.name) > 0) continue // déjà possédé
    const tree = buildTree(bot, item.name, 1, 0, new Set())
    const flat = flattenPlan(tree)
    if (flat.gather.length === 0 && (flat.crafts.length > 0 || tree.done)) {
      out.push({ item: item.name, steps: flat.crafts.length })
    }
  }
  out.sort((a, b) => a.steps - b.steps)
  return out.slice(0, limit)
}

// Craft universel : construit le plan complet et exécute les crafts dans l'ordre.
// Retourne true si l'item est possédé à la fin.
async function craftAny (bot, itemName, count = 1) {
  const { craftItem } = require('./utils')
  const p = plan(bot, itemName, count)
  if (p.gather.length) {
    log('📋 ' + itemName + ' : ressources manquantes → ' + p.gather.map(g => g.count + 'x ' + g.item).join(', '))
    return 'ressources manquantes : ' + p.gather.map(g => g.count + 'x ' + g.item).join(', ')
  }
  log('📋 Plan pour ' + count + 'x ' + itemName + ' :\n' + p.summary)
  for (const c of p.crafts) {
    try { await craftItem(bot, c.item, c.count) } catch (e) { return e.message }
  }
  return countItem(bot, itemName) >= count ? null : 'craft de ' + itemName + ' échoué'
}

module.exports = { plan, buildTree, flattenPlan, executePlan, craftableList, craftAny, NOT_CRAFTABLE }
