package com.ghersonmena.passme

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// La dirección del servidor de PassMe que muestra la app. Se guarda solo el origen
// (https://host[:puerto]): es lo único a lo que el WebView le permite hablar con la app.
object Server {
    private const val PREFS = "passme"
    private const val KEY = "server"

    fun get(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)

    fun set(context: Context, origin: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, origin).apply()
    }

    // "pass.ejemplo.com" o "https://pass.ejemplo.com/algo" → "https://pass.ejemplo.com".
    // Solo https; http únicamente para localhost (pruebas con adb reverse).
    fun normalize(input: String): String? {
        val text = input.trim().let { if ("://" in it) it else "https://$it" }
        val uri = Uri.parse(text)
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() && ' ' !in it } ?: return null
        val local = host == "localhost" || host == "127.0.0.1"
        if (scheme != "https" && !(scheme == "http" && local)) return null
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "$scheme://$host$port"
    }

    fun sameOrigin(uri: Uri, origin: String): Boolean =
        uri.scheme?.lowercase() in setOf("http", "https") && normalize(uri.toString()) == origin

    // Comprueba que en esa dirección responda PassMe (GET /api/config). No llamar en el hilo principal.
    fun isPassMe(origin: String): Boolean = try {
        val conn = URL("$origin/api/config").openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        try {
            conn.responseCode == 200 && JSONObject(conn.inputStream.bufferedReader().readText()).has("version")
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        false
    }
}
