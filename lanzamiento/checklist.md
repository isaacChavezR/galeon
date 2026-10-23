# Checklist maestro de lanzamiento — Galeón v0.2

Estado: 2026-10-11. ✅ = hecho · 👤 = solo tú puedes hacerlo · 💻 = puedo hacerlo yo cuando digas

## A. Repo público (bloquea todo lo demás)
- [✅] Código limpio, LICENSE, .gitignore, README completo
- [✅] Workflows CI y Release automático (Windows + Android) listos
- [👤] Crear cuenta GitHub (si no tienes) y repo `galeon`
- [👤] `git add -A && git commit -m "Galeón 0.2.0" && git remote add origin https://github.com/TU-USUARIO/galeon.git && git push -u origin main`
- [👤] `git tag v0.2.0 && git push origin v0.2.0` → el Release con instalador + APK se crea solo (verificar en Actions)
- [👤] En el repo: Settings → habilitar Issues
- [💻] Actualizar landing: constante REPO_GITHUB con tu usuario/repo

## B. Landing pública
- [✅] landing/ completa (pacto 50%, privacidad, impacto comunitario, descarga auto)
- [👤] Elegir dominio y comprarlo (~US$15/año) — sugeridos: galeon.app, navegon.org, galeon.eco
- [👤] Activar GitHub Pages (Settings → Pages → carpeta /landing o usar Cloudflare Pages gratis)
- [👤] Reemplazar email placeholder (hola@galeon.app) por uno real

## C. Identidad y legal (Fase 0 que sigue abierta)
- [👤] Búsqueda formal de marca "Galeón" en clases 9 y 42 de tu país + registro
- [👤] Decidir figura legal antes de mover dinero de la causa (SAS/Ltda/SC)
- [👤] Abrir cuenta Ko-fi o Open Collective para donaciones tempranas

## D. Firma de código
- [👤] (Cuando haya descargas públicas) Comprar OV de Certum ~US$84/año — ya NO vale la pena EV (SmartScreen cambió en 2025)
- [👤] Configurar el token USB + package.json → `npm run dist` firma solo

## E. Contenido de lanzamiento
- [✅] Kit Product Hunt, Show HN, prensa ES, redes, ONGs (carpeta lanzamiento/)
- [👤] Grabar el video de 30 s con el guion de redes.md (celular + capturas de pantalla bastan)
- [👤] Capturas/GIF del navegador en acción
- [👤] Enviar 5 correos a ONGs (ong-email.md)
- [👤] Enviar prensa 3 días después del lanzamiento, con métricas iniciales

## F. Lanzamiento (orden)
1. Repo público + release v0.2.0 (A)
2. Landing con dominio (B)
3. Primer video en redes (E)
4. Show HN (martes-jueves mañana ET)
5. Product Hunt a los 2–3 días del HN (usar tracción como prueba)
6. Prensa ES esa misma semana
7. Respuesta a TODO comentario las primeras 48 h en cada canal

## G. Después del lanzamiento (ritmo sostenible)
- Actualizar landing/impacto.json con cada hito (aunque sea "0 botellas, 340 descargas" — la honestidad temprana construye la marca)
- 1 video/semana con datos reales de bloqueo
- Informe trimestral público: ingresos (aunque sean 0), % a la causa, avances con ONGs
- Meta honesta 6 meses: 1.000–5.000 usuarios activos
