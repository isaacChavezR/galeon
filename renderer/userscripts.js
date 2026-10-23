// Galeón — gestión de userscripts (galeon://userscripts)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);
let editandoId = null;

async function render() {
  if (!g.usList) return;
  const list = await g.usList();
  const box = $('list');
  box.textContent = '';
  if (list.length === 0) {
    box.innerHTML = '<div class="script"><div class="s-name">Sin scripts todavía</div><div class="s-match">Instala uno desde Greasyfork o escribe el tuyo abajo.</div></div>';
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
    bToggle.addEventListener('click', async () => {
      await g.usToggle({ id: s.id, enabled: !s.enabled });
      render();
    });

    const bEdit = document.createElement('button');
    bEdit.textContent = 'Editar';
    bEdit.addEventListener('click', async () => {
      const full = await g.usGet(s.id);
      if (!full) return;
      editandoId = s.id;
      $('f-name').value = full.name;
      $('f-matches').value = (full.matches || []).join('\n');
      $('f-code').value = full.code;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });

    const bDel = document.createElement('button');
    bDel.className = 'del';
    bDel.textContent = 'Eliminar';
    bDel.addEventListener('click', async () => {
      if (confirm(`¿Eliminar "${s.name}"?`)) {
        await g.usDelete(s.id);
        render();
      }
    });

    btns.append(bToggle, bEdit, bDel);
    el.append(name, match, btns);
    box.appendChild(el);
  }
}

$('us-install').addEventListener('click', async () => {
  const url = $('us-url').value.trim();
  if (!url) return;
  $('us-note').textContent = 'Descargando…';
  const meta = await g.usInstallUrl(url);
  if (!meta) {
    $('us-note').textContent = '✕ No se pudo descargar (¿es un enlace .user.js?)';
    return;
  }
  $('f-name').value = meta.name;
  $('f-matches').value = (meta.matches || []).join('\n');
  $('f-code').value = meta.code;
  editandoId = null;
  $('us-note').textContent = `✓ "${meta.name}" descargado — revísalo y pulsa Guardar`;
});

$('f-save').addEventListener('click', async () => {
  const code = $('f-code').value.trim();
  if (!code) { $('us-note').textContent = '✕ El código no puede estar vacío'; return; }
  const matches = $('f-matches').value.split('\n').map(s => s.trim()).filter(Boolean);
  const id = await g.usSave({ id: editandoId, name: $('f-name').value.trim(), matches, code, enabled: true });
  $('us-note').textContent = id ? '✓ Guardado' : '✕ Error al guardar';
  editandoId = null;
  $('f-name').value = ''; $('f-matches').value = ''; $('f-code').value = '';
  render();
});

$('f-clear').addEventListener('click', () => {
  editandoId = null;
  $('f-name').value = ''; $('f-matches').value = ''; $('f-code').value = '';
});

render();
