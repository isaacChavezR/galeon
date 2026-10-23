// Galeón — motor del escudo, puro y testeable.
// Semántica de la blocklist (generada por scripts/fetch-easylist.js):
//   domains:  { "dominio", ... }               → bloqueo de dominio entero
//   paths:    { "dominio": ["/ruta/", ...] }   → solo esas rutas
//   tpDomains:{ "dominio", ... }               → solo cuando lo carga OTRO sitio
//   tpPaths:  { "dominio": ["/ruta/", ...] }   → ruta + solo tercera parte
// Invariante de seguridad: la navegación principal (mainFrame) nunca aplica
// reglas de tercera parte — un error de lista jamás impide abrir un sitio.

const FALLBACK_TRACKERS = [
  'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
  'doubleclick.net', 'ads-twitter.com', 'analytics.tiktok.com', 'ads.linkedin.com',
  'hotjar.com', 'mixpanel.com', 'segment.io', 'clarity.ms', 'scorecardresearch.com',
  'quantserve.com', 'criteo.com', 'taboola.com', 'outbrain.com', 'adnxs.com', 'mc.yandex.ru'
];

function buildShield(listJson, extraDomains) {
  const domains = new Set(extraDomains && extraDomains.length ? extraDomains : FALLBACK_TRACKERS);
  const paths = {};
  const tpDomains = new Set();
  const tpPaths = {};
  let updated = null;
  if (listJson) {
    for (const d of listJson.domains || []) domains.add(d);
    Object.assign(paths, listJson.paths || {});
    for (const d of listJson.tpDomains || []) tpDomains.add(d);
    Object.assign(tpPaths, listJson.tpPaths || {});
    updated = listJson.updated || null;
  }
  const count = domains.size + Object.keys(paths).length + tpDomains.size + Object.keys(tpPaths).length;

  // Coincidencia de ruta con frontera: '/ads' calza '/ads' y '/ads/x' pero no '/adsfoo'
  function rutaCalza(path, regla) {
    const r = regla.replace(/\/+$/, '');
    if (!r) return true;
    return path === r || path.startsWith(r + '/');
  }

  // Dominio base aproximado (últimas dos etiquetas): www.google.com → google.com.
  // Con co.uk se queda corto, pero el error es en la dirección segura (tratar
  // algo como primera parte nunca rompe un sitio; al revés sí).
  function baseDominio(h) {
    const p = h.split('.');
    return p.slice(-2).join('.');
  }

  // u: URL ya parseada (new URL). docHost: host de la página que pide el recurso.
  function isTracker(u, docHost, esMainFrame) {
    const host = u.hostname;
    const path = u.pathname;
    const esTerceraParte = docHost && baseDominio(docHost) !== baseDominio(host);
    let h = host;
    while (h) {
      if (domains.has(h)) return true;
      if (!esMainFrame) {
        const ps = paths[h];
        if (ps) for (const p of ps) if (rutaCalza(path, p)) return true;
        if (esTerceraParte) {
          if (tpDomains.has(h)) return true;
          const tps = tpPaths[h];
          if (tps) for (const p of tps) if (rutaCalza(path, p)) return true;
        }
      }
      const dot = h.indexOf('.');
      if (dot < 0) break;
      h = h.substring(dot + 1);
    }
    return false;
  }

  return { isTracker, meta: { count, updated, domains, paths, tpDomains, tpPaths } };
}

module.exports = { buildShield, FALLBACK_TRACKERS };
