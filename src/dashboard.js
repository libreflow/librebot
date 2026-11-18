// ============================================================
// LibreBot — src/dashboard.js
// Dashboard web temps réel sur http://localhost:3000
// API JSON sur /api/* + page HTML auto-refresh 3s
// ============================================================
const http = require('http')

function startDashboard (getState, port) {
  port = port || 3000
  const server = http.createServer((req, res) => {
    const url = req.url || '/'
    if (url.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      try {
        const state = getState()
        const routes = {
          '/api/state': state,
          '/api/env': state.env,
          '/api/mission': state.mission,
          '/api/map': state.mapStats,
          '/api/learn': state.learn,
          '/api/decision': state.decision,
          '/api/logs': state.logs ?? []
        }
        res.end(JSON.stringify(routes[url] || { error: 'not found', routes: Object.keys(routes) }, null, 2))
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(renderHTML())
  })
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.log('⚠️ Dashboard : port ' + port + ' déjà utilisé')
    else console.log('⚠️ Dashboard erreur : ' + e.message)
  })
  server.listen(port, () => console.log('📊 Dashboard web sur http://localhost:' + port))
  return server
}

function renderHTML () {
  const css = 'body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px}h1{color:#58a6ff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}h2{color:#58a6ff;font-size:15px;margin-bottom:8px;border-bottom:1px solid #30363d;padding-bottom:4px}.bar{background:#30363d;border-radius:4px;height:16px;overflow:hidden;margin:4px 0}.bar>div{height:100%;background:#238636}.row{display:flex;justify-content:space-between;font-size:13px;padding:2px 0}.ok{color:#3fb950}.warn{color:#d29922}.bad{color:#f85149}.tag{display:inline-block;background:#21262d;border:1px solid #30363d;border-radius:12px;padding:2px 8px;font-size:11px;margin:2px}.hostile{border-color:#f85149!important;color:#f85149}.animal{border-color:#3fb950!important;color:#3fb950}.structure{border-color:#58a6ff!important;color:#58a6ff}pre{font-size:11px;background:#0d1117;padding:8px;border-radius:4px}'
  const js = [
    'async function refresh(){',
    'document.getElementById("time").textContent=new Date().toLocaleTimeString("fr-FR");',
    'try{',
    'const [s,env,mission,map,learn,dec]=await Promise.all([fetch("/api/state").then(r=>r.json()),fetch("/api/env").then(r=>r.json()),fetch("/api/mission").then(r=>r.json()),fetch("/api/map").then(r=>r.json()),fetch("/api/learn").then(r=>r.json()),fetch("/api/decision").then(r=>r.json())]);',
    'const hp=s.health||0,food=s.food||0;',
    'const hpC=hp>14?"ok":hp>7?"warn":"bad",foodC=food>14?"ok":food>7?"warn":"bad";',
    'const ent=(env&&env.entities||[]).slice(0,10).map(e=>"<span class=\\"tag "+e.kind+"\\">"+e.name+" @"+e.dist+"m"+(e.hostile?" !":"")+"</span>").join("")||"aucune";',
    'const struct=(env&&env.structures||[]).map(s=>"<span class=\\"tag structure\\">"+s+"</span>").join("")||"aucune";',
    'const res=(env&&env.resources||[]).slice(0,8).map(r=>"<span class=tag>"+r.kind+" @"+r.dist+"m</span>").join("")||"aucune";',
    'document.getElementById("grid").innerHTML=',
    '"<div class=card><h2>Etat du bot</h2>"',
    '+"<div class=row><span>Vie</span><span class="+hpC+">"+Math.round(hp)+"/20</span></div><div class=bar><div style=width:"+(hp*5)+"%></div></div>"',
    '+"<div class=row><span>Faim</span><span class="+foodC+">"+Math.round(food)+"/20</span></div><div class=bar><div style=width:"+(food*5)+"%></div></div>"',
    '+"<div class=row><span>Pos</span><span>("+s.x+","+s.y+","+s.z+")</span></div>"',
    '+"<div class=row><span>Dim</span><span>"+s.dimension+"</span></div>"',
    '+"<div class=row><span>Biome</span><span>"+((env&&env.biome)||"?")+"</span></div>"',
    '+"<div class=row><span>Fuite</span><span class="+(s.fleeing?"bad":"ok")+">"+(s.fleeing?"OUI":"non")+"</span></div></div>"',
    '+"<div class=card><h2>Mission</h2><div class=row><span>Phase</span><span>"+(mission.currentPhase||"-")+"</span></div>"',
    '+"<div class=row><span>Progres</span><span>"+mission.done+"/"+mission.total+"</span></div>"',
    '+"<div class=bar><div style=width:"+(mission.done/mission.total*100)+"%></div></div></div>"',
    '+"<div class=card><h2>Decision</h2><div class=row><span>Action</span><span class=ok>"+(dec?dec.action:"?")+"</span></div>"',
    '+"<div class=row><span>Score</span><span>"+(dec?dec.score:0)+"</span></div><pre>"+(dec?dec.reason:"")+"</pre></div>"',
    '+"<div class=card><h2>Entites proches</h2>"+ent+"</div>"',
    '+"<div class=card><h2>Structures</h2>"+struct+"<h2 style=margin-top:8px>Ressources</h2>"+res+"</div>"',
    '+"<div class=card><h2>Carte</h2><div class=row><span>Chunks</span><span>"+map.chunks+"</span></div><div class=row><span>POIs</span><span>"+map.pois+"</span></div><div class=row><span>Dangers</span><span>"+map.dangerZones+"</span></div></div>"',
    '+"<div class=card><h2>Apprentissage</h2><div class=row><span>Episodes</span><span>"+learn.episodes+"</span></div><div class=row><span>Q-states</span><span>"+learn.qstates+"</span></div><div class=row><span>Morts</span><span>"+learn.deaths+"</span></div></div>";',
    '}catch(e){document.getElementById("grid").innerHTML="<div class=card>Erreur: "+e.message+"</div>"}',
    '}',
    'refresh();setInterval(refresh,3000);'
  ].join('')
  return '<!DOCTYPE html><html lang=fr><head><meta charset=utf-8><title>LibreBot Dashboard</title><meta http-equiv=refresh content=3><style>' + css + '</style></head><body>'
    + '<h1>LibreBot Dashboard</h1><div style="color:#8b949e;margin-bottom:16px">Auto-refresh 3s — <span id="time"></span> — <a style="color:#58a6ff" href="/api/state">API JSON</a></div>'
    + '<div class="grid" id="grid">Chargement...</div>'
    + '<script>' + js + '</script></body></html>'
}

module.exports = { startDashboard }
