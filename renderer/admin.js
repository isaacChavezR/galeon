// Galeón — panel de diagnóstico interno (galeon://admin)
const g = window.galeonPage || {};
const $ = (id) => document.getElementById(id);

async function refresh() {
  if (!g.adminGet) return;
  const d = await g.adminGet();
  $('v-app').textContent = 'v' + d.version;
  $('v-chrome').textContent = d.chrome;
  $('v-electron').textContent = d.electron;
  $('v-node').textContent = d.node;
  $('s-count').textContent = d.blocklist.count.toLocaleString('es');
  $('s-updated').textContent = d.blocklist.updated ? d.blocklist.updated.slice(0, 10) : 'lista mínima';
  $('s-blocked').textContent = d.stats.blockedTotal.toLocaleString('es');
  $('s-session').textContent = d.stats.blockedSession.toLocaleString('es');
  $('s-clean').textContent = (d.stats.paramsCleaned || 0).toLocaleString('es');
  $('d-user').textContent = d.paths.userData;
  $('d-down').textContent = d.paths.downloads;
  $('d-hist').textContent = d.counts.history.toLocaleString('es');
  $('d-bm').textContent = d.counts.bookmarks.toLocaleString('es');
  $('d-search').textContent = d.stats.searches.toLocaleString('es');
  $('d-bottles').textContent = d.stats.bottles.toLocaleString('es');
}

$('btn-export').addEventListener('click', async () => {
  try {
    const dest = await g.adminExport();
    $('export-note').textContent = '✓ Exportado a ' + dest;
  } catch {
    $('export-note').textContent = '✕ No se pudo exportar';
  }
});

$('btn-reset').addEventListener('click', async () => {
  if (confirm('¿Borrar TODOS los datos de Galeón?\n\nHistorial, estadísticas, ajustes y sesión se eliminan; los marcadores vuelven a los de fábrica. No hay vuelta atrás.')) {
    await g.adminReset();
    alert('Datos reiniciados. Cierra y abre Galeón para verlo todo limpio.');
    refresh();
  }
});

refresh();
setInterval(refresh, 5000);
