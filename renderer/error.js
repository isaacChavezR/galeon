// Galeón — página de error (se carga dentro de la pestaña que falló)
const params = new URLSearchParams(location.search);
const failUrl = params.get('url') || '';
const code = params.get('code') || '';
const $ = (id) => document.getElementById(id);

$('fail-url').textContent = failUrl;
$('fail-code').textContent = code ? `código ${code}` : '';

const MENSAJES = {
  '-105': 'El nombre del sitio no se resolvió: puede estar mal escrito o caído.',
  '-106': 'La conexión con el sitio se cortó.',
  '-102': 'El certificado de seguridad del sitio no es de confianza. No arriesgamos por ti.',
  '-501': 'La conexión segura (HTTPS) falló. Puede que el sitio no soporte cifrado.',
  '-118': 'La conexión agotó el tiempo de espera.',
  '-3': 'La navegación se canceló.'
};
$('fail-desc').textContent = MENSAJES[code] || 'Revisa tu conexión o inténtalo de nuevo en unos segundos.';

$('btn-retry').addEventListener('click', () => { location.href = failUrl; });
$('btn-home').addEventListener('click', () => { location.href = 'home.html'; });

// Fallback: si era https y el fallo puede ser del HTTPS-solo, permitir http para este sitio
if (failUrl.startsWith('https://') && window.galeonPage && window.galeonPage.settingsGet) {
  $('btn-http').hidden = false;
  $('btn-http').addEventListener('click', async () => {
    try {
      const { settings } = await window.galeonPage.settingsGet();
      let host = '';
      try { host = new URL(failUrl).hostname; } catch {}
      await window.galeonPage.settingsSet({ httpsOff: [...(settings.httpsOff || []), host] });
      location.href = 'http://' + failUrl.slice(8);
    } catch {
      location.href = 'http://' + failUrl.slice(8);
    }
  });
}
