// Galeón — gestor de favoritos (galeon://favoritos)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);

async function render() {
  if (!g.listBookmarks) return;
  const list = await g.listBookmarks();
  const box = $('list');
  box.textContent = '';
  if (!list.length) {
    box.innerHTML = '<div class="fav"><div class="fav-title">Sin favoritos todavía</div><div class="fav-url">Navega a un sitio y pulsa la estrella ⭐</div></div>';
    return;
  }
  for (const b of list) {
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
    btns.append(bAbrir, bCopiar, bDel);
    el.append(title, url, btns);
    box.appendChild(el);
  }
}

render();
