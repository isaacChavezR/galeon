// Galeón — extensiones con modo desarrollador (galeon://userscripts)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);
let editandoId = null;

/* ---------- Pestañas ---------- */
const pestanas = { mios: 'pane-mios', tienda: 'pane-tienda', consola: 'pane-consola' };
for (const [nombre, pane] of Object.entries(pestanas)) {
  $('tab-' + nombre).addEventListener('click', () => {
    for (const k of Object.keys(pestanas)) {
      $('tab-' + k).classList.toggle('on', k === nombre);
      $(pestanas[k]).classList.toggle('on', k === nombre);
    }
    if (nombre === 'consola') renderConsola();
  });
}

/* ---------- Mis scripts: lista ---------- */
async function render() {
  if (!g.usList) return;
  const list = await g.usList();
  const box = $('list');
  box.textContent = '';
  if (list.length === 0) {
    box.innerHTML = '<div class="script"><div class="s-name">Sin scripts todavía</div><div class="s-match">Instala uno de la Tienda, pega un enlace .user.js arriba, o escribe el tuyo en el Editor.</div></div>';
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.className = 'script' + (s.enabled ? '' : ' s-off');
    const name = document.createElement('div');
    name.className = 's-name';
    name.textContent = (s.enabled ? '⚙️ ' : '⏸ ') + s.name;
    const match = document.createElement('div');
    match.className = 's-match';
    match.textContent = (s.matches || []).join(' · ') || 'todos los sitios';
    const btns = document.createElement('div');
    btns.className = 's-btns';

    const bToggle = document.createElement('button');
    bToggle.textContent = s.enabled ? 'Desactivar' : 'Activar';
    bToggle.addEventListener('click', async () => { await g.usToggle({ id: s.id, enabled: !s.enabled }); render(); });

    const bEdit = document.createElement('button');
    bEdit.textContent = 'Editar';
    bEdit.addEventListener('click', async () => {
      const full = await g.usGet(s.id);
      if (!full) return;
      editandoId = s.id;
      $('f-name').value = full.name;
      $('f-matches').value = (full.matches || []).join('\n');
      $('f-code').value = full.code;
      actualizarStats();
      $('f-code').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const bTest = document.createElement('button');
    bTest.className = 'probar';
    bTest.textContent = '▶ Probar';
    bTest.title = 'Ejecuta este script una vez en la pestaña activa, sin recargar';
    bTest.addEventListener('click', async () => {
      const full = await g.usGet(s.id);
      if (!full) return;
      const ok = await g.usTest({ code: full.code, nombre: full.name });
      nota(ok ? `▶ "${full.name}" enviado a la pestaña activa — mira la Consola` : '✕ Abre una pestaña web primero');
    });

    const bDel = document.createElement('button');
    bDel.className = 'del';
    bDel.textContent = 'Eliminar';
    bDel.addEventListener('click', async () => {
      if (confirm(`¿Eliminar "${s.name}"?`)) { await g.usDelete(s.id); render(); }
    });

    btns.append(bToggle, bEdit, bTest, bDel);
    el.append(name, match, btns);
    box.appendChild(el);
  }
}

function nota(texto, ms = 4000) {
  $('us-note').textContent = texto;
  if (ms) setTimeout(() => { if ($('us-note').textContent === texto) $('us-note').textContent = ''; }, ms);
}

/* ---------- Editor ---------- */
function actualizarStats() {
  const c = $('f-code').value;
  $('f-stats').textContent = `· ${c.split('\n').length} líneas, ${c.length} caracteres`;
}
$('f-code').addEventListener('input', actualizarStats);

// Tab = 2 espacios en el editor (no saltar de campo)
$('f-code').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target;
    const ini = t.selectionStart;
    t.value = t.value.slice(0, ini) + '  ' + t.value.slice(t.selectionEnd);
    t.selectionStart = t.selectionEnd = ini + 2;
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('f-save').click(); }
});

$('us-install').addEventListener('click', async () => {
  const url = $('us-url').value.trim();
  if (!url) return;
  nota('Descargando…', 0);
  const meta = await g.usInstallUrl(url);
  if (!meta) { nota('✕ No se pudo descargar (¿es un enlace .user.js?)'); return; }
  $('f-name').value = meta.name;
  $('f-matches').value = (meta.matches || []).join('\n');
  $('f-code').value = meta.code;
  actualizarStats();
  editandoId = null;
  nota(`✓ "${meta.name}" descargado — revísalo y pulsa Guardar`, 8000);
});

$('f-save').addEventListener('click', async () => {
  const code = $('f-code').value.trim();
  if (!code) { nota('✕ El código no puede estar vacío'); return; }
  const matches = $('f-matches').value.split('\n').map(s => s.trim()).filter(Boolean);
  const id = await g.usSave({ id: editandoId, name: $('f-name').value.trim(), matches, code, enabled: true });
  nota(id ? '✓ Guardado — recarga la página donde aplica para verlo' : '✕ Error al guardar');
  editandoId = null;
  $('f-name').value = ''; $('f-matches').value = ''; $('f-code').value = '';
  actualizarStats();
  render();
});

$('f-test').addEventListener('click', async () => {
  const code = $('f-code').value.trim();
  if (!code) { nota('✕ Escribe algo de código primero'); return; }
  const ok = await g.usTest({ code, nombre: $('f-name').value.trim() || 'script de prueba' });
  nota(ok ? '▶ Enviado a la pestaña activa — mira la pestaña Consola' : '✕ Abre una pestaña web primero');
});

$('f-clear').addEventListener('click', () => {
  editandoId = null;
  $('f-name').value = ''; $('f-matches').value = ''; $('f-code').value = '';
  actualizarStats();
});

/* ---------- Exportar / Importar ---------- */
$('f-export').addEventListener('click', async () => {
  const dest = await g.usExport();
  nota(dest ? '✓ Exportado a ' + dest : '✕ No se pudo exportar', 8000);
});

$('f-import').addEventListener('click', () => $('f-import-file').click());
$('f-import-file').addEventListener('change', async (ev) => {
  const archivo = ev.target.files[0];
  if (!archivo) return;
  const texto = await archivo.text();
  const r = await g.usImport(texto);
  nota(r.ok ? `✓ Importados ${r.n} scripts` : '✕ ' + r.error, 6000);
  ev.target.value = '';
  render();
});

/* ---------- Tienda ---------- */
$('tienda-buscar').addEventListener('click', () => buscarTienda());
$('tienda-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarTienda(); });
function buscarTienda() {
  const q = $('tienda-q').value.trim();
  const url = 'https://greasyfork.org/es/scripts' + (q ? '?q=' + encodeURIComponent(q) : '');
  location.href = url; // se abre aquí mismo; el escudo y el instalador hacen el resto
}
document.querySelectorAll('.tienda-links button').forEach((b) => {
  b.addEventListener('click', () => { location.href = b.dataset.url; });
});

/* ---------- Consola ---------- */
async function renderConsola() {
  if (!g.usLogsGet) return;
  const logs = await g.usLogsGet();
  const box = $('consola-list');
  box.textContent = '';
  if (!logs.length) {
    box.innerHTML = '<div class="log"><span class="l-texto" style="color:var(--ink-dim)">Sin actividad. Los console.log() y errores de tus scripts aparecerán aquí.</span></div>';
    return;
  }
  for (const l of logs) {
    const el = document.createElement('div');
    el.className = 'log ' + (l.nivel || 'log');
    const hora = document.createElement('span');
    hora.className = 'l-hora';
    hora.textContent = new Date(l.ts).toLocaleTimeString('es');
    const nivel = document.createElement('span');
    nivel.className = 'l-nivel';
    nivel.textContent = (l.nivel || 'log').toUpperCase();
    const origen = document.createElement('span');
    origen.className = 'l-origen';
    origen.textContent = l.origen || '';
    const texto = document.createElement('span');
    texto.className = 'l-texto';
    texto.textContent = l.texto;
    el.append(hora, nivel, origen, texto);
    box.appendChild(el);
  }
}
$('consola-clear').addEventListener('click', async () => { await g.usLogsClear(); renderConsola(); });

actualizarStats();
render();
