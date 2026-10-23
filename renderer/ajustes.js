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
  $('theme').checked = settings.theme === 'claro';
  $('sleepTabs').checked = settings.sleepTabs !== false;
  $('clearCookiesOnExit').checked = !!settings.clearCookiesOnExit;
  $('pwdAsk').checked = settings.pwdAsk !== false;
  $('dl-current').textContent = settings.downloadsDir || 'Descargas del sistema';
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
$('theme').addEventListener('change', (e) => set({ theme: e.target.checked ? 'claro' : 'oscuro' }));
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
