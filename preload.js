// Puente seguro para la interfaz del navegador (ventana principal)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('galeon', {
  getStats: () => ipcRenderer.invoke('stats:get'),
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  listHistory: () => ipcRenderer.invoke('history:list'),
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  updateHistoryTitle: (payload) => ipcRenderer.invoke('history:updateTitle', payload),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  toggleBookmark: (payload) => ipcRenderer.invoke('bookmarks:toggle', payload),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  getSession: () => ipcRenderer.invoke('session:get'),
  saveSession: (urls) => ipcRenderer.invoke('session:save', urls),
  getPaths: () => ipcRenderer.invoke('paths:get'),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  reportFavicon: (payload) => ipcRenderer.invoke('favicon:report', payload),
  getFavicon: (host) => ipcRenderer.invoke('favicon:get', host),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  newWindow: (privada) => ipcRenderer.invoke('win:new', { privada }),
  saveScreenshot: (payload) => ipcRenderer.invoke('shot:save', payload),

  // Menú contextual (lo muestra el proceso principal; las acciones vuelven aquí)
  showContextMenu: (params) => ipcRenderer.send('cm:show', params),
  onContextMenuAction: (cb) => ipcRenderer.on('cm:action', (_e, action) => cb(action)),

  // Descargas: progreso y fin
  onDownload: (cb) => ipcRenderer.on('galeon:download', (_e, info) => cb(info)),

  // Ajustes cambiados (p. ej. tema) desde páginas internas
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, settings) => cb(settings)),

  // Modo desarrollador: ejecutar un userscript de prueba en la pestaña activa
  onUsTestRun: (cb) => ipcRenderer.on('us:test-run', (_e, payload) => cb(payload)),

  // Ofertas: guardar contraseña / instalar userscript
  onPwdAsk: (cb) => ipcRenderer.on('pwd:ask', (_e, info) => cb(info)),
  pwdAnswer: (choice) => ipcRenderer.send('pwd:answer', choice),
  onUsAsk: (cb) => ipcRenderer.on('us:ask', (_e, info) => cb(info)),
  usAnswer: (choice) => ipcRenderer.send('us:answer', choice),
  chooseDownloadsDir: () => ipcRenderer.invoke('dlg:downloads')
});
