package com.ghersonmena.passme

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

// La web de PassMe dentro de la app: la misma interfaz, el mismo cifrado en el teléfono. Aquí va
// lo que un WebView no hace solo (elegir y guardar archivos, ubicación, enlaces externos, sin
// conexión) y el puente con la web, que solo existe en las páginas del servidor configurado.
abstract class WebActivity : Activity() {
    protected lateinit var web: WebView
    protected lateinit var server: String
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingDownload: ByteArray? = null
    private var geoRequest: Pair<String, GeolocationPermissions.Callback>? = null

    // La dirección que se abre al empezar (la web, o la web en modo autocompletar)
    protected abstract fun startUrl(): String

    // Un mensaje de la web; reply le contesta a esa página
    protected abstract fun onMessage(type: String, msg: JSONObject, reply: (JSONObject) -> Unit)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = Server.get(this)
        if (saved == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        server = saved
        setContentView(R.layout.activity_web)
        Edge.apply(this, findViewById(R.id.root))
        web = findViewById(R.id.web)
        setUpWebView()
        findViewById<Button>(R.id.offline_retry).setOnClickListener {
            findViewById<View>(R.id.offline).visibility = View.GONE
            web.loadUrl(startUrl())
        }
        findViewById<Button>(R.id.offline_change).setOnClickListener { changeServer() }
        web.loadUrl(startUrl())
    }

    override fun onDestroy() {
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    protected fun changeServer() {
        startActivity(Intent(this, SetupActivity::class.java).putExtra(SetupActivity.EXTRA_CURRENT, server))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        // Solo en la versión de pruebas: inspeccionar la web desde Chrome en la computadora
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(true)
            userAgentString = "$userAgentString PassMeAndroid/${BuildConfig.VERSION_NAME}"
        }

        // El puente: window.passmeAndroid aparece solo en el servidor configurado y solo en la
        // página principal, nunca en un iframe ni en otro sitio
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "passmeAndroid", setOf(server)) { _, message, _, isMainFrame, replyProxy ->
                if (!isMainFrame) return@addWebMessageListener
                val msg = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                val reply: (JSONObject) -> Unit = { replyProxy.postMessage(it.toString()) }
                when (val type = msg.optString("type")) {
                    "download" -> saveDownload(msg)
                    else -> onMessage(type, msg, reply)
                }
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (Server.sameOrigin(request.url, server)) return false
                // Los enlaces a otros sitios (mapas, código fuente) se abren fuera de la app
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }

            // Android cerró el proceso de la web (por memoria): se vuelve a abrir en lugar de cerrar la app
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                recreate()
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                findViewById<TextView>(R.id.offline_detail).text = server
                findViewById<View>(R.id.offline).visibility = View.VISIBLE
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(params.createIntent(), REQUEST_FILE)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (!Server.sameOrigin(Uri.parse(origin), server)) {
                    callback.invoke(origin, false, false)
                } else if (hasLocation()) {
                    callback.invoke(origin, true, false)
                } else {
                    geoRequest = origin to callback
                    requestPermissions(
                        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                        REQUEST_LOCATION
                    )
                }
            }
        }
    }

    private fun hasLocation() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_LOCATION) return
        geoRequest?.let { (origin, callback) -> callback.invoke(origin, hasLocation(), false) }
        geoRequest = null
    }

    // La web manda el archivo (frase de recuperación, exportación, llave); Android pregunta dónde guardarlo
    private fun saveDownload(msg: JSONObject) {
        pendingDownload = runCatching { Base64.decode(msg.optString("data"), Base64.DEFAULT) }.getOrNull() ?: return
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(msg.optString("mime").ifEmpty { "text/plain" })
            .putExtra(Intent.EXTRA_TITLE, msg.optString("name").ifEmpty { "passme.txt" })
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST_SAVE)
        } catch (_: ActivityNotFoundException) {
            pendingDownload = null
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show()
        }
    }

    @Deprecated("Activity sin androidx: los resultados llegan aquí")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_FILE -> {
                fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                fileCallback = null
            }
            REQUEST_SAVE -> {
                val bytes = pendingDownload
                pendingDownload = null
                val uri = data?.data
                if (resultCode != RESULT_OK || bytes == null || uri == null) return
                val ok = runCatching { contentResolver.openOutputStream(uri)!!.use { it.write(bytes) } }.isSuccess
                Toast.makeText(this, if (ok) R.string.download_saved else R.string.download_failed, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private companion object {
        const val REQUEST_FILE = 1
        const val REQUEST_SAVE = 2
        const val REQUEST_LOCATION = 3
    }
}
