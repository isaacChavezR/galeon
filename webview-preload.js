// Puente seguro para las páginas dentro de las pestañas
// Nota: todo lo que se exponga aquí lo puede llamar el JS de la página;
// el proceso principal verifica origen/remitente en cada operación sensible.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('galeonPage', {
  getStats: () => ipcRenderer.invoke('stats:get'),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  bookmarkUpdate: (payload) => ipcRenderer.invoke('bookmarks:update', payload),
  bookmarkAdd: (payload) => ipcRenderer.invoke('bookmarks:add', payload),

  // Para la página galeon://ajustes (se carga dentro de una pestaña)
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  dataClear: (opts) => ipcRenderer.invoke('data:clear', opts),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  chooseDownloadsDir: () => ipcRenderer.invoke('dlg:downloads'),

  // Para galeon://admin
  adminGet: () => ipcRenderer.invoke('admin:get'),
  adminExport: () => ipcRenderer.invoke('admin:export'),
  adminReset: () => ipcRenderer.invoke('admin:reset'),

  // Para galeon://contraseñas
  pwdList: () => ipcRenderer.invoke('pwd:list'),
  pwdReveal: (ref) => ipcRenderer.invoke('pwd:reveal', ref),
  pwdDelete: (ref) => ipcRenderer.invoke('pwd:delete', ref),

  // Para galeon://userscripts
  usList: () => ipcRenderer.invoke('us:list'),
  usGet: (id) => ipcRenderer.invoke('us:get', id),
  usSave: (s) => ipcRenderer.invoke('us:save', s),
  usDelete: (id) => ipcRenderer.invoke('us:delete', id),
  usToggle: (t) => ipcRenderer.invoke('us:toggle', t),
  usInstallUrl: (url) => ipcRenderer.invoke('us:installUrl', url),

  // Para galeon://descargas
  dlList: () => ipcRenderer.invoke('dl:list'),
  dlShow: (ruta) => ipcRenderer.invoke('dl:show', ruta),

  // Para galeon://userscripts (modo desarrollador)
  usTest: (payload) => ipcRenderer.invoke('us:test-relay', payload),
  usLogsGet: () => ipcRenderer.invoke('us:logs:get'),
  usLogsClear: () => ipcRenderer.invoke('us:logs:clear'),
  usExport: () => ipcRenderer.invoke('us:export'),
  usImport: (texto) => ipcRenderer.invoke('us:import', texto),

  // Favicons locales de primera parte (para el dial de la home)
  getFavicon: (host) => ipcRenderer.invoke('favicon:get', host)
});

// --- Tema personalizado: pinta las páginas internas con los colores del usuario ---
function aplicarTemaInterno(settings) {
  const c = settings && settings.themeCustom;
  if (!c) return;
  const vars = { '--navy': c.fondo, '--navy-2': c.superficie, '--navy-3': c.superficie2,
                 '--ink': c.texto, '--ink-dim': c.texto2, '--gold': c.acento, '--teal': c.acento2 };
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === 'string' && v) document.documentElement.style.setProperty(k, v);
  }
  if (settings.theme === 'claro') document.body && document.body.classList.add('tema-claro');
}
ipcRenderer.invoke('settings:get').then(({ settings }) => {
  aplicarTemaInterno(settings);
  document.addEventListener('DOMContentLoaded', () => aplicarTemaInterno(settings));
}).catch(() => {});

/* ---------------------------------------------------------------
   Funciones que corren en el mundo aislado (sin exponer a la página):
   userscripts y contraseñas
---------------------------------------------------------------- */

// --- Userscripts: pedir los que aplican a esta URL e inyectarlos en el mundo de la página ---
// Cada script se envuelve con un shim de desarrollador: sus console.* y errores
// viajan al panel Consola de galeon://userscripts.
const SHIM = `(function(){
  const enviar = (nivel, args) => {
    try { window.postMessage({ __galeonUS: 1, nivel, texto: args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch (e) { return String(a); }
    }).join(' ') }, '*'); } catch (e) {}
  };
  for (const nivel of ['log', 'warn', 'error', 'info']) {
    const original = console[nivel] ? console[nivel].bind(console) : () => {};
    console[nivel] = (...args) => { original(...args); enviar(nivel, args); };
  }
  window.addEventListener('error', (e) => enviar('error', [e.message + ' (' + (e.filename||'') + ':' + e.lineno + ')']));
})();`;

function injectScript(code, runAt, nombre) {
  const poner = () => {
    const s = document.createElement('script');
    s.textContent = SHIM + '\ntry { window.__galeonScriptNombre = ' + JSON.stringify(nombre || 'script') + '; } catch(e){}\n' +
      '(function(){ const __galeonNombre = ' + JSON.stringify(nombre || 'script') + '; try {\n' + code + '\n} catch (e) { try { window.postMessage({ __galeonUS: 1, nivel: \'error\', texto: __galeonNombre + \': \' + (e && e.message) }, \'*\'); } catch (_e2) {} } })();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  };
  if (runAt === 'start' || document.readyState === 'loading') {
    if (runAt === 'start') poner();
    else document.addEventListener('DOMContentLoaded', poner);
  } else poner();
}

ipcRenderer.invoke('us:for', location.href).then((scripts) => {
  if (!Array.isArray(scripts)) return;
  for (const s of scripts) {
    try { injectScript(s.code, s.runAt, s.nombre); } catch (e) { console.warn('userscript error', e); }
  }
}).catch(() => {});

// Relay de los mensajes del shim hacia el proceso principal (rate limitado)
let ultimoRelay = 0;
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.__galeonUS !== 1) return;
  const ahora = Date.now();
  if (ahora - ultimoRelay < 100) return; // tormenta de logs: no ahogar el IPC
  ultimoRelay = ahora;
  try { ipcRenderer.send('us:log', { nivel: d.nivel, texto: String(d.texto || '').slice(0, 500), origen: location.hostname }); } catch {}
});

// --- Contraseñas: detectar formularios de login, ofrecer guardar y autollenar ---
function initPasswordHelpers() {
  if (!/^https?:/.test(location.protocol)) return;

  const findUsernameField = (form, pwd) => {
    const inputs = [...form.querySelectorAll('input')];
    const before = inputs.slice(0, inputs.indexOf(pwd));
    for (const i of before.reverse()) {
      if (i.type === 'email') return i;
      if ((i.type === 'text' || !i.type) && /(user|email|login|account|correo|nick)/i.test(i.name + ' ' + i.id + ' ' + (i.autocomplete || ''))) return i;
    }
    for (let i = before.length - 1; i >= 0; i--) {
      const t = before[i];
      if (t.type === 'text' || !t.type || t.type === 'email') return t;
    }
    return null;
  };

  // Ofrecer guardar al enviar el formulario
  document.addEventListener('submit', () => {
    try {
      const pwd = document.activeElement && document.activeElement.form
        ? document.activeElement.form.querySelector('input[type=password]')
        : document.querySelector('input[type=password]');
      if (!pwd || !pwd.value) return;
      // No ofrecer guardar contraseñas de REGISTRO (no de inicio de sesión)
      if (pwd.getAttribute('autocomplete') === 'new-password') return;
      const form = pwd.form || document;
      const user = findUsernameField(form, pwd);
      ipcRenderer.send('pwd:offer', {
        origin: location.origin,
        username: user && user.value ? user.value : '(sin usuario)',
        password: pwd.value
      });
    } catch (e) { /* la discreción primero: si falla, no molestar */ }
  }, true);

  // Autollenar: botón 🔑 junto al campo de contraseña
  const offerFill = (entries) => {
    const btn = document.createElement('button');
    btn.textContent = '🔑 Galeón';
    btn.type = 'button';
    Object.assign(btn.style, {
      fontSize: '11px', padding: '2px 8px', marginLeft: '6px',
      background: '#0A1F3C', color: '#E8B84B',
      border: 'none', borderRadius: '6px', cursor: 'pointer'
    });
    let idx = 0;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const entry = entries[idx % entries.length];
      idx++;
      const pwd = document.querySelector('input[type=password]');
      if (!pwd) return;
      const form = pwd.form || document;
      const user = findUsernameField(form, pwd);
      const setVal = (el, v) => {
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal(pwd, entry.password);
      setVal(user, entry.username);
    });
    const mount = () => {
      const pwd = document.querySelector('input[type=password]');
      if (pwd && !pwd.dataset.galeonFill) {
        pwd.dataset.galeonFill = '1';
        try { pwd.insertAdjacentElement('afterend', btn); } catch { return; }
      }
    };
    mount();
    setTimeout(mount, 1200); // formularios que se montan tarde
  };

  ipcRenderer.invoke('pwd:lookup', location.origin).then((entries) => {
    if (Array.isArray(entries) && entries.length > 0) offerFill(entries);
  }).catch(() => {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPasswordHelpers);
} else {
  initPasswordHelpers();
}
