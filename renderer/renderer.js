// Galeón — lógica de la interfaz: pestañas, barra, escudo, marcadores, descargas, buscar
const HOME_URL = new URL('home.html', location.href).href;
const AJUSTES_URL = new URL('ajustes.html', location.href).href;
const ADMIN_URL = new URL('admin.html', location.href).href;
const PASSWORDS_URL = new URL('contrasenas.html', location.href).href;
const USERSCRIPTS_URL = new URL('userscripts.html', location.href).href;
const DESCARGAS_URL = new URL('descargas.html', location.href).href;
const FAVORITOS_URL = new URL('favoritos.html', location.href).href;
const INTERNAL_PAGES = {
  'galeon://inicio': HOME_URL,
  'galeon://ajustes': AJUSTES_URL,
  'galeon://admin': ADMIN_URL,
  'galeon://contraseñas': PASSWORDS_URL,
  'galeon://passwords': PASSWORDS_URL,
  'galeon://userscripts': USERSCRIPTS_URL,
  'galeon://extensiones': USERSCRIPTS_URL,
  'galeon://descargas': DESCARGAS_URL,
  'galeon://favoritos': FAVORITOS_URL
};

const ENGINES = {
  duckduckgo: 'https://html.duckduckgo.com/html/?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  mojeek: 'https://www.mojeek.com/search?q='
};

const tabbar = document.getElementById('tabbar');
const tabsContent = document.getElementById('tabs-content');
const urlbar = document.getElementById('urlbar');
const httpsChip = document.getElementById('https');
const btnStar = document.getElementById('btn-star');
const shieldCount = document.getElementById('shield-count');
const bottlesCount = document.getElementById('bottles-count');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');
const bookmarksbar = document.getElementById('bookmarksbar');
const findbar = document.getElementById('findbar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const toasts = document.getElementById('toasts');

const tabs = []; // { id, title, url, webview, private, errorUrl }
let activeId = null;
let tabSeq = 0;
let bookmarksCache = [];
let preferredEngine = 'duckduckgo';
let zoomByHost = {};                      // zoom recordado por sitio
const recentlyClosed = [];                // para Ctrl+Shift+T
const faviconCache = new Map();           // host -> file://… (solo primera parte)

const ERROR_URL = new URL('error.html', location.href).href;

/* ---------- Barra de carga: progreso suavizado ---------- */
const loadbar = document.getElementById('loadbar');
const loadbarFill = document.getElementById('loadbar-fill');
let loadTimer = null;
let loadOwnerId = null; // pestaña que "posee" la barra de carga

function loadProgress(loading) {
  if (loading) {
    loadbar.classList.add('act');
    loadbarFill.style.width = '12%';
    clearInterval(loadTimer);
    let pct = 12;
    loadTimer = setInterval(() => {
      pct = Math.min(pct + 7, 78);
      loadbarFill.style.width = pct + '%';
    }, 450);
  } else {
    clearInterval(loadTimer);
    loadbarFill.style.width = '100%';
    setTimeout(() => {
      loadbar.classList.remove('act');
      setTimeout(() => { loadbarFill.style.width = '0%'; }, 250);
    }, 220);
  }
}

/* ---------- Favicons locales ---------- */
function pathToFileUrl(p) {
  return 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

async function tryFavicon(tab) {
  const host = hostOf(tab.url);
  if (!host || faviconCache.has(host)) return;
  try {
    const p = await window.galeon.getFavicon(host);
    if (p) { faviconCache.set(host, pathToFileUrl(p)); renderTabbar(); }
  } catch {}
}

/* ---------- Pestañas ---------- */
function displayUrl(url) {
  if (!url) return '';
  if (url.startsWith('file:')) {
    if (url.includes('home.html')) return 'galeon://inicio';
    if (url.includes('ajustes.html')) return 'galeon://ajustes';
    if (url.includes('admin.html')) return 'galeon://admin';
    if (url.includes('contrasenas.html')) return 'galeon://contraseñas';
    if (url.includes('userscripts.html')) return 'galeon://userscripts';
    if (url.includes('descargas.html')) return 'galeon://descargas';
    if (url.includes('favoritos.html')) return 'galeon://favoritos';
  }
  return url;
}

// Marcador interno para guardar/restaurar sesión
function sessionMarker(url) {
  if (url.startsWith('file:') && url.includes('home.html')) return 'galeon://inicio';
  return url;
}

function realFromMarker(m) {
  return INTERNAL_PAGES[m] || m;
}

// Construye (o reconstruye al despertar) el webview de una pestaña
async function buildWebview(tab, urlDestino) {
  const wv = document.createElement('webview');
  // Privada: partición en memoria (sin persist:) — cookies y datos mueren al cerrar
  wv.setAttribute('partition', tab.private ? 'galeon-private' : 'persist:galeon');
  wv.setAttribute('allowpopups', 'true'); // los enlaces target=_blank se convierten en pestañas
  try {
    const { webviewPreload } = await window.galeon.getPaths();
    wv.setAttribute('preload', webviewPreload);
  } catch (e) { console.error('sin preload', e); }

  tabsContent.appendChild(wv);
  wv.style.display = (tab.id === activeId) ? 'flex' : 'none';
  tab.webview = wv;
  tab.sleeping = false;

  // Enlaces que piden ventana nueva → pestaña nueva de Galeón
  // (en dom-ready el webContents ya existe con seguridad)
  wv.addEventListener('dom-ready', () => {
    if (wv.webContents) {
      wv.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) createTab(url, tab.private); // hereda la privacidad de su pestaña
        return { action: 'deny' };
      });
      // Atajos desde dentro de la página (el foco ya no mata Ctrl+T, Ctrl++, etc.)
      wv.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const ev = { key: input.key, ctrlKey: input.control, metaKey: input.meta, altKey: input.alt, shiftKey: input.shift };
        if (manejarAtajo(ev)) event.preventDefault();
      });
    }
    if (tab.muted) { try { wv.setAudioMuted(true); } catch {} }
  });

  wv.addEventListener('did-navigate', (ev) => {
    tab.url = ev.url;
    tab.errorUrl = null;
    if (tab.id === activeId) syncToolbar(tab);
    if (!tab.private) window.galeon.addHistory({ url: ev.url, title: tab.title, ts: Date.now() });
    // Zoom recordado de este sitio (las páginas internas comparten clave)
    const claveZ = claveZoom(ev.url);
    const z = claveZ ? zoomByHost[claveZ] : null;
    try { wv.setZoomFactor(z && z > 0 ? z : 1); } catch {}
  });
  wv.addEventListener('did-navigate-in-page', (ev) => {
    if (ev.isMainFrame) {
      tab.url = ev.url;
      if (tab.id === activeId) syncToolbar(tab);
    }
  });
  wv.addEventListener('page-title-updated', (ev) => {
    tab.title = ev.title || 'Nueva pestaña';
    renderTabbar();
    if (!tab.private) window.galeon.updateHistoryTitle({ url: tab.url, title: tab.title });
  });
  wv.addEventListener('did-fail-load', (ev) => {
    if (!ev.isMainFrame) return;
    if (ev.errorCode === -3) return; // navegación cancelada: normal
    if ((ev.validatedURL || '').includes('error.html')) return; // ya estamos en la página de error
    tab.errorUrl = ev.validatedURL || tab.url;
    tab.title = 'No se pudo cargar';
    renderTabbar();
    wv.loadURL(ERROR_URL + '?url=' + encodeURIComponent(tab.errorUrl) + '&code=' + ev.errorCode).catch(() => {});
  });

  // Barra de carga: cada pestaña sabe si carga; la barra muestra la activa
  wv.addEventListener('did-start-loading', () => {
    tab.loading = true;
    if (tab.id === activeId) { loadOwnerId = tab.id; loadProgress(true); }
  });
  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    if (loadOwnerId === tab.id) { loadOwnerId = null; loadProgress(false); }
    // el favicon puede haber llegado con la página: comprobamos un poco después
    setTimeout(() => tryFavicon(tab), 900);
  });

  // Audio por pestaña: indicador y silencio
  wv.addEventListener('media-started-playing', () => { tab.audible = true; renderTabbar(); });
  wv.addEventListener('media-paused', () => { tab.audible = false; renderTabbar(); });

  // Favicon de primera parte: el del propio sitio, nunca servicios externos
  wv.addEventListener('page-favicon-updated', (ev) => {
    const f = (ev.favicons || []).find(u => /^https?:\/\//.test(u));
    if (!f) return;
    try { window.galeon.reportFavicon({ host: new URL(tab.url || f).hostname, url: f }); } catch {}
    tryFavicon(tab);
  });

  // Menú contextual: lo construye el proceso principal con estos datos
  wv.addEventListener('context-menu', (ev) => {
    ev.preventDefault();
    window.galeon.showContextMenu({
      x: ev.params.x, y: ev.params.y,
      linkURL: ev.params.linkURL || '',
      selectionText: ev.params.selectionText || '',
      canGoBack: wv.canGoBack(),
      canGoForward: wv.canGoForward()
    });
  });

  // Contador de coincidencias de Ctrl+F
  wv.addEventListener('found-in-page', (ev) => {
    if (tab.id === activeId && !findbar.hidden && ev.result) {
      findCount.textContent = ev.result.matches ? `${ev.result.activeMatchOrdinal}/${ev.result.matches}` : '0';
    }
  });

  wv.src = urlDestino;
  return wv;
}

async function createTab(urlInicial, esPrivada = false) {
  const id = ++tabSeq;
  const tab = {
    id, private: esPrivada,
    title: urlInicial ? 'Cargando…' : (esPrivada ? 'Privada' : 'Nueva pestaña'),
    url: '', webview: null,
    lastActive: Date.now()
  };
  tabs.push(tab);
  await buildWebview(tab, urlInicial || HOME_URL);
  activateTab(id);
  renderTabbar();
  return tab;
}

// Dormir pestañas inactivas: se suelta el webview y se recarga al volver
function dormirTab(tab) {
  if (tab.sleeping || tab.id === activeId) return;
  if (!/^https?:/.test(tab.url || '')) return; // páginas internas pesan nada
  if (loadOwnerId === tab.id) { loadOwnerId = null; loadProgress(false); }
  try { tab.webview.remove(); tab.webview.destroy(); } catch {}
  tab.webview = null;
  tab.sleeping = true;
  tab.loading = false;
  tab.audible = false;
  renderTabbar();
}

async function despertarTab(tab) {
  if (!tab.sleeping) return;
  const destino = (tab.url && tab.url.startsWith('file:'))
    ? tab.url
    : tab.url || HOME_URL;
  await buildWebview(tab, destino);
  renderTabbar();
}

setInterval(() => {
  window.galeon.settingsGet().then(({ settings }) => {
    if (!settings.sleepTabs) return;
    const limite = Date.now() - 15 * 60 * 1000; // 15 minutos sin uso
    for (const t of tabs) {
      if (!t.sleeping && t.lastActive < limite) dormirTab(t);
    }
  }).catch(() => {});
}, 60 * 1000);

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i === -1) return;
  const tab = tabs[i];
  if (loadOwnerId === id) { loadOwnerId = null; loadProgress(false); } // no dejar la barra clavada
  if (tab.url && /^https?:|^file:/.test(tab.url)) {
    recentlyClosed.push({ m: sessionMarker(tab.url), p: !!tab.private });
    if (recentlyClosed.length > 12) recentlyClosed.shift();
  }
  tabs.splice(i, 1);
  if (tab.webview) { tab.webview.remove(); tab.webview.destroy?.(); }
  if (tabs.length === 0) { createTab(); return; }
  if (activeId === id) activateTab(tabs[Math.max(0, i - 1)].id);
  renderTabbar();
}

function activateTab(id) {
  activeId = id;
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    tab.lastActive = Date.now();
    for (const t of tabs) if (t.webview) t.webview.style.display = (t.id === id) ? 'flex' : 'none';
    if (tab.sleeping) despertarTab(tab); // async: el resto de la UI ya está lista
  }
  // La barra de carga refleja a la pestaña que ahora es activa
  const activa = tabs.find(t => t.id === id);
  if (activa && activa.loading) { loadOwnerId = id; loadProgress(true); }
  else if (loadOwnerId !== null && loadOwnerId !== id) { loadOwnerId = null; loadProgress(false); }
  syncToolbar(tab);
  renderTabbar();
}

// Barra, candado y estrella según la pestaña activa
function syncToolbar(tab) {
  let url = tab ? tab.url : '';
  // Si estamos en la página de error, muestra la URL que falló
  if (tab && tab.errorUrl && url.includes('error.html')) url = tab.errorUrl;
  else url = displayUrl(url);
  urlbar.value = url;
  const u = tab ? tab.url : '';
  if (u.startsWith('https://')) httpsChip.textContent = '🔒';
  else if (u.startsWith('http://')) httpsChip.textContent = '⚠';
  else httpsChip.textContent = '⚓';
  updateStar(tab);
}

async function updateStar(tab) {
  const url = tab ? tab.url : '';
  const starred = /^https?:\/\//.test(url) && bookmarksCache.some(b => b.url === url);
  btnStar.classList.toggle('starred', starred);
}

function renderTabbar() {
  tabbar.textContent = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeId ? ' active' : '') + (t.private ? ' private' : '');
    // Audio: indicador clicable para silenciar esta pestaña
    if (t.audible || t.muted) {
      const au = document.createElement('span');
      au.className = 'tabaudio';
      au.textContent = t.muted ? '🔇' : '🔊';
      au.title = t.muted ? 'Reactivar sonido' : 'Silenciar esta pestaña';
      au.addEventListener('click', (e) => {
        e.stopPropagation();
        t.muted = !t.muted;
        try { t.webview?.setAudioMuted(t.muted); } catch {}
        renderTabbar();
      });
      el.appendChild(au);
    }
    const host = hostOf(t.url);
    const fav = faviconCache.get(host);
    if (fav && !t.sleeping) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = fav;
      el.appendChild(img);
    }
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = (t.private ? '🎭 ' : '') + (t.sleeping ? '💤 ' : '') + t.title;
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.title = 'Cerrar pestaña (Ctrl+W)';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });
    el.append(title, close);
    el.addEventListener('click', () => activateTab(t.id));
    tabbar.appendChild(el);
  }
}

/* ---------- Navegación ---------- */
function looksLikeUrl(text) {
  // "3.14" o "1.5" es una búsqueda, no un dominio; una IP completa (192.168.1.1) sí navega
  if (/^\d+\.\d+$/.test(text)) return false;
  return /^https?:\/\//i.test(text) || (/^[^\s]+\.[^\s]{2,}$/.test(text) && !text.includes(' '));
}

function searchUrl(text, engine) {
  return (ENGINES[engine] || ENGINES.duckduckgo) + encodeURIComponent(text);
}

function navigate(tab, input) {
  const text = input.trim();
  if (!text) return;
  if (INTERNAL_PAGES[text]) { tab.webview.loadURL(INTERNAL_PAGES[text]).catch(() => {}); return; }
  const url = looksLikeUrl(text) ? (/^https?:\/\//i.test(text) ? text : 'https://' + text) : searchUrl(text, preferredEngine);
  tab.webview.loadURL(url).catch(() => {});
}

/* ---------- Barra de herramientas ---------- */
const activeTab = () => tabs.find(t => t.id === activeId);

document.getElementById('btn-back').addEventListener('click', () => activeTab()?.webview?.goBack());
document.getElementById('btn-fwd').addEventListener('click', () => activeTab()?.webview?.goForward());
document.getElementById('btn-reload').addEventListener('click', () => activeTab()?.webview?.reload());
document.getElementById('btn-home').addEventListener('click', () => {
  const tab = activeTab();
  if (tab) { tab.url = ''; tab.webview.loadURL(HOME_URL).catch(() => {}); }
});
document.getElementById('newtab').addEventListener('click', () => createTab());
document.getElementById('newtab-private').addEventListener('click', () => createTab(null, true));

urlbar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const tab = activeTab();
    if (tab) { navigate(tab, urlbar.value); urlbar.blur(); }
  }
});

/* ---------- Marcadores ---------- */
const AVATAR_COLORS = ['#E8B84B', '#2EC4B6', '#7FB069', '#C89EC4', '#E08E45', '#6CA6E0'];

function avatarFor(url) {
  let host = url;
  try { host = new URL(url).hostname; } catch {}
  const letter = (host.replace(/^www\./, '')[0] || '?').toUpperCase();
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { letter, color: AVATAR_COLORS[h % AVATAR_COLORS.length] };
}

async function refreshBookmarks() {
  bookmarksCache = await window.galeon.listBookmarks();
  bookmarksbar.textContent = '';
  bookmarksbar.hidden = bookmarksCache.length === 0;
  for (const b of bookmarksCache) {
    const el = document.createElement('div');
    el.className = 'bmark';
    const host = hostOf(b.url);
    const fav = faviconCache.get(host);
    const lead = document.createElement('span');
    if (fav) {
      const img = document.createElement('img');
      img.src = fav;
      img.style.width = img.style.height = '16px';
      img.style.objectFit = 'contain';
      lead.appendChild(img);
      // favicon pendiente de descargar: lo pedimos y re-renderizamos
      window.galeon.getFavicon(host).then((p) => {
        if (p && !faviconCache.has(host)) { faviconCache.set(host, pathToFileUrl(p)); refreshBookmarks(); }
      }).catch(() => {});
    } else {
      const av = avatarFor(b.url);
      lead.className = 'bm-avatar';
      lead.textContent = av.letter;
      lead.style.background = av.color;
      window.galeon.getFavicon(host).then((p) => {
        if (p) { faviconCache.set(host, pathToFileUrl(p)); refreshBookmarks(); }
      }).catch(() => {});
    }
    const label = document.createElement('span');
    label.textContent = b.title || b.url;
    const close = document.createElement('button');
    close.className = 'bm-close';
    close.textContent = '✕';
    close.title = 'Quitar de marcadores';
    close.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.galeon.toggleBookmark({ url: b.url, title: b.title });
      refreshBookmarks();
    });
    el.append(lead, label, close);
    el.addEventListener('click', () => {
      const tab = activeTab();
      if (tab && /^https?:/.test(b.url)) tab.webview.loadURL(b.url).catch(() => {});
    });
    bookmarksbar.appendChild(el);
  }
  updateStar(activeTab());
}

btnStar.addEventListener('click', async () => {
  const tab = activeTab();
  if (!tab || !/^https?:\/\//.test(tab.url)) return;
  await window.galeon.toggleBookmark({ url: tab.url, title: tab.title });
  refreshBookmarks();
});

/* ---------- Buscar en la página (Ctrl+F) ---------- */
function openFindbar() {
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
}

function closeFindbar() {
  findbar.hidden = true;
  findCount.textContent = '';
  activeTab()?.webview?.stopFindInPage('clearSelection');
}

function doFind(backwards) {
  const tab = activeTab();
  if (!tab || !findInput.value) return;
  if (!tab.webview.webContents) return;
  tab.webview.webContents.findInPage(findInput.value, { forward: !backwards, findNext: !!findCount.textContent });
}

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { doFind(e.shiftKey); e.preventDefault(); }
  else if (e.key === 'Escape') { closeFindbar(); }
});
findInput.addEventListener('input', () => { findCount.textContent = ''; doFind(false); });
document.getElementById('find-next').addEventListener('click', () => doFind(false));
document.getElementById('find-prev').addEventListener('click', () => doFind(true));
document.getElementById('find-close').addEventListener('click', closeFindbar);

/* ---------- Acciones del menú contextual ---------- */
window.galeon.onContextMenuAction((action) => {
  const tab = activeTab();
  if (!tab) return;
  switch (action.type) {
    case 'back': tab.webview.goBack(); break;
    case 'fwd': tab.webview.goForward(); break;
    case 'reload': tab.webview.reload(); break;
    case 'openlink': if (/^https?:\/\//.test(action.url)) createTab(action.url); break;
    case 'selectall': tab.webview.webContents?.selectAll(); break;
    case 'find': openFindbar(); break;
    case 'newprivate': createTab(null, true); break;
  }
});

/* ---------- Descargas ---------- */
const activeToasts = new Map(); // name -> elemento

window.galeon.onDownload((d) => {
  const key = d.path || d.name; // por ruta: dos archivos con el mismo nombre no pisan su aviso
  let el = activeToasts.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<div class="t-name"></div><div class="t-status"></div><div class="t-bar"><div></div></div>';
    el.querySelector('.t-name').textContent = d.name;
    toasts.appendChild(el);
    activeToasts.set(key, el);
  }
  const status = el.querySelector('.t-status');
  const bar = el.querySelector('.t-bar > div');
  if (d.done) {
    el.classList.add(d.ok ? 'done-ok' : 'done-fail');
    status.textContent = d.ok ? '✓ Descargado en tu carpeta Descargas' : '✕ La descarga falló o se canceló';
    if (d.ok) bar.style.width = '100%';
    activeToasts.delete(key);
    setTimeout(() => el.remove(), 6000);
  } else {
    if (d.pct == null) { status.textContent = 'Descargando…'; bar.style.width = '0%'; }
    else { status.textContent = `Descargando… ${d.pct}%`; bar.style.width = d.pct + '%'; }
  }
});

/* ---------- Avisos de guardar contraseña / instalar userscript ---------- */
function askToast(html, botones, ttl) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  const fila = document.createElement('div');
  fila.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap';
  for (const [texto, accion, primario] of botones) {
    const b = document.createElement('button');
    b.textContent = texto;
    b.style.cssText = `border:1px solid ${primario ? '#E8B84B' : 'rgba(255,255,255,.2)'};` +
      `background:${primario ? 'rgba(232,184,75,.15)' : 'transparent'};` +
      `color:${primario ? '#E8B84B' : '#F2E9D8'};border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer`;
    b.addEventListener('click', () => { accion(); el.remove(); });
    fila.appendChild(b);
  }
  el.appendChild(fila);
  toasts.appendChild(el);
  if (ttl) setTimeout(() => el.remove(), ttl);
  return el;
}

window.galeon.onPwdAsk(({ origin, username }) => {
  askToast(
    `<div class="t-name">🔑 ¿Guardar la clave de <strong>${username}</strong> en ${origin}?</div>
     <div class="t-status">Cifrada con tu cuenta de Windows. Solo en este equipo.</div>`,
    [
      ['Guardar', () => window.galeon.pwdAnswer('save'), true],
      ['Nunca aquí', () => window.galeon.pwdAnswer('never')],
      ['Ahora no', () => window.galeon.pwdAnswer('no')]
    ],
    30000
  );
});

window.galeon.onUsAsk((info) => {
  if (info.failed) {
    askToast(
      `<div class="t-name">⚙️ No se pudo descargar el userscript</div>
       <div class="t-status">${info.url}</div>`,
      [['Entendido', () => window.galeon.usAnswer('no')]],
      12000
    );
    return;
  }
  askToast(
    `<div class="t-name">⚙️ Instalar el userscript <strong>${info.name}</strong>?</div>
     <div class="t-status">Revísalo después en galeon://userscripts · ${info.url}</div>`,
    [
      ['Instalar', () => window.galeon.usAnswer('install'), true],
      ['Cancelar', () => window.galeon.usAnswer('no')]
    ],
    30000
  );
});

/* ---------- Menú de aplicación ☰ ---------- */
const appmenu = document.getElementById('appmenu');
document.getElementById('btn-menu').addEventListener('click', () => {
  appmenu.hidden = !appmenu.hidden;
});
document.getElementById('mz-in').addEventListener('click', () => changeZoom(0.1));
document.getElementById('mz-out').addEventListener('click', () => changeZoom(-0.1));
document.getElementById('mz-reset').addEventListener('click', () => changeZoom(0));

async function capturarPagina() {
  const tab = activeTab();
  if (!tab || !/^https?:|^file:/.test(tab.url)) return;
  try {
    const img = await tab.webview.capturePage();
    const data = img.toDataURL();
    if (data.length < 100) return;
    const host = hostOf(tab.url) || 'pagina';
    await window.galeon.saveScreenshot({ data, name: 'galeon-' + host.replace(/[^a-z0-9.-]/gi, '_') });
  } catch (e) { /* captura no disponible en este entorno */ }
}

appmenu.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.mi');
  if (!btn) return;
  appmenu.hidden = true;
  switch (btn.dataset.ma) {
    case 'newwin': window.galeon.newWindow(false); break;
    case 'newwinpriv': window.galeon.newWindow(true); break;
    case 'tabsearch': abrirBuscadorPestanas(); break;
    case 'favoritos': createTab(FAVORITOS_URL); break;
    case 'historial': document.getElementById('btn-history').click(); break;
    case 'descargas': createTab(DESCARGAS_URL); break;
    case 'userscripts': createTab(USERSCRIPTS_URL); break;
    case 'passwords': createTab(PASSWORDS_URL); break;
    case 'datos': createTab(AJUSTES_URL); break;
    case 'print': try { activeTab()?.webview?.print(); } catch {} break;
    case 'translate': {
      const t = activeTab();
      if (t && /^https?:\/\//.test(t.url)) {
        createTab('https://translate.google.com/translate?sl=auto&tl=es&u=' + encodeURIComponent(t.url));
      }
      break;
    }
    case 'shot': capturarPagina(); break;
    case 'find': openFindbar(); break;
    case 'ajustes': createTab(AJUSTES_URL); break;
    case 'admin': createTab(ADMIN_URL); break;
  }
});

/* ---------- Buscador de pestañas (Ctrl+Mayús+A) ---------- */
const tabsearch = document.getElementById('tabsearch');
const tsInput = document.getElementById('ts-input');
const tsList = document.getElementById('ts-list');

function abrirBuscadorPestanas() {
  tabsearch.hidden = false;
  appmenu.hidden = true;
  shieldPop.hidden = true;
  tsInput.value = '';
  renderTsList('');
  tsInput.focus();
}

function cerrarBuscadorPestanas() {
  tabsearch.hidden = true;
}

function renderTsList(filtro) {
  tsList.textContent = '';
  const q = filtro.trim().toLowerCase();
  const visibles = tabs.filter(t =>
    !q || (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q)
  );
  if (visibles.length === 0) {
    tsList.innerHTML = '<div class="ts-vacio">Ninguna pestaña coincide.</div>';
    return;
  }
  for (const t of visibles) {
    const el = document.createElement('div');
    el.className = 'ts-item';
    const fav = faviconCache.get(hostOf(t.url));
    if (fav) {
      const img = document.createElement('img');
      img.className = 'ts-fav';
      img.src = fav;
      el.appendChild(img);
    }
    const title = document.createElement('span');
    title.className = 'ts-title';
    title.textContent = (t.private ? '🎭 ' : '') + (t.sleeping ? '💤 ' : '') + (t.title || t.url);
    const host = document.createElement('span');
    host.className = 'ts-host';
    host.textContent = hostOf(t.url) || 'interna';
    el.append(title, host);
    el.addEventListener('click', () => { cerrarBuscadorPestanas(); activateTab(t.id); });
    tsList.appendChild(el);
  }
}

tsInput.addEventListener('input', () => renderTsList(tsInput.value));
tsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarBuscadorPestanas();
  else if (e.key === 'Enter') {
    const first = tsList.querySelector('.ts-item');
    if (first) first.click();
  }
});

/* ---------- Modo desarrollador: probar userscripts en la pestaña activa ---------- */
window.galeon.onUsTestRun(({ code, nombre }) => {
  const tab = activeTab();
  if (!tab || !tab.webview || !/^https?:/.test(tab.url)) return;
  try {
    tab.webview.webContents.executeJavaScript(
      `(function(){ try {\n${code}\n} catch (e) { console.error('prueba: ' + (e && e.message)); } })();`,
      false
    ).catch(() => {});
    askToast(
      `<div class="t-name">▶ "${nombre}" ejecutado en ${hostOf(tab.url)}</div>
       <div class="t-status">Sus console.log y errores están en galeon://userscripts → Consola</div>`,
      [['Entendido', () => {}]],
      8000
    );
  } catch (e) { /* pestaña no lista */ }
});

/* ---------- Escudo y botellas ---------- */
const shieldEl = document.getElementById('shield');
const shieldPop = document.getElementById('shield-pop');
let lastSiteCounts = {};

async function refreshStats() {
  try {
    const s = await window.galeon.getStats();
    shieldCount.textContent = s.blockedSession;
    bottlesCount.textContent = s.bottles;
    lastSiteCounts = s.siteCounts || {};
    document.getElementById('sp-clean-count').textContent = (s.paramsCleaned || 0).toLocaleString('es');
    if (!shieldPop.hidden) renderShieldPop();
  } catch (e) { /* silencio: la interfaz no debe gritar */ }
}
setInterval(refreshStats, 1500);
refreshStats();

function activeHost() {
  const t = activeTab();
  if (!t || !/^https?:\/\//.test(t.url)) return '';
  try { return new URL(t.url).hostname; } catch { return ''; }
}

async function renderShieldPop() {
  const host = activeHost();
  document.getElementById('sp-site').textContent = host || 'esta página';
  const n = host ? (lastSiteCounts[host] || 0) : 0;
  document.getElementById('sp-count').textContent = n;
  const { settings } = await window.galeon.settingsGet();
  const off = !settings.shieldEnabled || settings.shieldOff.includes(host);
  const btn = document.getElementById('sp-toggle');
  btn.textContent = off ? 'Reactivar escudo aquí' : 'Desactivar escudo en este sitio';
  btn.disabled = !host;
}

shieldEl.addEventListener('click', () => {
  shieldPop.hidden = !shieldPop.hidden;
  if (!shieldPop.hidden) renderShieldPop();
});
document.getElementById('sp-close').addEventListener('click', () => { shieldPop.hidden = true; });
document.getElementById('sp-toggle').addEventListener('click', async () => {
  const host = activeHost();
  if (!host) return;
  const { settings } = await window.galeon.settingsGet();
  let list = settings.shieldOff.filter(h => h !== host);
  if (list.length === settings.shieldOff.length) list = [...list, host]; // estaba activo → apagar
  await window.galeon.settingsSet({ shieldOff: list });
  shieldPop.hidden = true;
  activeTab()?.webview?.reload(); // aplicar el cambio
});
document.getElementById('sp-ajustes').addEventListener('click', () => {
  shieldPop.hidden = true;
  createTab(AJUSTES_URL);
});
document.getElementById('sp-admin').addEventListener('click', () => {
  shieldPop.hidden = true;
  createTab(ADMIN_URL);
});

/* ---------- Historial local ---------- */
document.getElementById('btn-history').addEventListener('click', async () => {
  historyPanel.hidden = !historyPanel.hidden;
  if (!historyPanel.hidden) await renderHistory();
});
document.getElementById('btn-close-history').addEventListener('click', () => { historyPanel.hidden = true; });
document.getElementById('btn-clear-history').addEventListener('click', async () => {
  await window.galeon.clearHistory();
  await renderHistory();
});

async function renderHistory() {
  const items = await window.galeon.listHistory();
  historyList.textContent = '';
  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Aún no hay nada aquí. Bien: tu historial solo existe en tu equipo.';
    li.style.cursor = 'default';
    historyList.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'h-title';
    title.textContent = it.title || it.url;
    const meta = document.createElement('span');
    meta.className = 'h-meta';
    let host = it.url;
    try { host = new URL(it.url).hostname; } catch {}
    const time = new Date(it.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    meta.textContent = `${host} · ${time}`;
    li.append(title, meta);
    li.addEventListener('click', () => {
      const tab = activeTab();
      if (tab && /^https?:/.test(it.url)) { tab.webview.loadURL(it.url).catch(() => {}); historyPanel.hidden = true; }
    });
    historyList.appendChild(li);
  }
}

/* ---------- Zoom (Ctrl+±/0, recordado por sitio) ---------- */
function claveZoom(url) {
  const h = hostOf(url);
  return h || (url && url.startsWith('file:') ? 'galeon-interno' : ''); // páginas internas comparten clave
}
async function changeZoom(delta) {
  const tab = activeTab();
  if (!tab) return;
  let next = 1;
  try {
    next = delta === 0 ? 1 : Math.min(2, Math.max(0.5, (tab.webview.getZoomFactor() || 1) + delta));
  } catch {}
  try { tab.webview.setZoomFactor(next); } catch {}
  const clave = claveZoom(tab.url);
  if (clave) {
    zoomByHost[clave] = next;
    window.galeon.settingsSet({ zoomByHost }).catch(() => {});
  }
}

/* ---------- Atajos de teclado ----------
   Un solo manejador para dos fuentes: la ventana del navegador Y el teclado
   que llega a las páginas (before-input-event de cada webview). Sin esto,
   los atajos morían en cuanto el clic entraba en una página. */
function manejarAtajo(ev) {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const k = (ev.key || '').toLowerCase();
  if (ev.altKey && ev.key === 'ArrowLeft') { activeTab()?.webview?.goBack(); return true; }
  if (ev.altKey && ev.key === 'ArrowRight') { activeTab()?.webview?.goForward(); return true; }
  if (!ctrl) {
    if (ev.key === 'F5') { activeTab()?.webview?.reload(); return true; }
    if (ev.key === 'F11') { window.galeon.toggleFullscreen(); return true; }
    if (ev.key === 'Escape' && !findbar.hidden) { closeFindbar(); return true; }
    return false;
  }
  const mapa = () => ({
    [ctrl && ev.shiftKey && k === 't']: () => { const rc = recentlyClosed.pop(); if (rc) createTab(realFromMarker(rc.m), rc.p); },
    [ctrl && ev.shiftKey && k === 'n']: () => window.galeon.newWindow(true),
    [ctrl && ev.shiftKey && k === 'o']: () => createTab(FAVORITOS_URL),
    [ctrl && ev.shiftKey && k === 'a']: () => (tabsearch.hidden ? abrirBuscadorPestanas() : cerrarBuscadorPestanas()),
    [ctrl && ev.shiftKey && (ev.key === 'Delete' || ev.key === 'Backspace')]: () => createTab(AJUSTES_URL),
    [ctrl && ev.shiftKey && k === 's']: () => capturarPagina(),
    [ctrl && k === 'n']: () => window.galeon.newWindow(false),
    [ctrl && k === 'h']: () => document.getElementById('btn-history').click(),
    [ctrl && k === 'j']: () => createTab(DESCARGAS_URL),
    [ctrl && k === 't']: () => createTab(),
    [ctrl && k === 'w']: () => { if (activeId) closeTab(activeId); },
    [ctrl && k === 'l']: () => { urlbar.focus(); urlbar.select(); },
    [ctrl && k === 'r']: () => activeTab()?.webview?.reload(),
    [ctrl && k === 'd']: () => btnStar.click(),
    [ctrl && k === 'f']: () => openFindbar(),
    [ctrl && (ev.key === '+' || ev.key === '=')]: () => changeZoom(0.1),
    [ctrl && ev.key === '-']: () => changeZoom(-0.1),
    [ctrl && ev.key === '0']: () => changeZoom(0),
    [ctrl && k === 'p']: () => { try { activeTab()?.webview?.print(); } catch {} }
  });
  const acciones = mapa();
  for (const [cond, accion] of Object.entries(acciones)) {
    if (cond === 'true') { accion(); return true; }
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (manejarAtajo(e)) e.preventDefault();
});

/* ---------- Tema (presets + colores personalizados, en vivo) ---------- */
function aplicarTema(s) {
  if (!s) return;
  document.body.classList.toggle('tema-claro', s.theme === 'claro');
  const c = s.themeCustom || {};
  const vars = { '--navy': c.fondo, '--navy-2': c.superficie, '--navy-3': c.superficie2,
                 '--ink': c.texto, '--ink-dim': c.texto2, '--gold': c.acento, '--teal': c.acento2 };
  for (const [k, v] of Object.entries(vars)) {
    if (v) document.body.style.setProperty(k, v); else document.body.style.removeProperty(k);
  }
}
window.galeon.onSettingsChanged(aplicarTema);

/* ---------- Arranque: sesión restaurable + primera pestaña ---------- */
function saveCurrentSession() {
  const urls = tabs.filter(t => !t.private).map(t => sessionMarker(t.url)).filter(u => u && u !== '');
  window.galeon.saveSession(urls).catch(() => {});
}

(async () => {
  try {
    const prefs = await window.galeon.getPrefs();
    if (prefs.engine && ENGINES[prefs.engine]) preferredEngine = prefs.engine;
    window.galeon.setPrefs({ engine: preferredEngine }); // mantiene sincronizada la home
  } catch {}
  try {
    const { settings } = await window.galeon.settingsGet();
    if (settings.zoomByHost && typeof settings.zoomByHost === 'object') zoomByHost = settings.zoomByHost;
    aplicarTema(settings);
  } catch {}
  // La home cambia el motor → actualizamos nuestra copia al volver
  setInterval(async () => {
    try {
      const prefs = await window.galeon.getPrefs();
      if (prefs.engine && ENGINES[prefs.engine]) preferredEngine = prefs.engine;
    } catch {}
  }, 3000);
  await refreshBookmarks();

  // Restaurar la sesión anterior si el usuario lo quiere.
  // Solo la ventana principal restaura y guarda; las nuevas/privadas no interfieren.
  const q = new URLSearchParams(location.search);
  const esVentanaPrincipal = q.get('privada') !== '1' && q.get('fresh') !== '1';
  let restored = 0;
  try {
    const { settings } = await window.galeon.settingsGet();
    if (settings.restoreSession && esVentanaPrincipal) {
      const ses = await window.galeon.getSession();
      const urls = (ses.urls || []).filter(u => /^https?:|^galeon:/.test(u)).slice(0, 10);
      for (const u of urls) { await createTab(realFromMarker(u)); restored++; }
    }
  } catch {}
  if (restored === 0) createTab(null, q.get('privada') === '1');
  setInterval(() => { if (esVentanaPrincipal) saveCurrentSession(); }, 8000);
  if (esVentanaPrincipal) saveCurrentSession();

  // Modo demo (capturas de verificación): muestra páginas internas y una pestaña privada
  if (location.search.includes('demo=1')) {
    await new Promise(r => setTimeout(r, 400));
    createTab(USERSCRIPTS_URL);
    await new Promise(r => setTimeout(r, 300));
    createTab(null, true);
    await new Promise(r => setTimeout(r, 300));
    createTab('https://este-sitio-no-existe.galeon.test/'); // demuestra la página de error
  }
  // Modo verificación del menú: lo deja abierto para capturas
  if (location.search.includes('menu=1')) {
    setTimeout(() => { appmenu.hidden = false; }, 1200);
  }
})();
