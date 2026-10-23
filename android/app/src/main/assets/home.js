// Galeón Android — página de inicio
// Preferencias en localStorage (solo este dispositivo); estadísticas las inyecta la app nativa.
const ENGINES = {
  duckduckgo: 'https://html.duckduckgo.com/html/?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  mojeek: 'https://www.mojeek.com/search?q='
};

const PROYECTOS = [
  { id: 'motagua', nombre: 'Río Motagua', pais: 'Guatemala', coords: '15.62° N, 89.13° O',
    desc: 'Uno de los ríos que más plástico arrastra hacia el mar Caribe. Redes de contención y retiro comunitario.' },
  { id: 'ozama', nombre: 'Río Ozama', pais: 'República Dominicana', coords: '18.48° N, 69.89° O',
    desc: 'Jornadas de limpieza en Santo Domingo antes de que los residuos lleguen al Atlántico.' },
  { id: 'magdalena', nombre: 'Río Magdalena', pais: 'Colombia', coords: '6.25° N, 74.75° O',
    desc: 'Barreras flotantes y centros de acopio con reciclaje local en afluentes del Magdalena.' }
];

const $ = (id) => document.getElementById(id);

/* ---- Buscador ---- */
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search-box').value.trim();
  if (!q) return;
  location.href = ENGINES[loadEngine()] + encodeURIComponent(q);
});

/* ---- Preferencias: solo en este dispositivo ---- */
function loadEngine() {
  const e = localStorage.getItem('galeon.engine');
  return ENGINES[e] ? e : 'duckduckgo';
}
$('engine').value = loadEngine();
$('engine').addEventListener('change', () => localStorage.setItem('galeon.engine', $('engine').value));

/* ---- Proyectos ---- */
function selectedProject() { return localStorage.getItem('galeon.proyecto') || 'motagua'; }

function renderProjectPicker() {
  const picker = $('project-picker');
  picker.textContent = '';
  for (const p of PROYECTOS) {
    const btn = document.createElement('button');
    btn.textContent = `${p.nombre} · ${p.pais}`;
    if (p.id === selectedProject()) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      localStorage.setItem('galeon.proyecto', p.id);
      showProject(p.id);
      renderProjectPicker();
    });
    picker.appendChild(btn);
  }
  showProject(selectedProject());
}

function showProject(id) {
  const p = PROYECTOS.find(x => x.id === id) || PROYECTOS[0];
  $('p-name').textContent = `${p.nombre} — ${p.pais}`;
  $('p-coords').textContent = p.coords;
  $('p-desc').textContent = p.desc;
}

/* ---- Impacto: la app nativa llama window.__galeonStats({...}) ---- */
window.__galeonStats = function (s) {
  $('bottles').textContent = s.bottles;
  $('searches').textContent = s.searches;
  $('blocked').textContent = s.blockedSession;
  $('weight').textContent = s.grams >= 1000 ? (s.grams / 1000).toFixed(2) + ' kg' : s.grams + ' g';
};

/* ---- Marcadores: la app nativa los empuja como JSON ---- */
const DIAL_COLORS = ['#E8B84B', '#2EC4B6', '#7FB069', '#C89EC4', '#E08E45', '#6CA6E0'];

window.__galeonBookmarks = function (list) {
  const grid = $('dial-grid');
  if (!grid) return;
  grid.textContent = '';
  $('dial').hidden = !list || list.length === 0;
  for (const b of (list || [])) {
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
    av.style.background = DIAL_COLORS[h % DIAL_COLORS.length];
    const label = document.createElement('span');
    label.className = 'dt-label';
    label.textContent = b.title || host;
    tile.append(av, label);
    grid.appendChild(tile);
  }
};

renderProjectPicker();
