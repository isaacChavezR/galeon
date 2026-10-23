// Galeón — página de inicio: buscador, impacto y elección local de proyecto
const ENGINES = {
  duckduckgo: 'https://html.duckduckgo.com/html/?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  mojeek: 'https://www.mojeek.com/search?q='
};

const PROYECTOS = [
  { id: 'motagua', nombre: 'Río Motagua', pais: 'Guatemala', coords: '15.62° N, 89.13° O',
    desc: 'Uno de los ríos que más plástico arrastra hacia el mar Caribe. Redes de contención y retiro comunitario.' },
  { id: 'ozama', nombre: 'Río Ozama', pais: 'República Dominicana', coords: '18.48° N, 69.89° O',
    desc: 'Jornadas de limpieza en Santo Domingo antes de que los residuos lleguen al océano Atlántico.' },
  { id: 'magdalena', nombre: 'Río Magdalena', pais: 'Colombia', coords: '6.25° N, 74.75° O',
    desc: 'Barreras flotantes y centros de acopio con reciclaje local en afluentes del Magdalena.' }
];

const $ = (id) => document.getElementById(id);

/* ---- Buscador ---- */
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search-box').value.trim();
  if (!q) return;
  const engine = $('engine').value;
  location.href = ENGINES[engine] + encodeURIComponent(q);
});

/* ---- Preferencias (motor y proyecto, guardadas solo en este equipo) ---- */
async function loadPrefs() {
  try {
    const prefs = await window.galeonPage.getPrefs();
    if (prefs.engine) $('engine').value = prefs.engine;
    renderProjectPicker(prefs.proyecto || 'motagua');
  } catch {
    renderProjectPicker('motagua');
  }
}
$('engine').addEventListener('change', () => window.galeonPage.setPrefs({ engine: $('engine').value }));

/* ---- Proyectos ---- */
function renderProjectPicker(selectedId) {
  const picker = $('project-picker');
  picker.textContent = '';
  for (const p of PROYECTOS) {
    const btn = document.createElement('button');
    btn.textContent = `${p.nombre} · ${p.pais}`;
    if (p.id === selectedId) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      window.galeonPage.setPrefs({ proyecto: p.id });
      showProject(p.id);
      renderProjectPicker(p.id);
    });
    picker.appendChild(btn);
  }
  showProject(selectedId);
}

function showProject(id) {
  const p = PROYECTOS.find(x => x.id === id) || PROYECTOS[0];
  $('p-name').textContent = `${p.nombre} — ${p.pais}`;
  $('p-coords').textContent = p.coords;
  $('p-desc').textContent = p.desc;
}

/* ---- Impacto ---- */
function formatWeight(grams) {
  return grams >= 1000 ? (grams / 1000).toFixed(2) + ' kg' : Math.round(grams) + ' g';
}

async function refreshStats() {
  try {
    const s = await window.galeonPage.getStats();
    $('bottles').textContent = s.bottles;
    $('weight').textContent = formatWeight(s.grams);
    $('searches').textContent = s.searches;
    $('blocked').textContent = s.blockedSession;
  } catch { /* silencioso */ }
}

loadPrefs();
setInterval(refreshStats, 2000);
refreshStats();

/* ---- Dial de marcadores (solo en escritorio, donde existe el puente) ---- */
const AVATAR_COLORS = ['#E8B84B', '#2EC4B6', '#7FB069', '#C89EC4', '#E08E45', '#6CA6E0'];

async function renderDial() {
  if (!window.galeonPage || !window.galeonPage.listBookmarks) return;
  let bookmarks = [];
  try { bookmarks = await window.galeonPage.listBookmarks(); } catch { return; }
  const grid = $('dial-grid');
  grid.textContent = '';
  $('dial').hidden = bookmarks.length === 0;
  for (const b of bookmarks) {
    let host = b.url;
    try { host = new URL(b.url).hostname; } catch {}
    let h = 0;
    for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const tile = document.createElement('a');
    tile.className = 'dial-tile';
    tile.href = b.url;
    const av = document.createElement('span');
    av.className = 'dt-avatar';
    av.textContent = (host.replace(/^www\./, '')[0] || '?').toUpperCase();
    av.style.background = AVATAR_COLORS[h % AVATAR_COLORS.length];
    // favicon local de primera parte si ya lo tenemos
    if (window.galeonPage && window.galeonPage.getFavicon) {
      window.galeonPage.getFavicon(host).then((p) => {
        if (p) {
          const img = document.createElement('img');
          img.src = 'file:///' + encodeURI(p.replace(/\\/g, '/'));
          img.style.width = img.style.height = '30px';
          img.style.objectFit = 'contain';
          av.textContent = '';
          av.style.background = 'transparent';
          av.appendChild(img);
        }
      }).catch(() => {});
    }
    const label = document.createElement('span');
    label.className = 'dt-label';
    label.textContent = b.title || host;
    tile.append(av, label);
    grid.appendChild(tile);
  }
}
renderDial();
