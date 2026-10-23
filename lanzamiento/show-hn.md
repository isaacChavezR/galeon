# Hacker News — "Show HN"

## Título
Show HN: Galeón – navegador open source que bloquea 100k rastreadores y financia limpiar ríos

(Alternativa si prefieren ángulo técnico:)
Show HN: Un navegador privacidad-first en español, con el giro de que tu causa de donación nunca sale de tu dispositivo

## Cuerpo del post (el texto que va en el primer comentario propio)

Hi HN, I built Galeón, a privacy-first browser in Spanish with a twist.

Tech facts first:
- Electron (Windows) + native Kotlin/WebView app (Android, ~5 MB)
- The shield applies 100k+ EasyList/EasyPrivacy rules with their real semantics (full domains, path-scoped rules, third-party-only rules; first-party navigation can never be blocked)
- Zero telemetry, history stays in local JSON/SharedPreferences, all web permissions denied by default, third-party cookies off
- The interesting privacy detail: users pick which river cleanup project their searches fund, and that choice lives only on the device. We can't see it, by design.

The model: like Ecosia but for river plastic in Latin America (Motagua, Ozama, Magdalena), and in Spanish. Public commitment is minimum 50% of all revenue to removal+recycling, with quarterly receipts. Right now revenue is zero — the pact is written down before the first dollar, on purpose.

Meta-search via DuckDuckGo/Startpage/Mojeek (user-selectable). We don't index the web; probably never will.

Code: (link al repo). Happy to answer anything, including "why another browser" — fair question.

## Notas
- Publicar entre 8:00–10:00 ET entre semana
- NO pedir votos a nadie (regla del sitio; penalización severa)
- Responder con cuenta personal, tono técnico, cero marketing
- Prepararse para la pregunta "¿por qué Electron?": respuesta honesta — velocidad de iteración para un MVP de una persona; la app Android es nativa y ligera
