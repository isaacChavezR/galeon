// Galeón — gestor de favoritos (galeon://favoritos)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);

/* ---------- Añadir marcador a mano ---------- */
const filaAdd = document.createElement('div');
filaAdd.className = 'fav';
function pintarFormularioAdd() {
  filaAdd.textContent = '';
  const inputNombre = document.createElement('input');
  inputNombre.type = 'text';
  inputNombre.placeholder = 'Nombre del sitio (ej.: Mi periódico)';
  inputNombre.style.cssText = 'width:100%;margin-top:6px';
  const inputUrl = document.createElement('input');
  inputUrl.type = 'text';
  inputUrl.placeholder = 'https://ejemplo.com';
  inputUrl.style.cssText = 'width:100%;margin-top:6px;font-family:Consolas,monospace';
  const btns = document.createElement('div');
  btns.className = 'fav-btns';
  const bGuardar = document.createElement('button');
  bGuardar.textContent = '＋ Añadir';
  bGuardar.style.borderColor = 'rgba(46,196,182,.5)';
  bGuardar.style.color = 'var(--teal)';
  const bCancelar = document.createElement('button');
  bCancelar.textContent = 'Cancelar';
  const nota = document.createElement('span');
  nota.style.cssText = 'font-size:11.5px;color:#e05252;margin-left:8px';

  const guardar = async () => {
    const r = await g.bookmarkAdd({ url: inputUrl.value, title: inputNombre.value });
    if (r && r.ok) render();
    else nota.textContent = r ? r.error : 'No se pudo añadir';
  };
  bGuardar.addEventListener('click', guardar);
  inputUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
  inputNombre.addEventListener('keydown', (e) => { if (e.key === 'Enter') inputUrl.focus(); });
  bCancelar.addEventListener('click', () => { filaAdd.textContent = ''; render(); });

  btns.append(bGuardar, bCancelar, nota);
  filaAdd.append(inputNombre, inputUrl, btns);
  inputNombre.focus();
}

const bAdd = document.createElement('button');
bAdd.textContent = '＋ Añadir marcador';
bAdd.style.cssText = 'margin:2px 0 12px';
bAdd.addEventListener('click', pintarFormularioAdd);

async function render() {
  if (!g.listBookmarks) return;
  const list = $('list');
  // primera vez: insertamos el botón de añadir encima de la lista
  if (!document.body.contains(bAdd)) list.parentNode.insertBefore(bAdd, list);
  const marcadores = await g.listBookmarks();
  list.textContent = '';
  if (!document.body.contains(filaAdd)) list.appendChild(filaAdd);
  if (filaAdd.textContent === '') filaAdd.remove(); // oculto hasta que se pida
  if (!marcadores.length) {
    list.innerHTML = '<div class="fav"><div class="fav-title">Sin favoritos todavía</div><div class="fav-url">Añade uno con ＋ arriba, o pulsa la estrella ⭐ en cualquier sitio</div></div>';
    return;
  }
  for (const b of marcadores) {
    const el = document.createElement('div');
    el.className = 'fav';
    const title = document.createElement('div');
    title.className = 'fav-title';
    title.textContent = '★ ' + (b.title || b.url);
    const url = document.createElement('div');
    url.className = 'fav-url';
    url.textContent = b.url;
    const btns = document.createElement('div');
    btns.className = 'fav-btns';
    const bAbrir = document.createElement('button');
    bAbrir.textContent = 'Abrir aquí';
    bAbrir.addEventListener('click', () => { location.href = b.url; });
    const bEditar = document.createElement('button');
    bEditar.textContent = '✏️ Editar';
    bEditar.addEventListener('click', () => editarFavorito(el, b));
    const bCopiar = document.createElement('button');
    bCopiar.textContent = 'Copiar dirección';
    bCopiar.addEventListener('click', async () => {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(b.url);
        bCopiar.textContent = '✓ Copiada';
        setTimeout(() => { bCopiar.textContent = 'Copiar dirección'; }, 2000);
      }
    });
    const bDel = document.createElement('button');
    bDel.className = 'del';
    bDel.textContent = 'Eliminar';
    bDel.addEventListener('click', async () => {
      await g.toggleBookmark({ url: b.url, title: b.title });
      render();
    });
    btns.append(bAbrir, bEditar, bCopiar, bDel);
    el.append(title, url, btns);
    list.appendChild(el);
  }
}

// Edición inline: sustituye la fila por un formulario nombre+URL
function editarFavorito(fila, b) {
  fila.textContent = '';
  const inputNombre = document.createElement('input');
  inputNombre.type = 'text';
  inputNombre.value = b.title || '';
  inputNombre.placeholder = 'Nombre';
  inputNombre.style.cssText = 'width:100%;margin-top:6px';
  const inputUrl = document.createElement('input');
  inputUrl.type = 'text';
  inputUrl.value = b.url;
  inputUrl.placeholder = 'https://…';
  inputUrl.style.cssText = 'width:100%;margin-top:6px;font-family:Consolas,monospace';
  const btns = document.createElement('div');
  btns.className = 'fav-btns';
  const bGuardar = document.createElement('button');
  bGuardar.textContent = 'Guardar';
  bGuardar.style.borderColor = 'rgba(232,184,75,.5)';
  bGuardar.style.color = 'var(--gold)';
  const bCancelar = document.createElement('button');
  bCancelar.textContent = 'Cancelar';
  const nota = document.createElement('span');
  nota.style.cssText = 'font-size:11.5px;color:#e05252;margin-left:8px';

  const guardar = async () => {
    const nuevaUrl = inputUrl.value.trim();
    const ok = await g.bookmarkUpdate({ oldUrl: b.url, url: nuevaUrl, title: inputNombre.value });
    if (ok) render();
    else nota.textContent = 'URL inválida o ya existe otro marcador con ella';
  };
  bGuardar.addEventListener('click', guardar);
  inputUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
  bCancelar.addEventListener('click', render);

  btns.append(bGuardar, bCancelar, nota);
  fila.append(inputNombre, inputUrl, btns);
  inputNombre.focus();
  inputNombre.select();
}

render();
