// Galeón — proceso principal
// Privacidad: sin telemetría, todo se guarda solo en este equipo.
const { app, BrowserWindow, session, ipcMain, shell, Menu, clipboard, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const BOTTLES_PER_SEARCHES = 10;   // 1 botella retirada por cada 10 búsquedas (demo)
const KG_PER_BOTTLE = 0.025;       // una botella PET de 500 ml pesa ~25 g
const HISTORY_LIMIT = 300;

// --- Escudo: dominios de EasyList + EasyPrivacy + lista propia de respaldo ---
// Motor en shield-core.js (puro y con tests en test/shield.test.js).
// blocklist.json se regenera con `npm run blocklist` (fuentes CC-BY-SA, ver README)
const { buildShield, FALLBACK_TRACKERS } = require('./shield-core');
let escudoGaleon;
try {
  escudoGaleon = buildShield(JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'blocklist.json'), 'utf8')), FALLBACK_TRACKERS);
} catch (e) {
  console.warn('Galeón: blocklist.json no disponible, usando lista mínima');
  escudoGaleon = buildShield(null, FALLBACK_TRACKERS);
}
const blocklistMeta = escudoGaleon.meta;

const SEARCH_HOSTS = ['duckduckgo.com', 'startpage.com', 'mojeek.com'];

// --- Limpieza de enlaces: parámetros de rastreo que no viajan contigo (estilo Brave) ---
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'twclid', 'ttclid',
  'igshid', 'igsh', 'mc_cid', 'mc_eid', 'vmcid', 'yclid', '_hsenc', '_hsmi',
  'vero_id', 'oly_anon_id', 'oly_enc_id', 'wickedid', 'hsa_cam', 'hsa_grp',
  'hsa_ad', 'hsa_src', 'hsa_tgt', 'hsa_kw', 'hsa_mt', 'hsa_net', 'hsa_ver',
  'ref_src', 'ref_url', 'referrer', 'spm', 'scm', 'share_source', 'si'
]);
function esParametroDeRastreo(nombre) {
  const n = nombre.toLowerCase();
  return TRACKING_PARAMS.has(n) || n.startsWith('utm_') || n.startsWith('utm') || n.startsWith('pk_');
}
function limpiarUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!u.search) return null;
    const originales = [...u.searchParams.keys()];
    const sucios = originales.filter(esParametroDeRastreo);
    if (sucios.length === 0) return null;
    for (const k of originales) if (esParametroDeRastreo(k)) u.searchParams.delete(k);
    return u.toString();
  } catch { return null; }
}

const CAPTURE_TEST = process.argv.includes('--capture-test');
const DEMO_TEST = process.argv.includes('--demo-test'); // abre admin+privada para capturas
const SELF_TEST = process.argv.includes('--selftest');

// --- Estado persistente local ---
let stats = { searches: 0, blockedTotal: 0, blockedSession: 0 };
let history = [];
let prefs = { engine: 'duckduckgo', proyecto: 'motagua' };
const BOOKMARK_SEEDS = [
  { url: 'https://es.wikipedia.org', title: 'Wikipedia' },
  { url: 'https://duckduckgo.com', title: 'DuckDuckGo' },
  { url: 'https://github.com', title: 'GitHub' },
  { url: 'https://www.openstreetmap.org', title: 'OpenStreetMap' }
];
let bookmarks = [];

// Ajustes del usuario (galeon://ajustes) — todo local
const SETTINGS_DEFAULTS = {
  refererTrim: true,     // recorta el Referer a solo el dominio
  httpsOnly: true,       // sube http:// a https:// automáticamente
  sendDntGpc: true,      // cabeceras DNT: 1 y Sec-GPC: 1
  shieldEnabled: true,   // escudo global
  shieldOff: [],         // sitios donde el usuario apagó el escudo
  restoreSession: true,  // reabrir pestañas al arrancar
  acceptLang: 'es',      // 'es' habla español a los sitios; 'neutro' se mezcla con la masa
  httpsOff: [],          // sitios donde el usuario desactivó la subida a https
  zoomByHost: {},        // zoom recordado por sitio
  theme: 'oscuro',       // 'oscuro' | 'claro'
  clearCookiesOnExit: false,
  downloadsDir: '',      // vacío = carpeta Descargas del sistema
  pwdAsk: true,          // ofrecer guardar contraseñas
  pwdNever: [],          // sitios donde dijiste "nunca"
  sleepTabs: true,       // dormir pestañas inactivas para liberar memoria
  themeCustom: {}        // colores personalizados del tema (vacío = por defecto)
};
let settings = { ...SETTINGS_DEFAULTS };
const siteCounts = {}; // bloqueos de esta sesión atribuidos al sitio visitado

let sessPrincipal = null; // referencia para reaplicar idioma en caliente

function dataDir() { return app.getPath('userData'); }
function statsFile() { return path.join(dataDir(), 'galeon-stats.json'); }
function historyFile() { return path.join(dataDir(), 'galeon-history.json'); }
function prefsFile() { return path.join(dataDir(), 'galeon-prefs.json'); }
function bookmarksFile() { return path.join(dataDir(), 'galeon-bookmarks.json'); }
function settingsFile() { return path.join(dataDir(), 'galeon-settings.json'); }
function sessionFile() { return path.join(dataDir(), 'galeon-session.json'); }

function loadJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return { ...fallback }; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (e) { console.error('No se pudo guardar', file, e); }
}

function bottlesFromSearches() { return Math.floor(stats.searches / BOTTLES_PER_SEARCHES); }

let lastSearch = { url: '', ts: 0 };
function isTracker(u, docHost, esMainFrame) {
  return escudoGaleon.isTracker(u, docHost, esMainFrame);
}

function setupShield(sess) {
  sess.setPermissionRequestHandler((wc, permission, callback) => {
    // Discreción por defecto: nada de geolocalización, notificaciones, cámara, etc.
    callback(false);
  });

  sess.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    let url;
    try { url = new URL(details.url); } catch { return callback({}); }
    const host = url.hostname;

    // Enlaces limpios: al navegar, fuera los parámetros de rastreo (utm_*, fbclid…).
    // Solo GET: un redirect convierte POST en GET y rompería inicios de sesión.
    if (details.resourceType === 'mainFrame' && details.method === 'GET') {
      const limpia = limpiarUrl(details.url);
      if (limpia) {
        stats.paramsCleaned = (stats.paramsCleaned || 0) + 1;
        saveJson(statsFile(), stats);
        return callback({ redirectURL: limpia });
      }
    }

    // Navegar a un .user.js abre el instalador en vez de mostrar texto plano
    if (maybeInterceptUserscript(details, callback)) return;

    // HTTPS-solo: los sitios http se suben a https (red local y excepciones del
    // usuario). Solo GET por lo mismo: no romper formularios POST.
    if (settings.httpsOnly && url.protocol === 'http:' && details.method === 'GET' &&
        !/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) &&
        !settings.httpsOff.includes(host)) {
      return callback({ redirectURL: 'https://' + details.url.slice(7) });
    }

    // Contar búsquedas (la unidad que se convierte en botellas)
    if (SEARCH_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
      const q = url.searchParams.get('q') || url.searchParams.get('query');
      if (q && !(details.url === lastSearch.url && Date.now() - lastSearch.ts < 2000)) {
        lastSearch = { url: details.url, ts: Date.now() };
        stats.searches++;
        saveJson(statsFile(), stats);
      }
    }

    // Escudo: decisión global + excepción por sitio (el sitio que visitas, no el recurso)
    let docHost = host;
    try { if (details.documentUrl) docHost = new URL(details.documentUrl).hostname; } catch {}
    const shieldOnHere = settings.shieldEnabled && !settings.shieldOff.includes(docHost);

    if (host && shieldOnHere && isTracker(url, docHost, details.resourceType === 'mainFrame')) {
      stats.blockedTotal++;
      stats.blockedSession++;
      siteCounts[docHost] = (siteCounts[docHost] || 0) + 1;
      saveJson(statsFile(), stats);
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  // Cabeceras de privacidad: DNT, Sec-GPC y Referer recortado a origen
  sess.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const h = details.requestHeaders;
    if (settings.sendDntGpc) {
      h['DNT'] = '1';
      h['Sec-GPC'] = '1';
    }
    if (settings.refererTrim) {
      const key = Object.keys(h).find(k => k.toLowerCase() === 'referer');
      if (key && typeof h[key] === 'string') {
        try { h[key] = new URL(h[key]).origin + '/'; } catch { /* referer raro: lo dejamos */ }
      }
    }
    callback({ requestHeaders: h });
  });
}

function createWindow(opts = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Galeón',
    backgroundColor: '#0A1F3C',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      plugins: true // visor de PDF integrado de Chromium
    }
  });
  windows.add(win);
  if (!mainWindow) mainWindow = win;
  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = [...windows][0] || null;
  });

  // Ventana privada: arranca con pestaña privada; ventana nueva: home fresca (sin restaurar)
  const query = {};
  if (DEMO_TEST) query.demo = '1';
  if (process.argv.includes('--menu-test')) query.menu = '1';
  if (opts.privada) query.privada = '1';
  else if (opts.fresh) query.fresh = '1';
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), Object.keys(query).length ? { query } : undefined);

  // Modo de prueba: captura la ventana y sale (verificación automática)
  if (CAPTURE_TEST || DEMO_TEST) {
    win.webContents.on('did-finish-load', () => setTimeout(doCapture, 3500, win));
    setTimeout(() => { console.log('capture timeout'); app.quit(); }, 15000);
  }
  return win;
}

// Broadcast a todas las ventanas abiertas (descargas, avisos, ajustes)
function sendAll(channel, payload) {
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

ipcMain.handle('win:new', (e, opts) => {
  createWindow({ privada: !!(opts && opts.privada), fresh: true });
  return true;
});

ipcMain.handle('win:fullscreen', () => {
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  if (w && !w.isDestroyed()) w.setFullScreen(!w.isFullScreen());
});

async function doCapture(win) {
  for (let i = 0; i < 4; i++) {
    try {
      const img = await win.webContents.capturePage();
      const png = img.toPNG();
      if (png.length > 0) {
        fs.writeFileSync(path.join(__dirname, 'capture.png'), png);
        console.log('capture ok');
        app.quit();
        return;
      }
    } catch (e) { /* reintenta */ }
    await new Promise(r => setTimeout(r, 700));
  }
  console.error('capture fail: imagen vacía');
  app.quit();
}

// --- Descargas: guardar en la carpeta Descargas del usuario, con progreso visible ---
// Rutas ya elegidas por descargas en curso: evita que dos archivos con el
// mismo nombre pisen el mismo destino (existsSync solo no alcanza)
const descargasEnVuelo = new Set();

function uniquePath(dir, name) {
  let dest = path.join(dir, name);
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let i = 1;
  while (fs.existsSync(dest) || descargasEnVuelo.has(dest)) {
    dest = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  descargasEnVuelo.add(dest);
  return dest;
}

function liberarDescarga(dest) { descargasEnVuelo.delete(dest); }

// Historial de descargas (local, como todo lo demás)
function downloadsFile() { return path.join(dataDir(), 'galeon-downloads.json'); }
let dlHistory = [];
try { dlHistory = JSON.parse(fs.readFileSync(downloadsFile(), 'utf8')) || []; } catch { dlHistory = []; }
function saveDlHistory() {
  dlHistory = dlHistory.slice(-100); // guardamos las últimas 100
  saveJson(downloadsFile(), dlHistory);
}

function setupDownloads(sess) {
  sess.on('will-download', (event, item) => {
    const dir = settings.downloadsDir && fs.existsSync(settings.downloadsDir)
      ? settings.downloadsDir
      : app.getPath('downloads');
    const name = item.getFilename() || 'descarga';
    const dest = uniquePath(dir, name);
    item.setSavePath(dest);
    const send = (o) => sendAll('galeon:download', o);
    send({ name, path: dest, pct: 0 });
    item.on('updated', (_e, state) => {
      if (state === 'progressing') {
        const total = item.getTotalBytes();
        send({ name, path: dest, pct: total ? Math.round((item.getReceivedBytes() / total) * 100) : null });
      }
    });
    item.once('done', (_e, state) => {
      const ok = state === 'completed';
      liberarDescarga(dest);
      send({ name, path: dest, pct: 100, done: true, ok });
      try {
        dlHistory.push({ name, path: dest, url: item.getURL(), ts: Date.now(), ok });
        saveDlHistory();
      } catch {}
    });
  });
}

// Lista y carpeta: solo desde páginas internas
ipcMain.handle('dl:list', (e) => isInternalPage(e) ? [...dlHistory].reverse() : []);
ipcMain.handle('dl:show', (e, ruta) => {
  if (!isInternalPage(e) || typeof ruta !== 'string' || !fs.existsSync(ruta)) return false;
  shell.showItemInFolder(ruta);
  return true;
});

// Captura de la página visible → PNG en Descargas
ipcMain.handle('shot:save', (e, { data, name }) => {
  if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) return null;
  const buf = Buffer.from(data.slice(22), 'base64');
  if (buf.length === 0 || buf.length > 30 * 1024 * 1024) return null;
  const dir = settings.downloadsDir && fs.existsSync(settings.downloadsDir)
    ? settings.downloadsDir : app.getPath('downloads');
  const dest = uniquePath(dir, (name || 'galeon-captura') + '.png');
  fs.writeFileSync(dest, buf);
  try {
    dlHistory.push({ name: path.basename(dest), path: dest, url: 'captura', ts: Date.now(), ok: true });
    saveDlHistory();
  } catch {}
  sendAll('galeon:download', { name: path.basename(dest), path: dest, pct: 100, done: true, ok: true });
  return dest;
});

// --- Idioma que hablamos a los sitios ---
function applyAcceptLang() {
  const langs = settings.acceptLang === 'es' ? ['es', 'en-US', 'en'] : ['en-US', 'en'];
  for (const s of [sessPrincipal, session.fromPartition('galeon-private')]) {
    try { if (s) s.setAcceptLanguages(langs); } catch {}
  }
}

// --- Favicons de primera parte: se descargan SOLO del sitio que visitas, nunca de un tercero ---
const FAVICON_DIR = () => path.join(dataDir(), 'favicons');
function safeName(host) { return host.replace(/[^a-z0-9.-]/gi, '_'); }

ipcMain.handle('favicon:report', (e, { host, url }) => {
  if (!host || !/^https?:\/\//.test(url || '')) return null;
  const destDir = FAVICON_DIR();
  const dest = path.join(destDir, safeName(host));
  if (fs.existsSync(dest)) return dest; // ya lo tenemos
  // descarga en segundo plano, con tope de tamaño
  require('https').get(url, { timeout: 6000 }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return; }
    const len = parseInt(res.headers['content-length'] || '0', 10);
    if (len > 200 * 1024) { res.resume(); return; }
    const chunks = [];
    let total = 0;
    res.on('data', (c) => { total += c.length; if (total > 200 * 1024) { res.destroy(); } else chunks.push(c); });
    res.on('end', () => {
      try { fs.mkdirSync(destDir, { recursive: true }); fs.writeFileSync(dest, Buffer.concat(chunks)); } catch {}
    });
  }).on('error', () => {});
  return dest;
});

ipcMain.handle('favicon:get', (e, host) => {
  if (!host) return null;
  const dest = path.join(FAVICON_DIR(), safeName(host));
  return fs.existsSync(dest) ? dest : null;
});

// --- Menú contextual (clic derecho): lo muestra el proceso principal ---
ipcMain.on('cm:show', (event, p) => {
  const wc = event.sender;
  const items = [];
  if (p.linkURL) {
    items.push(
      { label: 'Abrir enlace en nueva pestaña', click: () => wc.send('cm:action', { type: 'openlink', url: p.linkURL }) },
      { label: 'Copiar dirección del enlace', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.selectionText && p.selectionText.trim()) {
    items.push({ label: 'Copiar', click: () => clipboard.writeText(p.selectionText) }, { type: 'separator' });
  }
  items.push(
    { label: 'Atrás', enabled: !!p.canGoBack, click: () => wc.send('cm:action', { type: 'back' }) },
    { label: 'Adelante', enabled: !!p.canGoForward, click: () => wc.send('cm:action', { type: 'fwd' }) },
    { label: 'Recargar', click: () => wc.send('cm:action', { type: 'reload' }) },
    { type: 'separator' },
    { label: 'Nueva pestaña privada', click: () => wc.send('cm:action', { type: 'newprivate' }) },
    { type: 'separator' },
    { label: 'Seleccionar todo', click: () => wc.send('cm:action', { type: 'selectall' }) },
    { label: 'Buscar en la página…', click: () => wc.send('cm:action', { type: 'find' }) }
  );
  Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) });
});

// --- IPC expuesto a la interfaz ---
ipcMain.handle('stats:get', () => ({
  ...stats,
  bottles: bottlesFromSearches(),
  grams: bottlesFromSearches() * KG_PER_BOTTLE * 1000,
  siteCounts
}));
ipcMain.handle('history:list', () => history.slice(-100).reverse());
ipcMain.handle('history:add', (e, entry) => {
  if (!entry || typeof entry.url !== 'string' || entry.url.startsWith('file:')) return;
  const last = history[history.length - 1];
  if (last && last.url === entry.url) { last.ts = entry.ts; return; } // evita duplicados consecutivos
  history.push({ url: entry.url, title: entry.title || entry.url, ts: entry.ts || Date.now() });
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
  saveJson(historyFile(), history);
});
ipcMain.handle('history:updateTitle', (e, { url, title }) => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].url === url) { history[i].title = title || history[i].title; break; }
  }
  saveJson(historyFile(), history);
});
ipcMain.handle('history:clear', () => { history = []; saveJson(historyFile(), history); });
ipcMain.handle('prefs:get', () => prefs);
ipcMain.handle('prefs:set', (e, patch) => { prefs = { ...prefs, ...patch }; saveJson(prefsFile(), prefs); });
ipcMain.handle('bookmarks:list', () => bookmarks);
ipcMain.handle('bookmarks:toggle', (e, { url, title }) => {
  const i = bookmarks.findIndex(b => b.url === url);
  if (i >= 0) {
    bookmarks.splice(i, 1);
    saveJson(bookmarksFile(), bookmarks);
    return false; // eliminado
  }
  bookmarks.push({ url, title: title || url, ts: Date.now() });
  saveJson(bookmarksFile(), bookmarks);
  return true; // añadido
});
ipcMain.handle('bookmarks:update', (e, { oldUrl, url, title }) => {
  const b = bookmarks.find(x => x.url === oldUrl);
  if (!b || typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
  // si la nueva URL ya existe en otro marcador, no duplicar
  if (url !== oldUrl && bookmarks.some(x => x.url === url)) return false;
  b.url = url;
  b.title = (typeof title === 'string' && title.trim()) ? title.trim() : b.title;
  saveJson(bookmarksFile(), bookmarks);
  return true;
});

// --- Ajustes, datos y sesión ---
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS); // lista blanca: nada de claves arbitrarias
ipcMain.handle('settings:get', () => ({ settings, version: app.getVersion() }));
ipcMain.handle('settings:set', (e, patch) => {
  const clean = {};
  for (const k of SETTING_KEYS) if (k in (patch || {})) clean[k] = patch[k];
  settings = { ...settings, ...clean };
  if (!Array.isArray(settings.shieldOff)) settings.shieldOff = [];
  if (!Array.isArray(settings.httpsOff)) settings.httpsOff = [];
  if (!Array.isArray(settings.pwdNever)) settings.pwdNever = [];
  if (typeof settings.zoomByHost !== 'object' || settings.zoomByHost === null) settings.zoomByHost = {};
  if (typeof settings.themeCustom !== 'object' || settings.themeCustom === null) settings.themeCustom = {};
  saveJson(settingsFile(), settings);
  applyAcceptLang();
  sendAll('settings:changed', settings);
  return settings;
});
ipcMain.handle('data:clear', async (e, { cookies, cache }) => {
  const sess = session.fromPartition('persist:galeon');
  if (cookies) {
    await sess.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
  }
  if (cache) await sess.clearCache();
  return true;
});
ipcMain.handle('session:get', () => {
  try { return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')) || { urls: [] }; }
  catch { return { urls: [] }; }
});
ipcMain.handle('session:save', (e, urls) => {
  if (!Array.isArray(urls)) return;
  saveJson(sessionFile(), { urls: urls.slice(0, 12), ts: Date.now() });
});

// --- Panel de diagnóstico (galeon://admin): solo lectura + acciones locales ---
ipcMain.handle('admin:get', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  blocklist: blocklistMeta,
  paths: { userData: dataDir(), downloads: app.getPath('downloads') },
  stats: { ...stats, bottles: bottlesFromSearches() },
  counts: { bookmarks: bookmarks.length, history: history.length }
}));

ipcMain.handle('admin:export', () => {
  const data = {
    exported: new Date().toISOString(),
    app: 'Galeón',
    version: app.getVersion(),
    stats, bookmarks, history, settings, prefs
  };
  const dest = uniquePath(app.getPath('downloads'), 'galeon-export.json');
  fs.writeFileSync(dest, JSON.stringify(data, null, 2));
  return dest;
});

ipcMain.handle('admin:reset', () => {
  history = [];
  saveJson(historyFile(), history);
  bookmarks = [...BOOKMARK_SEEDS];
  saveJson(bookmarksFile(), bookmarks);
  stats = { searches: 0, blockedTotal: 0, blockedSession: 0 };
  saveJson(statsFile(), stats);
  settings = { ...SETTINGS_DEFAULTS };
  saveJson(settingsFile(), settings);
  try { fs.unlinkSync(sessionFile()); } catch {}
  return true;
});

// --- Contraseñas: cifradas con el sistema (DPAPI en Windows), nunca en claro, nunca salen ---
function passwordsFile() { return path.join(dataDir(), 'galeon-passwords.json'); }
let passwords = [];
try { passwords = JSON.parse(fs.readFileSync(passwordsFile(), 'utf8')) || []; } catch { passwords = []; }
let pwdPending = null; // oferta en espera de respuesta del usuario

function encryptPwd(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  }
  return 'xor:' + Buffer.from(plain, 'utf8').toString('base64'); // sin DPAPI disponible (raro): ofuscado
}
function decryptPwd(entry) {
  if (entry.enc.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(entry.enc.slice(4), 'base64'));
  }
  return Buffer.from(entry.enc.slice(4), 'base64').toString('utf8');
}

function savePasswords() { saveJson(passwordsFile(), passwords); }

const senderOrigin = (e) => { try { return new URL(e.sender.getURL()).origin; } catch { return ''; } };
const isInternalPage = (e) => { try { return e.sender.getURL().startsWith('file:'); } catch { return false; } };

ipcMain.on('pwd:offer', (e, data) => {
  if (!settings.pwdAsk || !data || !data.origin || !data.password) return;
  if (settings.pwdNever.includes(data.origin)) return;
  const exists = passwords.some(p => p.origin === data.origin && p.username === data.username);
  if (exists) return; // ya la tenemos
  pwdPending = data;
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendAll('pwd:ask', { origin: data.origin, username: data.username });
  }
});

ipcMain.on('pwd:answer', (_e, choice) => {
  if (!pwdPending) return;
  if (choice === 'save') {
    passwords = passwords.filter(p => !(p.origin === pwdPending.origin && p.username === pwdPending.username));
    passwords.push({ origin: pwdPending.origin, username: pwdPending.username, enc: encryptPwd(pwdPending.password), ts: Date.now() });
    savePasswords();
  } else if (choice === 'never') {
    settings.pwdNever = [...(settings.pwdNever || []), pwdPending.origin];
    saveJson(settingsFile(), settings);
  }
  pwdPending = null;
});

// Autollenado: solo se entrega al propio origen que la guardó
ipcMain.handle('pwd:lookup', (e, origin) => {
  if (senderOrigin(e) !== origin) return [];
  return passwords
    .filter(p => p.origin === origin)
    .map(p => ({ username: p.username, password: decryptPwd(p) }));
});

// Gestión: solo desde páginas internas (file://)
ipcMain.handle('pwd:list', (e) => isInternalPage(e) ? passwords.map(p => ({ origin: p.origin, username: p.username, ts: p.ts })) : []);
ipcMain.handle('pwd:reveal', (e, { origin, username }) => {
  if (!isInternalPage(e)) return null;
  const p = passwords.find(x => x.origin === origin && x.username === username);
  return p ? decryptPwd(p) : null;
});
ipcMain.handle('pwd:delete', (e, { origin, username }) => {
  if (!isInternalPage(e)) return false;
  passwords = passwords.filter(p => !(p.origin === origin && p.username === username));
  savePasswords();
  return true;
});

// --- Userscripts: las "extensiones" de Galeón, 100% locales ---
function userscriptsFile() { return path.join(dataDir(), 'galeon-userscripts.json'); }
let userscripts = [];
try { userscripts = JSON.parse(fs.readFileSync(userscriptsFile(), 'utf8')) || []; } catch { userscripts = []; }
let usSeq = userscripts.reduce((m, s) => Math.max(m, s.id || 0), 0);
let usPendingInstall = null;

function saveUserscripts() { saveJson(userscriptsFile(), userscripts); }

// Extrae ==UserScript== metadata (nombre, @match, @run-at)
function parseUserScript(code) {
  const meta = { name: 'Script sin nombre', matches: [], runAt: 'end' };
  const m = code.match(/==UserScript==([\s\S]*?)==\/UserScript==/);
  if (!m) return meta;
  for (const line of m[1].split('\n')) {
    let mm = line.match(/@name\s+(.+)/); if (mm) meta.name = mm[1].trim();
    mm = line.match(/@(match|include)\s+(\S+)/);
    if (mm) meta.matches.push(mm[2]);
    mm = line.match(/@run-at\s+(document-start|document-end|document-idle)/);
    if (mm) meta.runAt = mm[1] === 'document-start' ? 'start' : 'end';
  }
  return meta;
}

function matchUrl(pattern, url) {
  try {
    const pu = new URL(url);
    // patrón tipo https://*.dominio.com/ruta
    const pm = pattern.match(/^(\*|https?):\/\/([^/]*)(\/.*)?$/i);
    if (!pm) return false;
    const [, scheme, hostPat, pathPat] = pm;
    if (scheme !== '*' && scheme.toLowerCase() !== pu.protocol.replace(':', '')) return false;
    const hostRe = new RegExp('^' + hostPat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*').replace(/\\\./, '\\.') + '$', 'i');
    // *.ejemplo.com debe calzar sub.dominios y el dominio pelado
    const hostOk = hostPat.startsWith('*.')
      ? (pu.hostname === hostPat.slice(2) || pu.hostname.endsWith('.' + hostPat.slice(2)))
      : hostRe.test(pu.hostname);
    if (!hostOk) return false;
    const pathRe = new RegExp('^' + (pathPat || '/*').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
    return pathRe.test(pu.pathname + pu.search);
  } catch { return false; }
}

ipcMain.handle('us:for', (e, url) => {
  // Lo llama solo el preload (no está expuesto a las páginas), sin guard de origen:
  // en document_start el getURL() del remitente aún no es fiable y rompería la inyección.
  if (!/^https?:/.test(url || '')) return [];
  return userscripts
    .filter(s => s.enabled !== false)
    .filter(s => (s.matches || []).length === 0 || s.matches.some(p => matchUrl(p, url)))
    .map(s => ({ code: s.code, runAt: s.runAt || 'end', nombre: s.name }));
});

// --- Modo desarrollador: consola de scripts, prueba en vivo, export/import ---
const usLogs = [];
ipcMain.on('us:log', (_e, entrada) => {
  if (!entrada || typeof entrada.texto !== 'string') return;
  usLogs.push({ ...entrada, ts: Date.now() });
  while (usLogs.length > 300) usLogs.shift();
});
ipcMain.handle('us:logs:get', (e) => isInternalPage(e) ? [...usLogs].slice(-150).reverse() : []);
ipcMain.handle('us:logs:clear', (e) => { if (isInternalPage(e)) usLogs.length = 0; return true; });

// Prueba sin guardar: ejecuta el código del editor en la pestaña activa de la ventana enfocada
ipcMain.handle('us:test-relay', (e, { code, nombre }) => {
  if (!isInternalPage(e) || typeof code !== 'string' || code.length > 1024 * 1024) return false;
  sendAll('us:test-run', { code, nombre: nombre || 'script de prueba' });
  return true;
});

ipcMain.handle('us:export', (e) => {
  if (!isInternalPage(e)) return null;
  const data = JSON.stringify({ app: 'Galeón', tipo: 'userscripts', exportado: new Date().toISOString(), scripts: userscripts }, null, 2);
  const dest = uniquePath(app.getPath('downloads'), 'galeon-userscripts.json');
  fs.writeFileSync(dest, data);
  liberarDescarga(dest);
  sendAll('galeon:download', { name: path.basename(dest), path: dest, pct: 100, done: true, ok: true });
  return dest;
});

ipcMain.handle('us:import', (e, texto) => {
  if (!isInternalPage(e) || typeof texto !== 'string') return { ok: false, error: 'entrada inválida' };
  try {
    const data = JSON.parse(texto);
    const llegan = Array.isArray(data) ? data : data.scripts;
    if (!Array.isArray(llegan)) return { ok: false, error: 'no es una exportación de Galeón' };
    let n = 0;
    for (const s of llegan) {
      if (!s || typeof s.code !== 'string') continue;
      const meta = parseUserScript(s.code);
      userscripts.push({
        id: ++usSeq,
        name: s.name || meta.name,
        matches: (Array.isArray(s.matches) && s.matches.length) ? s.matches : meta.matches,
        runAt: s.runAt || meta.runAt,
        code: s.code,
        enabled: s.enabled !== false,
        ts: Date.now()
      });
      n++;
    }
    saveUserscripts();
    return { ok: true, n };
  } catch (err) {
    return { ok: false, error: 'JSON inválido: ' + err.message };
  }
});

ipcMain.handle('us:list', (e) => isInternalPage(e)
  ? userscripts.map(s => ({ id: s.id, name: s.name, matches: s.matches, enabled: s.enabled !== false, ts: s.ts }))
  : []);
ipcMain.handle('us:get', (e, id) => isInternalPage(e) ? userscripts.find(s => s.id === id) || null : null);
ipcMain.handle('us:save', (e, s) => {
  if (!isInternalPage(e) || !s || typeof s.code !== 'string') return false;
  const meta = parseUserScript(s.code);
  const entry = {
    id: s.id || ++usSeq,
    name: s.name || meta.name,
    matches: (Array.isArray(s.matches) && s.matches.length) ? s.matches : meta.matches,
    runAt: meta.runAt,
    code: s.code,
    enabled: s.enabled !== false,
    ts: Date.now()
  };
  const i = userscripts.findIndex(x => x.id === entry.id);
  if (i >= 0) userscripts[i] = entry; else userscripts.push(entry);
  saveUserscripts();
  return entry.id;
});
ipcMain.handle('us:delete', (e, id) => {
  if (!isInternalPage(e)) return false;
  userscripts = userscripts.filter(s => s.id !== id);
  saveUserscripts();
  return true;
});
ipcMain.handle('us:toggle', (e, { id, enabled }) => {
  if (!isInternalPage(e)) return false;
  const s = userscripts.find(x => x.id === id);
  if (s) { s.enabled = !!enabled; saveUserscripts(); }
  return true;
});
// Instalar desde URL (ej. Greasyfork): descarga el main y devuelve metadata
ipcMain.handle('us:installUrl', async (e, url) => {
  if (!isInternalPage(e) || !/^https:\/\/.+\.(user\.)?js(\?|$)/i.test(url || '')) return null;
  const code = await fetchText(url);
  if (!code) return null;
  const meta = parseUserScript(code);
  return { code, name: meta.name, matches: meta.matches, runAt: meta.runAt };
});

function fetchText(url) {
  return new Promise((resolve) => {
    require('https').get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      let n = 0;
      res.on('data', c => { n += c.length; if (n > 1024 * 1024) { res.destroy(); resolve(null); } else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', () => resolve(null));
  });
}

// Al navegar a un .user.js: capturamos el código y ofrecemos instalarlo
function maybeInterceptUserscript(details, callback) {
  if (details.resourceType !== 'mainFrame' || !/\.user\.js(\?|$)/i.test(details.url)) return false;
  fetchText(details.url).then((code) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!code) {
      sendAll('us:ask', { failed: true, url: details.url });
      return;
    }
    const meta = parseUserScript(code);
    usPendingInstall = { code, ...meta };
    sendAll('us:ask', { name: meta.name, matches: meta.matches, url: details.url });
  });
  callback({ cancel: true });
  return true;
}

ipcMain.on('us:answer', (_e, choice) => {
  if (!usPendingInstall) return;
  if (choice === 'install') {
    const s = usPendingInstall;
    userscripts = userscripts.filter(x => x.name !== s.name);
    userscripts.push({ id: ++usSeq, name: s.name, matches: s.matches, runAt: s.runAt, code: s.code, enabled: true, ts: Date.now() });
    saveUserscripts();
  }
  usPendingInstall = null;
});

// Carpeta de descargas personalizada
ipcMain.handle('dlg:downloads', async (e) => {
  if (!isInternalPage(e) && e.sender !== mainWindow?.webContents) return null;
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.downloadsDir = r.filePaths[0];
  saveJson(settingsFile(), settings);
  return settings.downloadsDir;
});
ipcMain.handle('paths:get', () => ({
  webviewPreload: require('url').pathToFileURL(path.join(__dirname, 'webview-preload.js')).href
}));
ipcMain.handle('shell:external', (e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// Auto-actualización: silenciosa y a prueba de fallos.
// Se activa solo en la app instalada y cuando exista canal de publicación
// (al publicar en GitHub Releases, descomentar "publish" en package.json).
function setupAutoUpdate() {
  let autoUpdater = null;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch { return; }
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.logger = console;
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000); // cada 6 horas
}

// Autoprueba: cuenta una búsqueda, verifica el bloqueo, y navega los SITIOS
// GRANDES como canarias — si el escudo volviera a romper internet (bug de la
// blocklist que bloqueó google/youtube/los buscadores), esto grita ANTES de
// que lo descubra un usuario.
async function runSelfTest() {
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:galeon' } });
  try { await win.loadURL('https://html.duckduckgo.com/html/?q=galeon+prueba'); } catch {}
  try { await win.loadURL('https://www.google-analytics.com/analytics.js'); } catch {}

  const CANARIAS = [
    'https://www.google.com/', 'https://www.youtube.com/',
    'https://es.wikipedia.org/', 'https://duckduckgo.com/'
  ];
  let canariasOk = true;
  for (const c of CANARIAS) {
    try {
      await Promise.race([
        win.loadURL(c),
        new Promise((_r, rj) => setTimeout(() => rj(new Error('timeout 20s')), 20000))
      ]);
    } catch (e) {
      canariasOk = false;
      console.log('CANARY FAIL ' + c + ' → ' + e.message);
    }
  }

  setTimeout(() => {
    console.log('SELFTEST ' + JSON.stringify(stats));
    console.log(canariasOk ? 'CANARY OK' : 'CANARY FAIL');
    if (!canariasOk) process.exitCode = 1;
    app.quit();
  }, 4000);
  setTimeout(() => { console.log('SELFTEST timeout'); app.quit(); }, 120000);
}

let mainWindow = null;
const windows = new Set();

// Candado de instancia única (como todos los navegadores): dos Galeones sobre el
// mismo perfil corrompen la caché y rompen cargas con ERR_FAILED.
const tieneCandado = app.requestSingleInstanceLock();
if (!tieneCandado) {
  console.log('Galeón ya está abierto: enfocando la ventana existente.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Alguien abrió Galeón otra vez: mostramos y enfocamos lo que ya existe
    for (const w of windows) {
      if (!w.isDestroyed()) {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
    }
  });
}

app.whenReady().then(() => {
  // UserAgent sin rastro de "Electron": más discreto frente a los sitios
  app.userAgentFallback = app.userAgentFallback.replace(/Electron\/[\d.]+\s/, '');

  stats = loadJson(statsFile(), stats);
  stats.blockedSession = 0; // el escudo de la sesión siempre arranca en cero
  prefs = loadJson(prefsFile(), prefs);
  settings = loadJson(settingsFile(), { ...SETTINGS_DEFAULTS });
  try { bookmarks = JSON.parse(fs.readFileSync(bookmarksFile(), 'utf8')) || []; } catch { bookmarks = [...BOOKMARK_SEEDS]; }
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) bookmarks = [...BOOKMARK_SEEDS];
  try { history = JSON.parse(fs.readFileSync(historyFile(), 'utf8')) || []; } catch { history = []; }

  const sess = session.fromPartition('persist:galeon');
  setupShield(sess);
  setupDownloads(sess);
  // Pestañas privadas: partición SIN persist → todo muere en memoria al cerrar
  const sessPrivada = session.fromPartition('galeon-private');
  setupShield(sessPrivada);
  setupDownloads(sessPrivada);
  sessPrincipal = sess;
  applyAcceptLang();

  if (SELF_TEST) { runSelfTest(); return; }
  setupAutoUpdate();
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });

// "Borrar cookies al salir": se limpia todo dato de sitios en ambas particiones
let limpiandoSalida = false;
app.on('before-quit', (event) => {
  if (limpiandoSalida || !settings.clearCookiesOnExit) return;
  limpiandoSalida = true;
  event.preventDefault();
  const partes = [
    session.fromPartition('persist:galeon'),
    session.fromPartition('galeon-private')
  ];
  Promise.all(partes.map(s => s.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }).catch(() => {})))
    .catch(() => {})
    .finally(() => app.quit());
});
