// Condensa EasyList + EasyPrivacy en assets/blocklist.json.
// Reglas POR DOMINIO y POR RUTA: "dominio" (bloqueo entero) y "dominio/ruta"
// (solo esa sección del sitio). Se descartan reglas con modificadores ($popup,
// $third-party…) y filtros cosméticos (##): su semántica no es "bloquear siempre".
// Uso: node scripts/fetch-easylist.js
// Fuente pública: https://easylist.to/ — licencia CC-BY-SA 3.0 (atribución en el README).
const fs = require('fs');
const path = require('path');
const https = require('https');

const SOURCES = [
  { name: 'easylist', urls: [
    'https://easylist.to/easylist/easylist.txt',
    'https://raw.githubusercontent.com/easylist/easylist/master/easylist.txt'
  ]},
  { name: 'easyprivacy', urls: [
    'https://easylist.to/easylist/easyprivacy.txt',
    'https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy.txt'
  ]}
];

function fetch(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'galeon-build/0.1' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function fetchFirst(urls) {
  let lastErr;
  for (const u of urls) {
    try { return await fetch(u); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const DOM_RE = /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/i;

// Extrae dominios enteros, dominios con ruta, y su variante "solo tercera parte"
// ($third-party: bloquea únicamente cuando el recurso lo carga OTRO sitio).
function extract(text, domains, paths, tpDomains, tpPaths) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('@@') || line.startsWith('#')) continue;
    if (line.includes('##') || line.includes('#@#')) continue;

    let cuerpo = line;
    let soloTerceros = false;
    const dolar = line.indexOf('$');
    if (dolar >= 0) {
      const mods = line.slice(dolar + 1);
      cuerpo = line.slice(0, dolar);
      const utiles = mods.includes('third-party') || mods.includes('3p');
      const vetadas = /popup|document|genericblock|generichide|badfilter|websocket|webrtc|ping/.test(mods);
      if (!utiles || vetadas) continue;
      soloTerceros = true;
    }
    if (!cuerpo.startsWith('||')) continue;

    // Acepta ||dominio^, ||dominio^/ruta, ||dominio/ruta y ||dominio (el ^ es opcional)
    const m = cuerpo.slice(2).match(/^([^/$^]+)(?:\^?([^$]*))?$/);
    if (!m) continue;
    const dom = m[1].toLowerCase();
    if (!DOM_RE.test(dom) || dom.length < 4) continue;
    const ruta = (m[2] || '').split('#')[0].split('?')[0];

    const addRuta = (map) => {
      if (!map[dom]) map[dom] = [];
      map[dom].push(ruta.startsWith('/') ? ruta : '/' + ruta);
    };
    if (!ruta || ruta === '/') {
      if (soloTerceros) tpDomains.add(dom); else domains.add(dom);
    } else {
      addRuta(soloTerceros ? tpPaths : paths);
    }
  }
}

(async () => {
  if (require.main !== module) return; // exportado para tests: no autoejecutar
  const domains = new Set();
  const paths = {};
  const tpDomains = new Set();
  const tpPaths = {};
  const meta = {};
  for (const src of SOURCES) {
    const text = await fetchFirst(src.urls);
    const antes = domains.size;
    extract(text, domains, paths, tpDomains, tpPaths);
    for (const d of Object.keys(paths)) domains.delete(d);
    for (const d of Object.keys(tpPaths)) tpDomains.delete(d);
    meta[src.name] = domains.size - antes;
    console.log(`${src.name}: ${meta[src.name]} dominios enteros`);
  }
  const total = domains.size + Object.keys(paths).length + tpDomains.size + Object.keys(tpPaths).length;
  const out = {
    updated: new Date().toISOString(),
    sources: meta,
    total,
    domains: [...domains].sort(),
    paths,
    tpDomains: [...tpDomains].sort(),
    tpPaths
  };
  const dest = path.join(__dirname, '..', 'assets', 'blocklist.json');
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`TOTAL: ${total} entradas (${out.domains.length} dom + ${Object.keys(paths).length} rutas + ${out.tpDomains.length} dom 3P + ${Object.keys(tpPaths).length} rutas 3P) -> ${dest}`);
})().catch((e) => { console.error('FALLO', e.message); process.exit(1); });

module.exports = { extract };
