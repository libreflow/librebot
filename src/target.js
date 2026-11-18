// Cible de connexion courante (LAN local ou serveur distant type Aternos),
// avec bascule automatique (fallback) si la cible est down.
const { resolveTarget } = require('./lan')

let _useAlt = false // false = cible principale (config.lan ? LAN : host), true = l'autre

function getAlt () { return _useAlt }
function setAlt (v) { _useAlt = !!v }
function flipAlt () { _useAlt = !_useAlt; return _useAlt }

// Cible effective pour la prochaine connexion
function resolve (cfg) {
  const lanTarget = resolveTarget({ ...cfg, lan: true })
  const remoteTarget = { host: cfg.aternosHost || cfg.host, port: cfg.aternosPort || cfg.port, lan: false }
  if (cfg.lan) return _useAlt ? remoteTarget : lanTarget
  return _useAlt ? lanTarget : remoteTarget
}

function label (cfg, target) {
  if (target.lan === false && _useAlt) return 'Aternos (' + target.host + ':' + target.port + ')'
  if (cfg.lan && !_useAlt) return 'LAN local (' + target.host + ':' + target.port + ')'
  return target.host + ':' + target.port
}

module.exports = { resolve, label, getAlt, setAlt, flipAlt }
