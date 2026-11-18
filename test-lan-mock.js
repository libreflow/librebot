// Découverte LAN : multicast Open-to-LAN + priorités de résolution du port
const dgram = require('dgram')
let fails = 0
const check = (c, m) => { console.log((c ? '✓' : '✗ FAIL') + ' ' + m); if (!c) fails++ }
const lan = require('./src/lan')

const main = async () => {
  // 1. annonce simulée [MOTD]...[AD]<port> -> port découvert
  const tx = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  setTimeout(() => { try { tx.send(Buffer.from("[MOTD]Rbxsnx's local game[AD]61871"), 4445, '224.0.2.60', () => {}) } catch {} }, 500)
  const p1 = await lan.listenLanAnnounce(3000)
  check(p1 === 61871, 'annonce Open-to-LAN simulée → port 61871 découvert')
  try { tx.close() } catch {}

  // 2. pas d'annonce dans les délais -> null (pas de blocage)
  const p2 = await lan.listenLanAnnounce(1200)
  check(p2 === null, 'aucune annonce → null après timeout (pas de blocage)')

  // 3. priorité de résolution : lanPort explicite gagne sur tout
  const t1 = lan.resolveTarget({ lan: true, lanPort: 25565, lanHost: '127.0.0.1' }, __dirname)
  check(t1 && t1.port === 25565, 'lanPort explicite prioritaire (pas besoin de logs/multicast)')

  // 4. logs du client Minecraft toujours lus en repli
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'lb-'))
  require('fs').writeFileSync(require('path').join(dir, 'latest.log'), 'Local game hosted on port 54321')
  const t2 = lan.resolveTarget({ lan: true }, dir)
  check(t2 && t2.port === 54321, 'repli lecture logs latest.log (« hosted on port »)')

  console.log(fails === 0 ? '\nTOUS LES TESTS OK' : '\n' + fails + ' ÉCHECS')
  process.exit(fails === 0 ? 0 : 1)
}
main()
