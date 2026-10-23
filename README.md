# Galeón ⛵

**Tu tesoro, bien guardado.** Navegador privado que financia la limpieza de plásticos en ríos y océanos.

Cada 10 búsquedas retiran una botella de plástico de un río (~25 g). Sin telemetría, sin perfiles, historial 100% local. **Sin cuentas, sin login — no hay nada que hackear ni que darnos.**

**Dos apps, una misma misión:** Windows (Electron) y Android (Kotlin + WebView del sistema).

## Android

```
android/            proyecto Kotlin (minSdk 23, targetSdk 35)
```

```bash
cd android
./gradlew assembleDebug    # requiere JDK 17 y ANDROID_HOME
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

El APK también queda copiado en `dist/Galeón-0.5.0-android-debug.apk` (~4,8 MB).

**Android v0.5.0 incluye**: pestañas (hasta 12), barra con escudo 🛡 y botellas 🍾, **misma blocklist de más de 100.000 reglas** (dominios, rutas y tercera parte; interceptada en `shouldInterceptRequest`), contador de búsquedas, cookies de terceros bloqueadas, permisos denegados por defecto, página de inicio con preferencias locales; además de: **marcadores ⭐ con dial en la home** (sembrados: Wikipedia, DuckDuckGo, GitHub, OpenStreetMap), **buscar en la página 🔍** con contador de coincidencias, **historial local 🕘**, **ajustes ⚙️** (acerca de, borrar cookies/caché/historial), descargas con DownloadManager, navegador predeterminado del sistema y http→https automático. Único permiso: `INTERNET`; `allowBackup=false`.

Diferencias conocidas: sin pestañas privadas reales (el WebView del sistema comparte almacenamiento entre pestañas; exigiría motor propio o GeckoView), sin userscripts ni contraseñas (pendientes) y sin auto-actualización (para Play Store: `assembleRelease` + keystore propio).

## Cómo ejecutarlo (desarrollo, escritorio)

```bash
npm install        # solo la primera vez
npm start          # abre el navegador
```

## Empaquetado (Fase 1)

```bash
npm run icons        # regenera build/icon.ico desde assets/logo.svg
npm run blocklist    # regenera assets/blocklist.json desde EasyList + EasyPrivacy
npm run dist         # genera el instalador Windows en dist/
npm run selftest     # autoprueba: cuenta una búsqueda y verifica el bloqueo
npm run capture-test # captura la ventana en capture.png
```

El instalador resultante es `dist/Galeón Setup <versión>.exe` (NSIS, permite elegir carpeta, crea acceso directo "Galeón").

**Auto-actualizaciones**: ya cableadas con `electron-updater` (revisión cada 6 h, silenciosa y a prueba de fallos). Se activan solas cuando: (1) la app esté instalada desde el setup, y (2) se publique en GitHub Releases — para eso, añadir en `package.json` → `build`:

```json
"publish": { "provider": "github", "owner": "<tu-usuario>", "repo": "galeon" }
```

**Pendiente de Fase 1**: firma de código (~US$150–400/año, ej. Certum/Sectigo) para que Windows SmartScreen no asuste al instalar. Sin ella todo funciona, pero aparece "aplicación no reconocida".

## Qué incluye (v0.9, escritorio)

- **Enlaces limpios** (estilo Brave): los parámetros de rastreo (`utm_*`, `fbclid`, `gclid`, `si` de YouTube… y ~30 más) se eliminan de cada navegación antes de cargar. El popover del escudo muestra el total limpiado ("🧹 N parámetros…"), también en Diagnóstico.
- **Dormir pestañas**: tras 15 minutos sin uso, las pestañas liberan su memoria (💤 en la pestaña) y se recargan al volver — el "ahorrador de memoria" de los navegadores grandes, apagable en Ajustes.
- **Audio por pestaña**: 🔊 en la pestaña que suena; clic = silenciar (🔇). Como en Chrome/Edge.
- **Buscador de pestañas** (`Ctrl+Mayús+A`, también en el menú ☰): encuentra y salta a cualquier pestaña por título o dirección.
- **Menú de aplicación ☰** (como los navegadores grandes): nueva ventana (Ctrl+N), **nueva ventana privada** (Ctrl+Mayús+N), controles de zoom visibles (− 100% +), favoritos (Ctrl+Mayús+O), historial (Ctrl+H), **descargas (Ctrl+J)**, extensiones, contraseñas, eliminar datos de navegación (Ctrl+Mayús+Supr), imprimir, **traducir página**, **capturar página** (Ctrl+Mayús+S, PNG a Descargas), buscar (Ctrl+F), configuración y diagnóstico.
- **Multi-ventana**: varias ventanas de Galeón a la vez; la privada arranca con pestaña privada y no toca tu sesión guardada. Todos los avisos (descargas, contraseñas, scripts) llegan a todas las ventanas.
- **Página de descargas** (`galeon://descargas`): historial de las últimas 100 con fecha, origen y "abrir carpeta".
- **Gestor de favoritos** (`galeon://favoritos`): abrir, copiar dirección y eliminar.
- **Contraseñas con cifrado de sistema**: al enviar un login, Galeón ofrece guardarlo ("Guardar / Nunca aquí / Ahora no"); en sitios guardados aparece el botón 🔑 para rellenar. Se cifran con tu cuenta de Windows (DPAPI vía safeStorage) — jamás en texto plano, jamás salen del equipo. Gestión completa en `galeon://contraseñas` (revelar 20 s, copiar, eliminar).
- **Userscripts — las "extensiones" de Galeón**: instala scripts de Greasyfork pegando su URL `.user.js` en `galeon://userscripts`, o simplemente navega al enlace: Galeón lo intercepta y ofrece instalarlo. Motor propio con @match/@include/@run-at; el código siempre es visible y editable antes y después de instalar; activar/desactivar/borrar por script. (Las extensiones de la Chrome Web Store no son viables en Electron — decisión de diseño.)
- **Más configuración** (`galeon://ajustes`): tema claro, borrar cookies y datos de sitios al salir, carpeta de descargas personalizada, y apagar el guardado de contraseñas.
- **Indicador de carga**: barra de progreso bajo la barra de herramientas.
- **Página de error propia**: "este sitio no pudo cargarse" con Reintentar, Ir al inicio y, si falló la conexión segura, "abrir sin cifrado" (añade el sitio a las excepciones https y recarga en http).
- **PDF integrado**: los PDF se ven dentro de la pestaña (visor de Chromium), ya no se descargan a ciegas.
- **Zoom** `Ctrl+ +/−/0`, recordado por sitio. **Imprimir** `Ctrl+P`. **Pantalla completa** `F11`.
- **Favicons de primera parte**: Galeón guarda el icono del propio sitio que visitas (nunca servicios de terceros) y lo usa en pestañas, barra de marcadores y dial de la home.
- **Idioma**: los sitios te responden en español (Accept-Language); en ajustes puedes apagarlo para mezclarte con la masa.
- **Pestañas privadas** (🎭 junto al +, o `Ctrl+Shift+N`): partición de memoria volátil — cookies y datos mueren al cerrar, sin historial, sin sesión guardada. Los enlaces abiertos desde una privada heredan su privacidad.
- **Panel de diagnóstico** (`galeon://admin`, también desde el popover del escudo): versión de motor, estado del escudo y lista, rutas de datos, exportación de todos tus datos a un JSON, y zona de reinicio total.
- **Android puede ser tu navegador predeterminado**: abre enlaces http/https del sistema; si ya estabas leyendo algo, el enlace abre en pestaña nueva. Enlaces http suben a https automáticamente (también los intents externos).
- **Página de ajustes** (`galeon://ajustes`): Referer recortado, HTTPS-solo (con excepciones por sitio), DNT/Sec-GPC, idioma, escudo global y por sitio, restauración de sesión, borrado de historial/cookies/caché, y tu impacto acumulado.
- **Escudo por sitio**: clic en el chip 🛡 → cuántos rastreadores bloqueó *este sitio* y botón para desactivar/reactivar el escudo ahí (con recarga inmediata).
- **Privacidad reforzada de fábrica**: Referer recortado a origen, http sube a https automáticamente (red local exceptuada), DNT:1 y Sec-GPC:1 en cada petición.
- **Sesión restaurable**: Galeón recuerda tus pestañas (solo en tu equipo) y las reabre; `Ctrl+Shift+T` reabre la última cerrada.
- **Pestañas y barra** — atajos: `Ctrl+T` nueva pestaña, `Ctrl+W` cerrar, `Ctrl+L` barra, `F5` recargar, `Alt+←/→`, `Ctrl+F` buscar, `Ctrl+D` marcar, `Ctrl+Shift+T` reabrir.
- **Descargas** — en tu carpeta Descargas, aviso con progreso y nombre único.
- **Enlaces en nueva pestaña** — `target=_blank`/`window.open` abren como pestaña.
- **Marcadores** — estrella, barra con avatares, dial en la home (4 semillas quitables).
- **Menú contextual** — clic derecho: enlace en pestaña nueva, copiar dirección/texto, atrás/adelante/recargar, seleccionar todo, buscar.
- **Indicador de conexión** — 🔒 HTTPS, ⚠ HTTP, ⚓ interno.
- **Meta-buscador privado** — DuckDuckGo/Startpage/Mojeek sincronizado entre home y barra.
- **Escudo** — más de 100.000 reglas EasyList/EasyPrivacy con su semántica real (dominios enteros, rutas, tercera parte) + lista de respaldo. Motor testeado (`npm test`) y con canarias de navegación (`npm run selftest`).
- **Contador de impacto** — búsquedas → botellas → gramos; proyectos Motagua/Ozama/Magdalena (demo), elección solo local.
- **Historial local** con panel y borrado (también en Android, botón 🕘).
- **Discreción por defecto** — permisos denegados, cookies de terceros bloqueadas, user agent limpio, cero telemetría.

## Publicación y lanzamiento (Fase 2)

- **CI**: en cada push a `main`, GitHub Actions verifica sintaxis y compila el APK Android (`.github/workflows/ci.yml`).
- **Release**: al publicar un tag (`git tag v0.2.1 && git push origin v0.2.1`), el workflow compila y sube a GitHub Releases el instalador Windows y el APK Android automáticamente (`.github/workflows/release.yml`). El repo de publicación se inyecta desde `GITHUB_REPOSITORY` — no hay que editar nada.
- **Kit de lanzamiento**: carpeta `lanzamiento/` con textos listos para Product Hunt, Hacker News, prensa en español, redes (guion de video) y correos a ONGs, más `checklist.md` con el plan completo y quién hace qué.
- **Contador comunitario**: `landing/impacto.json` alimenta la sección de impacto agregado de la landing (números públicos mensuales, sin rastrear usuarios). El botón de descarga se conecta al último release poniendo la constante `REPO_GITHUB` en `landing/index.html`.

## Estructura

```
main.js                 proceso principal: escudo, stats, historial, preferencias, auto-update
preload.js              puente seguro de la interfaz (contextIsolation)
webview-preload.js      puente seguro para páginas de las pestañas
renderer/               interfaz del navegador + página de inicio
android/                app Android nativa (Kotlin + WebView, misma marca y escudo)
assets/logo.svg         marca · assets/blocklist.json  lista de bloqueo condensada
scripts/make-icons.js   genera build/icon.ico desde el SVG
scripts/fetch-easylist.js  descarga y condensa EasyList/EasyPrivacy
build/                  recursos de empaquetado (icono)
landing/                página pública + impacto.json comunitario
lanzamiento/            kit de lanzamiento (PH, HN, prensa, redes, ONGs, checklist)
.github/workflows/      CI y release automático
PRIVACIDAD.md           política de privacidad
```

Datos del usuario en `%AppData%/galeon-browser/`: `galeon-stats.json`, `galeon-history.json`, `galeon-prefs.json`.

## El pacto

**Mínimo 50% de los ingresos** de Galeón se destinan a retirar y reciclar plástico de ríos y océanos, con informe trimestral público: ingresos, porcentaje enviado, comprobante, foto y coordenadas de cada limpieza. Hoy los proyectos del navegador son demo; el primer convenio real con una ONG de limpieza lo reemplazará.

## Atribución

El filtrado usa las listas públicas [EasyList](https://easylist.to/) y [EasyPrivacy](https://easylist.to/) (© sus autores, licencia [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)), condensadas a dominios por `scripts/fetch-easylist.js`.

## Hoja de ruta

1. ~~Instalador Windows con icono~~ ✅ · ~~Escudo EasyList~~ ✅ · ~~Auto-update~~ ✅ · ~~Landing~~ ✅
2. Firma de código (pendiente de compra)
3. Publicar repo + GitHub Releases + apuntar landing y `publish` al repo
4. Marcadores y menú contextual
5. Modelo de monetización (anuncios contextuales sin perfilado, afiliados, premium)
6. Convenios reales con ONGs de limpieza (recibos con GPS/foto) y contador comunitario real
7. Verificación de marca "Galeón" y dominio
