// Galeón — página de ajustes (se ejecuta dentro de una pestaña)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);

let state = null;

async function load() {
  if (!g.settingsGet) return;
  const { settings, version } = await g.settingsGet();
  state = settings;
  $('version').textContent = version;
  $('refererTrim').checked = settings.refererTrim;
  $('httpsOnly').checked = settings.httpsOnly;
  $('sendDntGpc').checked = settings.sendDntGpc;
  $('acceptLang').checked = settings.acceptLang !== 'neutro';
  $('shieldEnabled').checked = settings.shieldEnabled;
  $('restoreSession').checked = settings.restoreSession;
  $('sleepTabs').checked = settings.sleepTabs !== false;
  $('clearCookiesOnExit').checked = !!settings.clearCookiesOnExit;
  $('pwdAsk').checked = settings.pwdAsk !== false;
  $('dl-current').textContent = settings.downloadsDir || 'Descargas del sistema';
  marcarPresetActivo(settings);
  pintarSelectores(settings.themeCustom || {});
  renderExempt();
  renderStats();
}

async function set(patch) {
  Object.assign(state, patch);
  await g.settingsSet(state);
  renderExempt();
}

$('refererTrim').addEventListener('change', (e) => set({ refererTrim: e.target.checked }));
$('httpsOnly').addEventListener('change', (e) => set({ httpsOnly: e.target.checked }));
$('sendDntGpc').addEventListener('change', (e) => set({ sendDntGpc: e.target.checked }));
$('acceptLang').addEventListener('change', (e) => set({ acceptLang: e.target.checked ? 'es' : 'neutro' }));
$('shieldEnabled').addEventListener('change', (e) => set({ shieldEnabled: e.target.checked }));
$('restoreSession').addEventListener('change', (e) => set({ restoreSession: e.target.checked }));
$('sleepTabs').addEventListener('change', (e) => set({ sleepTabs: e.target.checked }));
$('clearCookiesOnExit').addEventListener('change', (e) => set({ clearCookiesOnExit: e.target.checked }));
$('pwdAsk').addEventListener('change', (e) => set({ pwdAsk: e.target.checked }));

$('btn-dl-folder').addEventListener('click', async () => {
  const dir = await g.chooseDownloadsDir();
  if (dir) $('dl-current').textContent = dir;
});

function renderExempt() {
  const row = $('exempt-row');
  const list = $('exempt-list');
  list.textContent = '';
  const off = state.shieldOff || [];
  row.hidden = off.length === 0;
  for (const host of off) {
    const b = document.createElement('button');
    b.textContent = `${host} ✕`;
    b.title = 'Reactivar el escudo en este sitio';
    b.addEventListener('click', () => set({ shieldOff: state.shieldOff.filter(h => h !== host) }));
    list.appendChild(b);
  }
}

$('btn-clear-history').addEventListener('click', async () => {
  await g.clearHistory();
  $('btn-clear-history').textContent = '✓ Historial borrado';
  setTimeout(() => { $('btn-clear-history').textContent = 'Borrar historial'; }, 2500);
});
$('btn-clear-cookies').addEventListener('click', async () => {
  await g.dataClear({ cookies: true, cache: false });
  $('btn-clear-cookies').textContent = '✓ Cookies borradas';
  setTimeout(() => { $('btn-clear-cookies').textContent = 'Borrar cookies y datos de sitios'; }, 2500);
});
$('btn-clear-cache').addEventListener('click', async () => {
  await g.dataClear({ cookies: false, cache: true });
  $('btn-clear-cache').textContent = '✓ Caché borrada';
  setTimeout(() => { $('btn-clear-cache').textContent = 'Borrar caché'; }, 2500);
});

async function renderStats() {
  try {
    const s = await g.getStats();
    const g2 = s.grams >= 1000 ? (s.grams / 1000).toFixed(2) + ' kg' : s.grams + ' g';
    $('stats-line').textContent =
      `${s.searches} búsquedas · ${s.bottles} botellas (${g2}) · ${s.blockedTotal} rastreadores bloqueados`;
  } catch { /* silencio */ }
}

load();
setInterval(renderStats, 4000);

/* ---------- Temas: presets y colores personalizados ---------- */
const PALETA = [
  ['fondo', 'Fondo'], ['superficie', 'Superficie'], ['superficie2', 'Superficie 2'],
  ['texto', 'Texto'], ['texto2', 'Texto secundario'], ['acento', 'Acento (oro)'], ['acento2', 'Acento 2 (turquesa)']
];
const PRESETS = {
  azul:   { theme: 'oscuro', themeCustom: {} },
  papel:  { theme: 'claro', themeCustom: {} },
  oceano: { theme: 'oscuro', themeCustom: { fondo: '#06282E', superficie: '#0B3B42', superficie2: '#11505A', texto: '#EAF6F2', texto2: '#8FB8B2', acento: '#E8B84B', acento2: '#35D0C0' } },
  bosque: { theme: 'oscuro', themeCustom: { fondo: '#0D2214', superficie: '#143020', superficie2: '#1D4430', texto: '#EAF2E4', texto2: '#93B09A', acento: '#D9B65C', acento2: '#6CC24A' } }
};

function clavePreset(settings) {
  const t = JSON.stringify(settings.themeCustom || {});
  for (const [k, p] of Object.entries(PRESETS)) {
    if (p.theme === settings.theme && JSON.stringify(p.themeCustom) === t) return k;
  }
  return '';
}

function marcarPresetActivo(settings) {
  const activa = clavePreset(settings);
  document.querySelectorAll('#tema-presets button').forEach(b => {
    b.classList.toggle('on', b.dataset.preset === activa);
  });
}

function aplicarVarsLocales(custom, theme) {
  const vars = { '--navy': custom.fondo, '--navy-2': custom.superficie, '--navy-3': custom.superficie2,
                 '--ink': custom.texto, '--ink-dim': custom.texto2, '--gold': custom.acento, '--teal': custom.acento2 };
  for (const [k, v] of Object.entries(vars)) {
    if (v) document.documentElement.style.setProperty(k, v); else document.documentElement.style.removeProperty(k);
  }
  document.body.classList.toggle('tema-claro', theme === 'claro');
}

function pintarSelectores(custom) {
  const caja = $('tema-colores');
  caja.textContent = '';
  for (const [clave, etiqueta] of PALETA) {
    const l = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = custom[clave] || '#0A1F3C';
    inp.addEventListener('input', async () => {
      const nuevo = { ...(state.themeCustom || {}), [clave]: inp.value };
      state.themeCustom = nuevo;
      aplicarVarsLocales(nuevo, state.theme);
      await g.settingsSet({ themeCustom: nuevo });
      marcarPresetActivo({ theme: state.theme, themeCustom: nuevo });
    });
    const txt = document.createElement('span');
    txt.textContent = etiqueta;
    l.append(inp, txt);
    caja.appendChild(l);
  }
}

document.querySelectorAll('#tema-presets button').forEach(b => {
  b.addEventListener('click', async () => {
    const p = PRESETS[b.dataset.preset];
    state.theme = p.theme;
    state.themeCustom = { ...p.themeCustom };
    await g.settingsSet({ theme: p.theme, themeCustom: { ...p.themeCustom } });
    aplicarVarsLocales(state.themeCustom, state.theme);
    pintarSelectores(state.themeCustom);
    marcarPresetActivo(state);
  });
});

$('tema-reset').addEventListener('click', async () => {
  state.themeCustom = {};
  await g.settingsSet({ themeCustom: {} });
  aplicarVarsLocales({}, state.theme);
  pintarSelectores({});
  marcarPresetActivo(state);
});
