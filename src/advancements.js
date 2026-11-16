// ============================================================
// LibreBot — src/advancements.js
// Catalogue des 126 succès (advancements) de Minecraft Java 1.21+
// + tracker de progression.
//
// Statuts :
//   dragon  → débloqué par la mission dragon (phases 1-13)
//   auto    → automatisé par les ateliers (phases 14+)
//   partial → tenté automatiquement, réussite non garantie (conditions rares / mécanique délicate)
//   manual  → non automatisé : tips dans le README
// ============================================================
const fs = require('fs')
const path = require('path')
const { log, say } = require('./utils')

const PROGRESS_PATH = path.join(__dirname, '..', 'progress.json')

// [clé, nom, onglet, statut]
const CATALOG = [
  // ---------- Minecraft (16) ----------
  ['minecraft', 'Minecraft', 'Minecraft', 'dragon'],
  ['stone_age', 'Stone Age', 'Minecraft', 'dragon'],
  ['upgrade', 'Getting an Upgrade', 'Minecraft', 'dragon'],
  ['hardware', 'Acquire Hardware', 'Minecraft', 'dragon'],
  ['suit_up', 'Suit Up', 'Minecraft', 'dragon'],
  ['hot_stuff', 'Hot Stuff', 'Minecraft', 'auto'],
  ['iron_pick', "Isn't It Iron Pick?", 'Minecraft', 'dragon'],
  ['not_today', 'Not Today, Thank You', 'Minecraft', 'partial'],
  ['ice_bucket', 'Ice Bucket Challenge', 'Minecraft', 'dragon'],
  ['diamonds', 'Diamonds!', 'Minecraft', 'dragon'],
  ['deeper', 'We Need to Go Deeper', 'Minecraft', 'dragon'],
  ['cover_diamonds', 'Cover Me with Diamonds', 'Minecraft', 'dragon'],
  ['enchanter', 'Enchanter', 'Minecraft', 'partial'],
  ['zombie_doctor', 'Zombie Doctor', 'Minecraft', 'manual'],
  ['eye_spy', 'Eye Spy', 'Minecraft', 'dragon'],
  ['the_end', 'The End?', 'Minecraft', 'dragon'],

  // ---------- Nether (23) ----------
  ['nether', 'Nether', 'Nether', 'dragon'],
  ['return_sender', 'Return to Sender', 'Nether', 'manual'],
  ['those_days', 'Those Were the Days', 'Nether', 'partial'],
  ['hidden_depths', 'Hidden in the Depths', 'Nether', 'auto'],
  ['subspace', 'Subspace Bubble', 'Nether', 'partial'],
  ['fortress', 'A Terrible Fortress', 'Nether', 'dragon'],
  ['crying', 'Who is Cutting Onions?', 'Nether', 'partial'],
  ['oh_shiny', 'Oh Shiny', 'Nether', 'auto'],
  ['boat_legs', 'This Boat Has Legs', 'Nether', 'partial'],
  ['uneasy', 'Uneasy Alliance', 'Nether', 'manual'],
  ['war_pigs', 'War Pigs', 'Nether', 'partial'],
  ['debris', 'Cover Me in Debris', 'Nether', 'partial'],
  ['skull', 'Spooky Scary Skeleton', 'Nether', 'partial'],
  ['into_fire', 'Into Fire', 'Nether', 'dragon'],
  ['nine_lives', 'Not Quite "Nine" Lives', 'Nether', 'partial'],
  ['feels_home', 'Feels Like Home', 'Nether', 'manual'],
  ['hot_tourist', 'Hot Tourist Destinations', 'Nether', 'auto'],
  ['wither', 'Withering Heights', 'Nether', 'partial'],
  ['brewery', 'Local Brewery', 'Nether', 'partial'],
  ['beacon_home', 'Bring Home the Beacon', 'Nether', 'partial'],
  ['cocktail', 'A Furious Cocktail', 'Nether', 'manual'],
  ['beaconator', 'Beaconator', 'Nether', 'partial'],
  ['how_did_we', 'How Did We Get Here?', 'Nether', 'manual'],

  // ---------- The End (9) ----------
  ['end_tab', 'The End', 'The End', 'dragon'],
  ['free_end', 'Free the End', 'The End', 'dragon'],
  ['next_gen', 'The Next Generation', 'The End', 'partial'],
  ['remote', 'Remote Getaway', 'The End', 'partial'],
  ['end_again', 'The End... Again...', 'The End', 'auto'],
  ['mint', 'You Need a Mint', 'The End', 'partial'],
  ['city', 'The City at the End of the Game', 'The End', 'partial'],
  ['skys_limit', "Sky's the Limit", 'The End', 'partial'],
  ['great_view', 'Great View From Up Here', 'The End', 'partial'],

  // ---------- Adventure (47) ----------
  ['adventure', 'Adventure', 'Adventure', 'dragon'],
  ['voluntary_exile', 'Voluntary Exile', 'Adventure', 'partial'],
  ['bird', 'Is It a Bird?', 'Adventure', 'partial'],
  ['monster_hunter', 'Monster Hunter', 'Adventure', 'dragon'],
  ['power_books', 'The Power of Books', 'Adventure', 'manual'],
  ['deal', 'What a Deal!', 'Adventure', 'partial'],
  ['new_look', 'Crafting a New Look', 'Adventure', 'partial'],
  ['sticky', 'Sticky Situation', 'Adventure', 'partial'],
  ['betsy', "Ol' Betsy", 'Adventure', 'auto'],
  ['surge', 'Surge Protector', 'Adventure', 'manual'],
  ['caves_cliffs', 'Caves & Cliffs', 'Adventure', 'partial'],
  ['remnants', 'Respecting the Remnants', 'Adventure', 'partial'],
  ['sneak100', 'Sneak 100', 'Adventure', 'manual'],
  ['sweet_dreams', 'Sweet Dreams', 'Adventure', 'auto'],
  ['scute', "Isn't It Scute?", 'Adventure', 'partial'],
  ['trials', 'Minecraft: Trial(s) Edition', 'Adventure', 'partial'],
  ['crafters', 'Crafters Crafting Crafters', 'Adventure', 'partial'],
  ['lode', 'Country Lode, Take Me Home', 'Adventure', 'auto'],
  ['heart_transplanter', 'Heart Transplanter', 'Adventure', 'manual'],
  ['hero', 'Hero of the Village', 'Adventure', 'partial'],
  ['balloon', 'Is It a Balloon?', 'Adventure', 'partial'],
  ['throwaway', 'A Throwaway Joke', 'Adventure', 'manual'],
  ['spreads', 'It Spreads', 'Adventure', 'manual'],
  ['take_aim', 'Take Aim', 'Adventure', 'dragon'],
  ['monsters_hunted', 'Monsters Hunted', 'Adventure', 'partial'],
  ['postmortal', 'Postmortal', 'Adventure', 'manual'],
  ['kabob', 'Mob Kabob', 'Adventure', 'manual'],
  ['hired', 'Hired Help', 'Adventure', 'partial'],
  ['star_trader', 'Star Trader', 'Adventure', 'manual'],
  ['smithing_style', 'Smithing with Style', 'Adventure', 'manual'],
  ['two_birds', 'Two Birds, One Arrow', 'Adventure', 'partial'],
  ['whos_pillager', "Who's the Pillager Now?", 'Adventure', 'partial'],
  ['arbalistic', 'Arbalistic', 'Adventure', 'manual'],
  ['restoration', 'Careful Restoration', 'Adventure', 'partial'],
  ['adventuring_time', 'Adventuring Time', 'Adventure', 'partial'],
  ['sound_music', 'Sound of Music', 'Adventure', 'manual'],
  ['light_rabbit', 'Light as a Rabbit', 'Adventure', 'partial'],
  ['plane', 'Is It a Plane?', 'Adventure', 'partial'],
  ['frightening', 'Very Very Frightening', 'Adventure', 'manual'],
  ['sniper', 'Sniper Duel', 'Adventure', 'partial'],
  ['bullseye', 'Bullseye', 'Adventure', 'partial'],
  ['lighten_up', 'Lighten Up', 'Adventure', 'auto'],
  ['rockets', 'Who Needs Rockets?', 'Adventure', 'manual'],
  ['lock_key', 'Under Lock and Key', 'Adventure', 'partial'],
  ['revaulting', 'Revaulting', 'Adventure', 'manual'],
  ['blowback', 'Blowback', 'Adventure', 'manual'],
  ['overkill', 'Over-Overkill', 'Adventure', 'manual'],

  // ---------- Husbandry (30 répertoriés) ----------
  ['bee_guest', 'Bee Our Guest', 'Husbandry', 'partial'],
  ['parrots_bats', 'The Parrots and the Bats', 'Husbandry', 'auto'],
  ['friend_in_me', "You've Got a Friend in Me", 'Husbandry', 'manual'],
  ['goat_boat', 'Whatever Floats Your Goat!', 'Husbandry', 'partial'],
  ['best_friends', 'Best Friends Forever', 'Husbandry', 'auto'],
  ['glow_behold', 'Glow and Behold!', 'Husbandry', 'partial'],
  ['fishy', 'Fishy Business', 'Husbandry', 'auto'],
  ['beelocation', 'Total Beelocation', 'Husbandry', 'partial'],
  ['bukkit', 'Bukkit Bukkit', 'Husbandry', 'partial'],
  ['smells', 'Smells Interesting', 'Husbandry', 'partial'],
  ['seedy', 'A Seedy Place', 'Husbandry', 'auto'],
  ['hydrated', 'Stay Hydrated!', 'Husbandry', 'manual'],
  ['wax_on', 'Wax On', 'Husbandry', 'partial'],
  ['wax_off', 'Wax Off', 'Husbandry', 'partial'],
  ['two_by_two', 'Two by Two', 'Husbandry', 'partial'],
  ['birthday', 'Birthday Song', 'Husbandry', 'manual'],
  ['catalogue', 'A Complete Catalogue', 'Husbandry', 'partial'],
  ['tactical', 'Tactical Fishing', 'Husbandry', 'partial'],
  ['squad', 'When the Squad Hops into Town', 'Husbandry', 'manual'],
  ['little_sniffs', 'Little Sniffs', 'Husbandry', 'manual'],
  ['planting_past', 'Planting the Past', 'Husbandry', 'manual'],
  ['balanced_diet', 'A Balanced Diet', 'Husbandry', 'partial'],
  ['serious', 'Serious Dedication', 'Husbandry', 'partial'],
  ['cutest', 'The Cutest Predator', 'Husbandry', 'partial'],
  ['froglights', 'With Our Powers Combined!', 'Husbandry', 'manual'],
  ['healing', 'The Healing Power of Friendship!', 'Husbandry', 'partial'],
  ['shear_brilliance', 'Shear Brilliance', 'Husbandry', 'manual'],
  ['good_new', 'Good as New', 'Husbandry', 'manual'],
  ['whole_pack', 'The Whole Pack', 'Husbandry', 'partial'],
  ['uh_oh', 'Uh Oh', 'Husbandry', 'manual']
]

const byKey = Object.fromEntries(CATALOG.map(([key, name, tab, status]) => [key, { key, name, tab, status }]))

// ---------- Tracker ----------

function loadProgress () {
  try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')) } catch { return {} }
}
function saveProgress (p) {
  try { fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2)) } catch (e) { log(`sauvegarde impossible : ${e.message}`) }
}

// Enregistre une tentative de succès ('ok' = réussi, 'attempt' = tenté sans garantie)
function record (bot, keys, result = 'ok') {
  const p = loadProgress()
  p.adv ??= {}
  for (const k of keys) {
    if (p.adv[k] !== 'ok') p.adv[k] = result
  }
  saveProgress(p)
  for (const k of keys) {
    const a = byKey[k]
    if (a) log(`${result === 'ok' ? '🏆' : '⏳'} Succès : ${a.name}${result === 'ok' ? '' : ' (tenté)'}`)
  }
  say(bot, `${result === 'ok' ? '🏆' : '⏳'} Succès : ${byKey[keys[0]]?.name ?? keys[0]}`)
}

function summary (bot) {
  const p = loadProgress()
  const adv = p.adv ?? {}
  let dragon = 0, auto = 0, partial = 0, manual = 0
  let gotDragon = 0, gotAuto = 0, gotPartial = 0
  const missingAuto = []
  const missingPartial = []
  for (const [key] of CATALOG) {
    const a = byKey[key]
    const has = adv[key] === 'ok' || adv[key] === 'attempt'
    if (a.status === 'dragon') { dragon++; if (p.done?.includes('dragon')) gotDragon++ }
    else if (a.status === 'auto') { auto++; if (adv[key]) gotAuto++; else missingAuto.push(a.name) }
    else if (a.status === 'partial') { partial++; if (has) gotPartial++; else missingPartial.push(a.name) }
    else manual++
  }
  say(bot, `📊 Succès : ${gotDragon}/${dragon} via dragon, ${gotAuto}/${auto} automatisés, ${gotPartial}/${partial} tentés, ${manual} manuels (à faire à la main).`)
  if (missingAuto.length) say(bot, `⏳ Auto restants : ${missingAuto.join(', ')}`)
  if (missingPartial.length) say(bot, `🎲 À tenter : ${missingPartial.slice(0, 10).join(', ')}${missingPartial.length > 10 ? '…' : ''}`)
  return { gotDragon, dragon, gotAuto, auto, gotPartial, partial, manual }
}

module.exports = { CATALOG, byKey, record, summary, loadProgress, saveProgress }
