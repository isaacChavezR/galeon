// Tests del escudo de Galeón — node --test test/
// Nacieron del bug real que bloqueaba google.com entero por una regla
// ||google.com/analytics/$third-party mal condensada. Que no vuelva a pasar.
const test = require('node:test');
const assert = require('node:assert');
const { buildShield } = require('../shield-core');
const { extract } = require('../scripts/fetch-easylist.js');

const U = (s) => new URL(s);

// ---------- Motor de bloqueo ----------
const escudo = buildShield({
  domains: ['adnxs.com', 'track.ejemplo.com'],
  paths: { 'video.tube': ['/ads/', '/tracker.js'] },
  tpDomains: ['stats.tercero.com'],
  tpPaths: { 'google.com': ['/analytics/', '/ccm/'] }
});

test('dominio entero bloquea en cualquier contexto', () => {
  assert.ok(escudo.isTracker(U('https://adnxs.com/x'), 'noticias.com', false));
  assert.ok(escudo.isTracker(U('https://adnxs.com/'), 'adnxs.com', false));
});

test('sufijo: ads.ejemplo.com cae por track.ejemplo.com', () => {
  assert.ok(escudo.isTracker(U('https://ads.track.ejemplo.com/pixel'), 'otro.com', false));
});

test('regla de ruta solo bloquea esa ruta (con frontera)', () => {
  assert.ok(escudo.isTracker(U('https://video.tube/ads/banner'), 'x.com', false));
  assert.ok(escudo.isTracker(U('https://video.tube/ads?a=1'), 'x.com', false));
  assert.ok(escudo.isTracker(U('https://video.tube/ads'), 'x.com', false));
  assert.ok(!escudo.isTracker(U('https://video.tube/adsfoo'), 'x.com', false));
  assert.ok(!escudo.isTracker(U('https://video.tube/videos/gatos'), 'x.com', false));
});

test('EL BUG HISTÓRICO: google.com/analytics 3P no bloquea la home de google', () => {
  // como tercera parte en otro sitio: bloqueado (ruta bajo el directorio /analytics/)
  assert.ok(escudo.isTracker(U('https://www.google.com/analytics/collect?x=1'), 'noticias.com', false));
  // '/analytics.js' NO está bajo '/analytics/' (semántica ABP): libre
  assert.ok(!escudo.isTracker(U('https://www.google.com/analytics.js'), 'noticias.com', false));
  // como parte propia (dentro de google): libre
  assert.ok(!escudo.isTracker(U('https://www.google.com/analytics/x'), 'google.com', false));
  // navegación principal: JAMÁS bloqueada por reglas 3P
  assert.ok(!escudo.isTracker(U('https://www.google.com/analytics/x'), 'otro.com', true));
  // la home de google: libre siempre
  assert.ok(!escudo.isTracker(U('https://www.google.com/'), 'x.com', true));
  assert.ok(!escudo.isTracker(U('https://www.google.com/search?q=gatos'), 'x.com', true));
});

test('dominio 3P solo bloquea en tercera parte', () => {
  assert.ok(escudo.isTracker(U('https://stats.tercero.com/p'), 'blog.com', false));
  assert.ok(!escudo.isTracker(U('https://stats.tercero.com/p'), 'stats.tercero.com', false));
});

// ---------- Extractor de EasyList ----------
function extraer(lineas) {
  const d = new Set(), p = {}, tpd = new Set(), tpp = {};
  extract(lineas.join('\n'), d, p, tpd, tpp);
  return { d: [...d], p, tpd: [...tpd], tpp };
}

test('regla pura → dominio entero', () => {
  const r = extraer(['||ads.ejemplo.com^']);
  assert.deepEqual(r.d, ['ads.ejemplo.com']);
});

test('regla $third-party → solo tercera parte (no dominio entero)', () => {
  const r = extraer(['||google.com/analytics/$third-party']);
  assert.ok(!r.d.includes('google.com'));
  assert.deepEqual(r.tpp['google.com'], ['/analytics/']);
});

test('regla $popup se descarta', () => {
  const r = extraer(['||doubleclick.net^$popup']);
  assert.ok(!r.d.includes('doubleclick.net'));
});

test('excepciones @@ y filtros cosméticos ## se descartan', () => {
  const r = extraer(['@@||bien.com^', '##.anuncio', 'ejemplo.com#@#.ads']);
  assert.ok(r.d.length === 0);
});

test('regla con ruta y sin ^ se parsea', () => {
  const r = extraer(['||dominio.com/ruta/de/ads']);
  assert.deepEqual(r.p['dominio.com'], ['/ruta/de/ads']);
});

// ---------- Sanidad de la lista REAL ----------
const lista = require('../assets/blocklist.json');

test('los sitios grandes NO están como dominio entero en la lista real', () => {
  const grandes = [
    'google.com', 'www.google.com', 'youtube.com', 'facebook.com', 'instagram.com',
    'wikipedia.org', 'es.wikipedia.org', 'duckduckgo.com', 'html.duckduckgo.com',
    'startpage.com', 'mojeek.com', 'github.com', 'x.com', 'twitter.com',
    'amazon.com', 'mercadolibre.com', 'eldiario.es', 'openstreetmap.org'
  ];
  const mal = grandes.filter(d => lista.domains.includes(d));
  assert.deepEqual(mal, [], `BLOQUEADOS POR ERROR: ${mal.join(', ')}`);
});

test('los trackers clásicos SÍ tienen cobertura en la lista real', () => {
  const cubierto = (d) => lista.domains.includes(d) || lista.tpDomains.includes(d);
  assert.ok(cubierto('google-analytics.com'), 'google-analytics sin cobertura');
  assert.ok(cubierto('criteo.com'), 'criteo sin cobertura');
  assert.ok(cubierto('adnxs.com'), 'adnxs sin cobertura');
  assert.ok(cubierto('scorecardresearch.com'), 'scorecardresearch sin cobertura');
});

test('la lista tiene volumen razonable (>50k entradas)', () => {
  const total = lista.domains.length + Object.keys(lista.paths || {}).length +
    (lista.tpDomains || []).length + Object.keys(lista.tpPaths || {}).length;
  assert.ok(total > 50000, `lista sospechosamente pequeña: ${total}`);
});
