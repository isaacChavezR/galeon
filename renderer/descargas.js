// Galeón — página de descargas (galeon://descargas)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);

function tam(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

async function render() {
  if (!g.dlList) return;
  const list = await g.dlList();
  const box = $('list');
  box.textContent = '';
  if (!list.length) {
    box.innerHTML = '<div class="dl"><div class="dl-name">Sin descargas todavía</div><div class="dl-meta">Cuando descargues algo, aparecerá aquí.</div></div>';
    return;
  }
  for (const d of list) {
    const el = document.createElement('div');
    el.className = 'dl' + (d.ok ? '' : ' fallida');
    const name = document.createElement('div');
    name.className = 'dl-name';
    name.textContent = (d.ok ? '📄 ' : '✕ ') + d.name;
    const meta = document.createElement('div');
    meta.className = 'dl-meta';
    const fecha = new Date(d.ts).toLocaleString('es');
    let host = d.url || '';
    if (host.startsWith('http')) { try { host = new URL(host).hostname; } catch {} }
    else if (host === 'captura') host = 'captura de Galeón';
    meta.textContent = `${fecha}${d.totalBytes ? ' · ' + tam(d.totalBytes) : ''}${host ? ' · ' + host : ''}`;
    const btns = document.createElement('div');
    btns.className = 'dl-btns';
    if (d.ok) {
      const bCarpeta = document.createElement('button');
      bCarpeta.textContent = '📂 Abrir carpeta';
      bCarpeta.addEventListener('click', () => g.dlShow(d.path));
      btns.appendChild(bCarpeta);
    }
    el.append(name, meta, btns);
    box.appendChild(el);
  }
}

render();
