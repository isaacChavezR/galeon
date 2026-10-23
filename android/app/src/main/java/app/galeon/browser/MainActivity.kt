package app.galeon.browser

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicReference

class MainActivity : ComponentActivity() {

    // ---- Modelo de pestaña ----
    private class Tab(val id: Int, val wv: WebView) {
        var title: String = "Nueva pestaña"
        var url: String = ""
    }

    private val tabs = ArrayList<Tab>()
    private var active: Tab? = null
    private var tabSeq = 0

    private lateinit var tabbar: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var urlbar: EditText
    private lateinit var shieldView: TextView
    private lateinit var bottlesView: TextView
    private lateinit var findbar: LinearLayout
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView

    // ---- Escudo ----
    private val blocklist = AtomicReference<Set<String>>(FALLBACK_TRACKERS)
    private val tpBlocklist = AtomicReference<Set<String>>(emptySet())
    private val blockPaths = AtomicReference<Map<String, List<String>>>(emptyMap())
    private val tpBlockPaths = AtomicReference<Map<String, List<String>>>(emptyMap())

    // ---- Contadores (privacidad: solo SharedPreferences locales) ----
    private object Stats {
        var searches = 0L
        var blockedTotal = 0L
        var blockedSession = 0L
        private set
        private lateinit var prefs: android.content.SharedPreferences
        var onChanged: (() -> Unit)? = null

        fun load(ctx: android.content.Context) {
            prefs = ctx.getSharedPreferences("galeon", MODE_PRIVATE)
            searches = prefs.getLong("searches", 0)
            blockedTotal = prefs.getLong("blockedTotal", 0)
        }

        @Synchronized fun addSearch() {
            searches++
            prefs.edit().putLong("searches", searches).apply()
            onChanged?.invoke()
        }

        @Synchronized fun addBlock() {
            blockedTotal++
            blockedSession++
            prefs.edit().putLong("blockedTotal", blockedTotal).apply()
            onChanged?.invoke()
        }

        fun bottles() = searches / 10
        fun grams() = bottles() * 25
    }

    // ---- Historial local (JSONArray en SharedPreferences, nunca sale del equipo) ----
    private fun historyArray(): JSONArray {
        val raw = getSharedPreferences("galeon", MODE_PRIVATE).getString("history", "[]")
        return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    private fun addHistory(url: String, title: String) {
        if (!url.startsWith("http")) return
        val arr = historyArray()
        // deduplica consecutivos
        if (arr.length() > 0) {
            val last = arr.optJSONObject(arr.length() - 1)
            if (last?.optString("url") == url) {
                last.put("title", title); last.put("ts", System.currentTimeMillis())
                getSharedPreferences("galeon", MODE_PRIVATE).edit().putString("history", arr.toString()).apply()
                return
            }
        }
        arr.put(JSONObject().put("url", url).put("title", title).put("ts", System.currentTimeMillis()))
        while (arr.length() > 300) arr.remove(0)
        getSharedPreferences("galeon", MODE_PRIVATE).edit().putString("history", arr.toString()).apply()
    }

    private fun showHistory() {
        val arr = historyArray()
        if (arr.length() == 0) {
            Toast.makeText(this, "Sin historial: solo existiría en tu equipo", Toast.LENGTH_SHORT).show()
            return
        }
        val titles = ArrayList<String>()
        val urls = ArrayList<String>()
        for (i in arr.length() - 1 downTo 0) {
            val o = arr.optJSONObject(i) ?: continue
            urls.add(o.optString("url"))
            var host = o.optString("url")
            try { host = java.net.URL(o.optString("url")).host } catch (_: Exception) {}
            titles.add("${o.optString("title")} · $host")
        }
        AlertDialog.Builder(this)
            .setTitle("Historial local")
            .setItems(titles.toTypedArray()) { _, i ->
                active?.wv?.loadUrl(urls[i])
            }
            .setNeutralButton("Limpiar") { _, _ ->
                getSharedPreferences("galeon", MODE_PRIVATE).edit().remove("history").apply()
            }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tabbar = findViewById(R.id.tabbar)
        content = findViewById(R.id.content)
        urlbar = findViewById(R.id.urlbar)
        shieldView = findViewById(R.id.shield)
        bottlesView = findViewById(R.id.bottles)

        Stats.load(this)
        Stats.onChanged = { runOnUiThread { updateChips() } }
        updateChips()

        findViewById<TextView>(R.id.newtab).setOnClickListener { newTab() }
        findViewById<TextView>(R.id.btn_back).setOnClickListener { active?.wv?.goBack() }
        findViewById<TextView>(R.id.btn_fwd).setOnClickListener { active?.wv?.goForward() }
        findViewById<TextView>(R.id.btn_reload).setOnClickListener { active?.wv?.reload() }
        findViewById<TextView>(R.id.btn_home).setOnClickListener { loadHome(active) }

        urlbar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigate(urlbar.text.toString())
                urlbar.clearFocus()
                true
            } else false
        }

        findViewById<TextView>(R.id.btn_history).setOnClickListener { showHistory() }
        findViewById<TextView>(R.id.btn_star).setOnClickListener { toggleBookmarkCurrent() }
        findViewById<TextView>(R.id.btn_settings).setOnClickListener { showSettings() }
        setupFindBar()
        seedBookmarks()

        // Carga la lista grande en segundo plano; hasta entonces vale la mínima
        Thread {
            val set = HashSet<String>(120_000)
            val tpSet = HashSet<String>(8_000)
            val paths = HashMap<String, MutableList<String>>()
            val tpPaths = HashMap<String, MutableList<String>>()
            try {
                val root = JSONObject(assets.open("blocklist.json").bufferedReader().use { it.readText() })
                fun arr(n: String) = root.optJSONArray(n)
                for (i in 0 until (arr("domains")?.length() ?: 0)) set.add(arr("domains").getString(i))
                for (i in 0 until (arr("tpDomains")?.length() ?: 0)) tpSet.add(arr("tpDomains").getString(i))
                fun rutas(jsonName: String, destino: HashMap<String, MutableList<String>>) {
                    val obj = root.optJSONObject(jsonName) ?: return
                    val ks = obj.keys()
                    while (ks.hasNext()) {
                        val k = ks.next()
                        val a = obj.optJSONArray(k) ?: continue
                        val l = ArrayList<String>(a.length())
                        for (i in 0 until a.length()) l.add(a.getString(i))
                        destino[k] = l
                    }
                }
                rutas("paths", paths)
                rutas("tpPaths", tpPaths)
            } catch (_: Exception) { }
            blocklist.set(set)
            tpBlocklist.set(tpSet)
            blockPaths.set(paths)
            tpBlockPaths.set(tpPaths)
        }.start()

        newTab()
        handleIntent(intent) // si nos abrieron desde un enlace del sistema
    }

    // ---- Enlaces externos (navegador predeterminado) ----
    private fun upgradeHttp(url: String): String {
        if (!url.startsWith("http://")) return url
        val host = try { java.net.URL(url).host } catch (_: Exception) { "" }
        val esRedLocal = Regex("^(localhost|127\\.|192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)").containsMatchIn(host)
        return if (esRedLocal) url else "https://" + url.substringAfter("http://")
    }

    private fun handleIntent(intent: android.content.Intent?) {
        val url0 = intent?.dataString ?: return
        if (!url0.startsWith("http")) return
        val url = upgradeHttp(url0)
        val t = active
        if (t != null && isHome(t)) {
            // la pestaña inicial estaba en la home: usamos esa
            t.url = url
            t.title = "Cargando…"
            t.wv.loadUrl(url)
            urlbar.setText(url)
            renderTabs()
        } else {
            newTab(url) // ya navegabas: no pisamos lo que leías
        }
    }

    // ---- Marcadores locales (SharedPreferences, igual que todo lo demás) ----
    private fun bookmarksArr(): JSONArray {
        val raw = getSharedPreferences("galeon", MODE_PRIVATE).getString("bookmarks", null)
            ?: return JSONArray().also { /* sembrado en el primer arranque */ }
        return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    private fun seedBookmarks() {
        val p = getSharedPreferences("galeon", MODE_PRIVATE)
        if (p.contains("bookmarks")) return
        val arr = JSONArray()
        for ((url, title) in listOf(
            "https://es.wikipedia.org" to "Wikipedia",
            "https://duckduckgo.com" to "DuckDuckGo",
            "https://github.com" to "GitHub",
            "https://www.openstreetmap.org" to "OpenStreetMap"
        )) arr.put(JSONObject().put("url", url).put("title", title))
        p.edit().putString("bookmarks", arr.toString()).apply()
    }

    private fun toggleBookmarkCurrent() {
        val t = active ?: return
        if (!t.url.startsWith("http")) {
            Toast.makeText(this, "Navega a un sitio para marcarlo", Toast.LENGTH_SHORT).show()
            return
        }
        val arr = bookmarksArr()
        var idx = -1
        for (i in 0 until arr.length()) if (arr.optJSONObject(i)?.optString("url") == t.url) { idx = i; break }
        if (idx >= 0) {
            arr.remove(idx)
            Toast.makeText(this, "☆ Quitado de marcadores", Toast.LENGTH_SHORT).show()
        } else {
            arr.put(JSONObject().put("url", t.url).put("title", t.title))
            Toast.makeText(this, "★ Añadido a marcadores", Toast.LENGTH_SHORT).show()
        }
        getSharedPreferences("galeon", MODE_PRIVATE).edit().putString("bookmarks", arr.toString()).apply()
        pushBookmarksToHome()
    }

    // ---- Buscar en la página ----
    private fun setupFindBar() {
        findbar = findViewById(R.id.findbar)
        findInput = findViewById(R.id.find_input)
        findCount = findViewById(R.id.find_count)

        findViewById<TextView>(R.id.btn_find).setOnClickListener {
            findbar.visibility = if (findbar.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            if (findbar.visibility == View.VISIBLE) findInput.requestFocus()
            else active?.wv?.clearMatches()
        }
        findViewById<TextView>(R.id.find_close).setOnClickListener {
            findbar.visibility = View.GONE
            active?.wv?.clearMatches()
        }
        findViewById<TextView>(R.id.find_next).setOnClickListener { active?.wv?.findNext(true) }
        findViewById<TextView>(R.id.find_prev).setOnClickListener { active?.wv?.findNext(false) }
        findInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                active?.wv?.findAllAsync(findInput.text.toString())
                true
            } else false
        }
    }

    // ---- Ajustes rápidos ----
    private fun showSettings() {
        val opciones = arrayOf("Acerca de Galeón…", "Borrar cookies y datos de sitios", "Borrar caché", "Borrar historial")
        AlertDialog.Builder(this)
            .setTitle("Ajustes")
            .setItems(opciones) { _, which ->
                when (which) {
                    0 -> showAbout()
                    1 -> {
                        CookieManager.getInstance().removeAllCookies(null)
                        CookieManager.getInstance().flush()
                        Toast.makeText(this, "✓ Cookies borradas", Toast.LENGTH_SHORT).show()
                    }
                    2 -> {
                        active?.wv?.clearCache(true)
                        Toast.makeText(this, "✓ Caché borrada", Toast.LENGTH_SHORT).show()
                    }
                    3 -> {
                        getSharedPreferences("galeon", MODE_PRIVATE).edit().remove("history").apply()
                        Toast.makeText(this, "✓ Historial borrado", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cerrar", null)
            .show()
    }

    private fun showAbout() {
        val version = try { packageManager.getPackageInfo(packageName, 0).versionName } catch (_: Exception) { "?" }
        val dominios = String.format(java.util.Locale.getDefault(), "%,d", blocklist.get().size)
        val stats = "Búsquedas: ${Stats.searches} · Botellas: ${Stats.bottles()}\n" +
            "Rastreadores bloqueados: ${Stats.blockedTotal}"
        AlertDialog.Builder(this)
            .setTitle("Galeón $version")
            .setMessage(
                "Navegador privado que financia la limpieza de plásticos en ríos y océanos.\n\n" +
                "Escudo: $dominios dominios de rastreo bloqueados\n\n" +
                stats + "\n\n" +
                "Sin telemetría. Tus datos solo viven en este equipo.\n" +
                "El pacto: mínimo 50% de los ingresos a la causa."
            )
            .setPositiveButton("Cerrar", null)
            .show()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    // ---- Pestañas ----
    @SuppressLint("SetJavaScriptEnabled")
    private fun newTab(urlInicial: String? = null) {
        if (tabs.size >= 12) return
        val wv = WebView(this)
        configureWebView(wv)
        val tab = Tab(++tabSeq, wv)
        tab.url = urlInicial ?: homeUrl
        tab.title = if (urlInicial == null) "Nueva pestaña" else "Cargando…"
        tabs.add(tab)
        content.addView(wv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        activate(tab)
        if (urlInicial != null) wv.loadUrl(urlInicial) else wv.loadUrl(homeUrl)
    }

    private fun closeTab(tab: Tab) {
        val idx = tabs.indexOf(tab)
        if (idx < 0) return
        tabs.removeAt(idx)
        content.removeView(tab.wv)
        tab.wv.destroy()
        when {
            tabs.isEmpty() -> newTab()
            active === tab -> activate(tabs[maxOf(0, idx - 1)])
        }
    }

    private fun activate(tab: Tab) {
        for (t in tabs) t.wv.visibility = if (t === tab) View.VISIBLE else View.GONE
        active = tab
        urlbar.setText(displayUrl(tab.url))
        renderTabs()
        if (isHome(tab)) pushStatsToHome()
    }

    private fun renderTabs() {
        tabbar.removeAllViews()
        val dp = { v: Int -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt() }
        for (t in tabs) {
            val chip = LinearLayout(this)
            chip.orientation = LinearLayout.HORIZONTAL
            chip.gravity = Gravity.CENTER_VERTICAL
            chip.setPadding(dp(10), dp(7), dp(6), dp(7))
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.setMargins(dp(2), 0, dp(2), 0)
            chip.layoutParams = lp

            val title = TextView(this)
            title.text = t.title
            title.textSize = 12f
            title.maxWidth = dp(150)
            title.isSingleLine = true
            val close = TextView(this)
            close.text = "✕"
            close.textSize = 12f
            close.setPadding(dp(8), 0, dp(2), 0)

            if (t === active) {
                chip.setBackgroundColor(Color.parseColor("#12294E"))
                title.setTextColor(Color.parseColor("#F2E9D8"))
                close.setTextColor(Color.parseColor("#F2E9D8"))
            } else {
                title.setTextColor(Color.parseColor("#A9B4C7"))
                close.setTextColor(Color.parseColor("#A9B4C7"))
            }

            close.setOnClickListener { closeTab(t) }
            chip.setOnClickListener { activate(t) }
            chip.addView(title)
            chip.addView(close)
            tabbar.addView(chip)
        }
    }

    // ---- WebView y escudo ----
    @SuppressLint("SetJavaScriptEnabled", "AllowFileAccess")
    private fun configureWebView(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                    // localStorage de la página de inicio, local
            allowFileAccess = true                       // para cargar la home desde assets
            allowFileAccessFromFileURLs = false          // pero nada de file:// hacia afuera
            allowUniversalAccessFromFileURLs = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(wv, false)

        // Contador de coincidencias de "buscar en la página"
        wv.setFindListener { ordinal, matches, _ ->
            findCount.text = if (matches > 0) "$ordinal/$matches" else "0"
        }

        // Descargas: delega en el DownloadManager del sistema (con su propia notificación)
        wv.setDownloadListener(DownloadListener { url, _userAgent, _contentDisposition, mimeType, _ ->
            try {
                val req = android.app.DownloadManager.Request(android.net.Uri.parse(url))
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                if (mimeType != null && mimeType.isNotBlank()) req.setMimeType(mimeType)
                val rawName = url.substringAfterLast('/', "").substringBefore('?').substringBefore('#')
                // sin barras ni puntos sospechosos: evita rutas fuera de Downloads/
                val name = (if (rawName.isBlank()) "descarga" else rawName)
                    .replace(Regex("[/\\\\]"), "_")
                    .replace("..", "_")
                    .let { java.net.URLDecoder.decode(it, "UTF-8") }
                req.setDestinationInExternalPublicDir(
                    android.os.Environment.DIRECTORY_DOWNLOADS, name)
                (getSystemService(DOWNLOAD_SERVICE) as android.app.DownloadManager).enqueue(req)
                Toast.makeText(this, "Descargando: $name", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                Toast.makeText(this, "No se pudo iniciar la descarga", Toast.LENGTH_SHORT).show()
            }
        })

        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                // 1) Nada de file:// desde la web: solo nuestra página interna de assets
                if (uri.scheme == "file") {
                    return !uri.toString().startsWith("file:///android_asset/")
                }
                // 2) HTTPS-solo al navegar: los enlaces http suben a https (red local exceptuada)
                val host = uri.host ?: ""
                val esRedLocal = Regex("^(localhost|127\\.|192\\.168\\.|10\\.|172\\.(1[6-9]|2\\d|3[01])\\.)").containsMatchIn(host)
                if (uri.scheme == "http" && !esRedLocal) {
                    view.loadUrl("https://" + uri.toString().substringAfter("http://"))
                    return true
                }
                return false
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                val host = uri.host ?: return null

                if (!request.isForMainFrame && isTracker(host, uri.path ?: "/", false)) {
                    Stats.addBlock()
                    return emptyResponse()
                }

                countSearchIfNeeded(uri.toString(), host, uri)
                return null
            }

            override fun onPageFinished(view: WebView, url: String) {
                val t = tabFor(view) ?: return
                t.url = url
                if (t === active) urlbar.setText(displayUrl(url))
                view.title?.let { t.title = it; renderTabs() }
                if (url.startsWith("http")) addHistory(url, view.title ?: url)
                if (isHome(t)) pushStatsToHome()
            }
        }

        wv.webChromeClient = object : WebChromeClient() {
            // Discreción por defecto: ubicación y permisos siempre denegados
            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                callback?.invoke(origin, false, false)
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.deny()
            }
        }
    }

    private fun tabFor(wv: WebView): Tab? = tabs.firstOrNull { it.wv === wv }

    // Motor de bloqueo con dominios, rutas y tercera parte.
    // La navegación principal NUNCA se bloquea (un fallo de lista jamás impide abrir un sitio).
    private fun isTracker(host: String, path: String, esPrincipal: Boolean): Boolean {
        if (host.isEmpty()) return false
        val doms = blocklist.get()
        val tpD = tpBlocklist.get()
        val rutas = blockPaths.get()
        val tpR = tpBlockPaths.get()
        var h = host
        while (true) {
            if (doms.contains(h)) return true
            if (!esPrincipal) {
                rutas[h]?.forEach { p -> if (path.startsWith(p)) return true }
                if (tpD.contains(h)) return true
                tpR[h]?.forEach { p -> if (path.startsWith(p)) return true }
            }
            val dot = h.indexOf('.')
            if (dot < 0) return false
            h = h.substring(dot + 1)
        }
    }

    private fun emptyResponse(): WebResourceResponse =
        WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))

    // Cuenta búsquedas: motor conocido + parámetro de consulta, con dedupe de 2 s
    private var lastSearchUrl: String = ""
    private var lastSearchTs: Long = 0

    private fun countSearchIfNeeded(url: String, host: String, uri: android.net.Uri) {
        val isEngine = SEARCH_HOSTS.any { host == it || host.endsWith(".$it") }
        if (!isEngine) return
        val q = try { uri.getQueryParameter("q") ?: uri.getQueryParameter("query") } catch (_: Exception) { null }
        if (q.isNullOrEmpty()) return
        val now = System.currentTimeMillis()
        if (url == lastSearchUrl && now - lastSearchTs < 2000) return
        lastSearchUrl = url
        lastSearchTs = now
        Stats.addSearch()
    }

    // ---- Navegación ----
    private val homeUrl = "file:///android_asset/home.html"

    private fun isHome(t: Tab?) = t != null && t.url.startsWith("file:///android_asset/")

    private fun loadHome(t: Tab?) {
        t ?: return
        t.url = homeUrl
        t.title = "Galeón"
        t.wv.loadUrl(homeUrl)
        renderTabs()
        urlbar.setText("galeon://inicio")
    }

    private fun displayUrl(url: String): String =
        if (url.startsWith("file:///android_asset/")) "galeon://inicio" else url

    private fun navigate(input: String) {
        val text = input.trim()
        if (text.isEmpty()) return
        val tab = active ?: return
        if (text == "galeon://inicio") { loadHome(tab); return }
        val url = if (looksLikeUrl(text)) {
            if (text.startsWith("http://") || text.startsWith("https://")) text else "https://$text"
        } else {
            "https://html.duckduckgo.com/html/?q=" + java.net.URLEncoder.encode(text, "UTF-8")
        }
        tab.wv.loadUrl(url)
    }

    private fun looksLikeUrl(text: String): Boolean =
        (text.startsWith("http://") || text.startsWith("https://")) ||
        (!text.contains(' ') && Regex("^[^\\s]+\\.[^\\s]{2,}$").matches(text))

    // ---- Contadores en la interfaz y en la home ----
    private fun updateChips() {
        shieldView.text = "🛡 ${Stats.blockedSession}"
        bottlesView.text = "🍾 ${Stats.bottles()}"
    }

    private fun pushStatsToHome() {
        val tab = active ?: return
        if (!isHome(tab)) return
        val json = JSONObject()
            .put("searches", Stats.searches)
            .put("bottles", Stats.bottles())
            .put("grams", Stats.grams())
            .put("blockedSession", Stats.blockedSession)
        tab.wv.evaluateJavascript("window.__galeonStats && window.__galeonStats($json);", null)
        pushBookmarksToHome()
    }

    private fun pushBookmarksToHome() {
        val tab = active ?: return
        if (!isHome(tab)) return
        val arr = bookmarksArr()
        tab.wv.evaluateJavascript("window.__galeonBookmarks && window.__galeonBookmarks($arr);", null)
    }

    // Atrás: primero el historial de la página (aunque estemos en la home); luego salir
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val tab = active
        if (tab != null && tab.wv.canGoBack()) tab.wv.goBack()
        else super.onBackPressed()
    }

    companion object {
        val SEARCH_HOSTS = listOf("duckduckgo.com", "startpage.com", "mojeek.com")
        val FALLBACK_TRACKERS = setOf(
            "google-analytics.com", "googletagmanager.com", "googlesyndication.com",
            "doubleclick.net", "ads-twitter.com", "analytics.tiktok.com", "ads.linkedin.com",
            "hotjar.com", "mixpanel.com", "segment.io", "clarity.ms", "scorecardresearch.com",
            "quantserve.com", "criteo.com", "taboola.com", "outbrain.com", "adnxs.com", "mc.yandex.ru"
        )
    }
}
